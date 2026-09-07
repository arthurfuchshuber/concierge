import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// "Registros da reserva" (pedido explícito, 07/09/2026): uma linha do tempo
// ÚNICA por reserva — foto, vídeo, áudio, arquivo ou nota de
// situação/problema/auditoria — visível a partir do card em QUALQUER status
// (Check-in, Estadia, Checkout, Fila de Limpeza, Concluídos, Não
// Compareceu). A tabela `reservation_records` é NOVA (migrações
// 20260907130000 e 20260907180000) e os tipos gerados em `types.ts` não a
// conhecem — daí o client "solto" (mesmo padrão de `AnyClient` já usado em
// arrival-board.server.ts / tasks.functions.ts) em vez do
// `SupabaseClient<Database>` estrito.
type AnyClient = { from: (table: string) => any; storage: any; rpc: any };

const BUCKET = "reservation-records";
const SIGN_TTL_SECONDS = 60 * 60; // 1h — mesmo prazo de signChatAttachmentUrl/signPropertyImages.

/**
 * Categorias na ORDEM definida pelo cliente (07/09/2026) — a mesma ordem em
 * que aparecem no seletor que abre ANTES da câmera/gravação.
 */
export const RECORD_CATEGORIES = ["forgotten", "damage", "cleaning_audit", "maintenance", "other"] as const;
export type RecordCategory = (typeof RECORD_CATEGORIES)[number];

const CategoryEnum = z.enum(RECORD_CATEGORIES);
const CardMode = z.enum(["checkin", "checkout", "stay", "cleaning", "done", "no_show"]);

/**
 * As três categorias que viram pendência no Kanban (pedido explícito): a
 * tarefa nasce vinculada AO MESMO TEMPO à reserva (log_id/reservation_id) e
 * ao imóvel (property_id) — os três campos já existiam em `tasks`, nada
 * precisou mudar lá.
 *
 * `taskCategory` mapeia para as categorias que a tela de Pendências já
 * conhece (ver TaskCategory em tasks-types.ts); `showInCleaning` só é
 * ligado em "objeto esquecido" — quem limpa é quem vai achar e separar o
 * objeto, enquanto dano e manutenção são pra operação resolver, não pra
 * faxina executar.
 */
const TASK_RULES: Record<
  string,
  {
    taskCategory: "maintenance" | "guest_request" | "inspection";
    priority: "high" | "medium";
    showInCleaning: boolean;
    prefix: string;
  }
> = {
  // "Mostrar na limpeza" segue a mesma regra do formulário (07/09/2026):
  // MANUTENÇÃO nasce visível pra limpeza; as demais nascem ocultas. Objeto
  // esquecido é a exceção acordada antes — quem limpa é quem acha e separa
  // o objeto, então continua entrando no checklist.
  //
  // Dano entra como "Vistoria" (e não "Manutenção") de propósito: manutenção
  // é a única categoria que vai automaticamente pra próxima limpeza, e um
  // dano é registro/prova pra cobrança, não tarefa da faxina. Se preferir
  // ver danos como Manutenção na lista de Pendências, é só trocar aqui.
  forgotten: { taskCategory: "guest_request", priority: "medium", showInCleaning: true, prefix: "Objeto esquecido" },
  damage: { taskCategory: "inspection", priority: "high", showInCleaning: false, prefix: "Dano/incidente" },
  maintenance: { taskCategory: "maintenance", priority: "medium", showInCleaning: true, prefix: "Manutenção" },
};

// Mesma identidade estável usada em toda a esteira (advanceArrival,
// markNoShow, auto-checkout): pelo menos um dos dois precisa vir preenchido.
const TargetInput = z
  .object({
    logId: z.string().uuid().optional(),
    reservationId: z.string().uuid().optional(),
  })
  .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." });

export type ReservationRecord = {
  id: string;
  kind: "photo" | "video" | "audio" | "file" | "note";
  category: RecordCategory;
  storagePath: string | null;
  url: string | null;
  mime: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  fileName: string | null;
  body: string | null;
  /** Coluna do Kanban onde nasceu. Vazio em anexo de pendência, que não
   * nasce em coluna nenhuma. */
  cardMode: "checkin" | "checkout" | "stay" | "cleaning" | "done" | "no_show" | null;
  createdByName: string | null;
  createdAt: string;
  /** Pendência gerada automaticamente (só nas 3 categorias que geram). */
  taskId: string | null;
  taskStatus: "pending" | "done" | "canceled" | null;
};

/**
 * Lista, em ordem cronológica, TODOS os registros de uma reserva — não
 * importa em qual card/status cada um foi criado.
 */
export const listReservationRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TargetInput.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    const orParts: string[] = [];
    if (data.logId) orParts.push(`log_id.eq.${data.logId}`);
    if (data.reservationId) orParts.push(`reservation_id.eq.${data.reservationId}`);

    const { data: rows, error } = await supabase
      .from("reservation_records")
      .select(
        "id, kind, category, storage_path, mime, size_bytes, duration_ms, file_name, body, card_mode, created_by_name, created_at, task_id",
      )
      .or(orParts.join(","))
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<{
      id: string;
      kind: ReservationRecord["kind"];
      category: RecordCategory;
      storage_path: string | null;
      mime: string | null;
      size_bytes: number | null;
      duration_ms: number | null;
      file_name: string | null;
      body: string | null;
      card_mode: ReservationRecord["cardMode"];
      created_by_name: string | null;
      created_at: string;
      task_id: string | null;
    }>;

    // Assina, de uma vez só, os paths que têm arquivo — mesmo padrão de
    // signPropertyImages (storage.server.ts): um lote em vez de N chamadas.
    const paths = list.filter((r) => r.storage_path).map((r) => r.storage_path as string);
    const urlByPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL_SECONDS);
      for (const s of (signed ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
      }
    }

    // Status ATUAL das pendências geradas — lido da própria tabela `tasks`,
    // nunca copiado pra cá: concluir a pendência no Kanban tem que refletir
    // no registro sem nenhuma sincronização.
    const taskIds = Array.from(new Set(list.map((r) => r.task_id).filter((v): v is string => !!v)));
    const taskStatusById = new Map<string, "pending" | "done" | "canceled">();
    if (taskIds.length > 0) {
      const { data: taskRows } = await supabase.from("tasks").select("id, status").in("id", taskIds);
      for (const t of (taskRows ?? []) as Array<{ id: string; status: "pending" | "done" | "canceled" }>) {
        taskStatusById.set(t.id, t.status);
      }
    }

    const out: ReservationRecord[] = list.map((r) => ({
      id: r.id,
      kind: r.kind,
      category: r.category,
      storagePath: r.storage_path,
      url: r.storage_path ? (urlByPath.get(r.storage_path) ?? null) : null,
      mime: r.mime,
      sizeBytes: r.size_bytes,
      durationMs: r.duration_ms,
      fileName: r.file_name,
      body: r.body,
      cardMode: r.card_mode,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      taskId: r.task_id,
      taskStatus: r.task_id ? (taskStatusById.get(r.task_id) ?? null) : null,
    }));
    return { records: out };
  });

/** Nome de quem está registrando — mesmo fallback usado no handoff. */
async function resolveAuthorName(supabase: AnyClient, userId: string): Promise<string> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name, trade_name")
    .eq("id", userId)
    .maybeSingle();
  return (prof?.trade_name || prof?.full_name) ?? "Um membro da equipe";
}

/**
 * Abre a pendência no Kanban para as categorias que exigem ação
 * (objeto esquecido / dano / manutenção). Devolve o id da tarefa criada, ou
 * null quando a categoria não gera pendência.
 *
 * A tarefa nasce ligada à reserva E ao imóvel — os dois vínculos que o
 * cliente pediu — reaproveitando exatamente os campos que `tasks` já tinha
 * (property_id + log_id + reservation_id), com o mesmo insert de
 * `createTask` (tasks.functions.ts).
 */
async function createLinkedTask(
  supabase: AnyClient,
  userId: string,
  input: {
    category: RecordCategory;
    propertyId: string;
    logId?: string;
    reservationId?: string;
    body: string | null;
  },
): Promise<string | null> {
  const rule = TASK_RULES[input.category];
  if (!rule) return null;

  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  const accountOwnerId = await resolveAuthorizedAccountOwnerId(supabase as never, userId, null);

  // O texto digitado vira o título; sem texto (só foto/áudio), um título
  // genérico da categoria — o anexo em si fica no registro.
  const typed = (input.body ?? "").trim();
  const title = typed ? `${rule.prefix}: ${typed}`.slice(0, 200) : `${rule.prefix} registrado`;

  const { data: inserted, error } = await supabase
    .from("tasks")
    .insert({
      account_owner_id: accountOwnerId,
      property_id: input.propertyId,
      owner_contact_id: null,
      log_id: input.logId ?? null,
      reservation_id: input.reservationId ?? null,
      title,
      description: "Aberta automaticamente a partir de um registro da reserva.",
      category: rule.taskCategory,
      priority: rule.priority,
      due_date: null,
      show_in_cleaning: rule.showInCleaning,
      amount_spent_cents: null,
      recurrence_days: null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (inserted as { id: string }).id;
}

/**
 * Registra um anexo (foto/vídeo/áudio/arquivo) já enviado pelo cliente
 * direto pro storage — mesmo fluxo de attachStaffMessage (chat-
 * attachments.functions.ts): o navegador sobe o arquivo pro bucket
 * primeiro (RLS de storage.objects garante que só quem acessa o imóvel
 * escreve ali), e esta função só grava a linha com os metadados.
 */
export const attachReservationRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        logId: z.string().uuid().optional(),
        reservationId: z.string().uuid().optional(),
        cardMode: CardMode,
        category: CategoryEnum,
        path: z.string().min(3).max(500),
        kind: z.enum(["photo", "video", "audio", "file"]),
        mime: z.string().min(1).max(150),
        sizeBytes: z.number().int().nonnegative(),
        durationMs: z.number().int().nonnegative().optional().nullable(),
        fileName: z.string().max(200).optional().nullable(),
        caption: z.string().max(2000).optional().nullable(),
      })
      .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;

    // Caminho precisa começar com <property_id>/ — mesma checagem de
    // attachStaffMessage, evita gravar metadados apontando pra um objeto
    // fora do imóvel esperado.
    if (!data.path.startsWith(`${data.propertyId}/`)) {
      throw new Error("Caminho de anexo inválido.");
    }

    const who = await resolveAuthorName(supabase, context.userId);
    const taskId = await createLinkedTask(supabase, context.userId, {
      category: data.category,
      propertyId: data.propertyId,
      logId: data.logId,
      reservationId: data.reservationId,
      body: data.caption ?? null,
    });

    const { error } = await supabase.from("reservation_records").insert({
      property_id: data.propertyId,
      log_id: data.logId ?? null,
      reservation_id: data.reservationId ?? null,
      kind: data.kind,
      category: data.category,
      storage_path: data.path,
      mime: data.mime,
      size_bytes: data.sizeBytes,
      duration_ms: data.durationMs ?? null,
      file_name: data.fileName ?? null,
      body: data.caption ?? null,
      card_mode: data.cardMode,
      created_by: context.userId,
      created_by_name: who,
      task_id: taskId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, taskCreated: !!taskId };
  });

/**
 * Registra uma nota só de texto (situação, problema, auditoria) — sem
 * anexo.
 */
export const createReservationRecordNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        logId: z.string().uuid().optional(),
        reservationId: z.string().uuid().optional(),
        cardMode: CardMode,
        category: CategoryEnum,
        body: z.string().trim().min(1).max(2000),
      })
      .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    const who = await resolveAuthorName(supabase, context.userId);
    const taskId = await createLinkedTask(supabase, context.userId, {
      category: data.category,
      propertyId: data.propertyId,
      logId: data.logId,
      reservationId: data.reservationId,
      body: data.body,
    });

    const { error } = await supabase.from("reservation_records").insert({
      property_id: data.propertyId,
      log_id: data.logId ?? null,
      reservation_id: data.reservationId ?? null,
      kind: "note",
      category: data.category,
      body: data.body,
      card_mode: data.cardMode,
      created_by: context.userId,
      created_by_name: who,
      task_id: taskId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, taskCreated: !!taskId };
  });

/**
 * Anexo preso a uma PENDÊNCIA (não a uma reserva) — usado pela comprovação
 * da resolução e pelos anexos da criação de pendência (07/09/2026).
 *
 * Mesma mecânica do anexo de reserva: o navegador sobe o arquivo pro bucket
 * e aqui só gravamos os metadados. Quando a pendência tem reserva vinculada,
 * `logId`/`reservationId` vêm junto — assim a comprovação também aparece na
 * linha do tempo daquela reserva, fechando o ciclo "problema → conserto" no
 * mesmo lugar. Sem reserva (pendência só do imóvel), o registro fica preso
 * apenas à pendência, e `cardMode` fica vazio: não nasceu em coluna nenhuma
 * do Kanban.
 */
export const attachTaskRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        taskId: z.string().uuid(),
        logId: z.string().uuid().optional(),
        reservationId: z.string().uuid().optional(),
        category: CategoryEnum.default("other"),
        isResolution: z.boolean().default(false),
        path: z.string().min(3).max(500),
        kind: z.enum(["photo", "video", "audio", "file"]),
        mime: z.string().min(1).max(150),
        sizeBytes: z.number().int().nonnegative(),
        durationMs: z.number().int().nonnegative().optional().nullable(),
        fileName: z.string().max(200).optional().nullable(),
        caption: z.string().max(2000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    if (!data.path.startsWith(`${data.propertyId}/`)) {
      throw new Error("Caminho de anexo inválido.");
    }
    const who = await resolveAuthorName(supabase, context.userId);
    const { error } = await supabase.from("reservation_records").insert({
      property_id: data.propertyId,
      log_id: data.logId ?? null,
      reservation_id: data.reservationId ?? null,
      task_id: data.taskId,
      is_resolution: data.isResolution,
      kind: data.kind,
      category: data.category,
      storage_path: data.path,
      mime: data.mime,
      size_bytes: data.sizeBytes,
      duration_ms: data.durationMs ?? null,
      file_name: data.fileName ?? null,
      body: data.caption ?? null,
      card_mode: null,
      created_by: context.userId,
      created_by_name: who,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Anexos de uma pendência — os da abertura e os da comprovação. */
export const listTaskRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ taskId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    const { data: rows, error } = await supabase
      .from("reservation_records")
      .select("id, kind, category, storage_path, mime, size_bytes, duration_ms, file_name, body, created_by_name, created_at, is_resolution")
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<{
      id: string;
      kind: ReservationRecord["kind"];
      category: RecordCategory;
      storage_path: string | null;
      mime: string | null;
      size_bytes: number | null;
      duration_ms: number | null;
      file_name: string | null;
      body: string | null;
      created_by_name: string | null;
      created_at: string;
      is_resolution: boolean;
    }>;

    const paths = list.filter((r) => r.storage_path).map((r) => r.storage_path as string);
    const urlByPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL_SECONDS);
      for (const s of (signed ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
      }
    }

    return {
      records: list.map((r) => ({
        id: r.id,
        kind: r.kind,
        category: r.category,
        url: r.storage_path ? (urlByPath.get(r.storage_path) ?? null) : null,
        mime: r.mime,
        sizeBytes: r.size_bytes,
        durationMs: r.duration_ms,
        fileName: r.file_name,
        body: r.body,
        createdByName: r.created_by_name,
        createdAt: r.created_at,
        isResolution: r.is_resolution,
      })),
    };
  });

/**
 * Remove um registro (e o arquivo do storage, se houver). A pendência
 * gerada NÃO é apagada junto: ela pode já estar em andamento com outra
 * pessoa: quem quiser encerrá-la faz isso na tela de Pendências.
 */
export const deleteReservationRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    const { data: existing } = await supabase
      .from("reservation_records")
      .select("id, storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (!existing) return { ok: true };

    const { error } = await supabase.from("reservation_records").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    if (existing.storage_path) {
      // Best-effort: se o arquivo já não existir mais no storage por algum
      // motivo, a linha ainda assim precisa sumir da lista.
      try {
        await supabase.storage.from(BUCKET).remove([existing.storage_path]);
      } catch {
        // ignore
      }
    }
    return { ok: true };
  });
