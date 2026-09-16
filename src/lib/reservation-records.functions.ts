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
export const RECORD_CATEGORIES = [
  "forgotten",
  "damage",
  "cleaning_audit",
  "maintenance",
  "other",
] as const;
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
  forgotten: {
    taskCategory: "guest_request",
    priority: "medium",
    showInCleaning: true,
    prefix: "Objeto esquecido",
  },
  damage: {
    taskCategory: "inspection",
    priority: "high",
    showInCleaning: false,
    prefix: "Dano/incidente",
  },
  maintenance: {
    taskCategory: "maintenance",
    priority: "medium",
    showInCleaning: true,
    prefix: "Manutenção",
  },
};

// Mesma identidade estável usada em toda a esteira (advanceArrival,
// markNoShow, auto-checkout): pelo menos um dos dois precisa vir preenchido.
const TargetInput = z
  .object({
    logId: z.string().uuid().optional(),
    reservationId: z.string().uuid().optional(),
  })
  .refine((v) => !!v.logId || !!v.reservationId, {
    message: "Informe a reserva ou o registro do hóspede.",
  });

export type ReservationRecord = {
  id: string;
  /** Situação a que a mídia pertence (ver migração 20260910180000). */
  groupId: string | null;
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
        "id, group_id, kind, category, storage_path, mime, size_bytes, duration_ms, file_name, body, card_mode, created_by_name, created_at, task_id",
      )
      .or(orParts.join(","))
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<{
      id: string;
      group_id: string | null;
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
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGN_TTL_SECONDS);
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
      const { data: taskRows } = await supabase
        .from("tasks")
        .select("id, status")
        .in("id", taskIds);
      for (const t of (taskRows ?? []) as Array<{
        id: string;
        status: "pending" | "done" | "canceled";
      }>) {
        taskStatusById.set(t.id, t.status);
      }
    }

    const out: ReservationRecord[] = list.map((r) => ({
      id: r.id,
      groupId: r.group_id,
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

/**
 * NOME DO REGISTRO (pedido explícito, 10/09/2026): as 10 primeiras letras do
 * anúncio + o sequencial daquele imóvel — "STUDIO101-01".
 *
 * O nome que vinha da câmera do celular ("17890533261888326086821345931428
 * .jpg") não dizia nada, e é ele que aparece como título quando o registro
 * não tem texto digitado. Isto é só RÓTULO: a chave real do arquivo é
 * `storage_path`, que não é tocado.
 *
 * A mesma regra está na migração 20260910150000, que renomeou o que já
 * estava gravado. Se mudar aqui, mude lá.
 */
const ACCENT_FROM = "áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ";
const ACCENT_TO = "aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC";

function propertySlug(name: string | null): string {
  const first10 = (name ?? "REGISTRO").slice(0, 10);
  const noAccent = first10.replace(/./g, (ch) => {
    const i = ACCENT_FROM.indexOf(ch);
    return i === -1 ? ch : ACCENT_TO[i];
  });
  return noAccent.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "REGISTRO";
}

/** Próximo nome disponível para este imóvel. A contagem vem do banco, então
 * dois envios simultâneos podem repetir o número — é rótulo, não chave, e
 * repetir é preferível a segurar o envio numa transação.
 *
 * Conta SITUAÇÕES, não arquivos: as linhas principais são aquelas em que
 * `id = group_id`, então uma situação com 4 fotos consome UM número. As três
 * mídias extras herdam o nome da principal (ver `createRecordSituation`).
 */
async function nextRecordName(supabase: AnyClient, propertyId: string): Promise<string> {
  const [{ data: prop }, { data: primaries }] = await Promise.all([
    supabase.from("properties").select("name").eq("id", propertyId).maybeSingle(),
    supabase.from("reservation_records").select("id, group_id").eq("property_id", propertyId),
  ]);
  const rows = (primaries ?? []) as Array<{ id: string; group_id: string | null }>;
  const seq = rows.filter((r) => (r.group_id ?? r.id) === r.id).length + 1;
  return `${propertySlug((prop as { name: string | null } | null)?.name ?? null)}-${String(seq).padStart(2, "0")}`;
}

/**
 * TÍTULO + DESCRIÇÃO em um campo só.
 *
 * O banco tem `body` e mais nada. A regra da casa (10/09/2026) é que todo
 * registro tenha um título curto e uma descrição, e a página principal mostre
 * o TÍTULO — nunca o nome do arquivo. Guardamos os dois no mesmo `body`, com
 * o título na primeira linha, que é exatamente como a leitura já funciona.
 */
export const RECORD_TITLE_MAX = 50;

function composeBody(title: string | null | undefined, description: string | null | undefined) {
  const t = (title ?? "").trim().slice(0, RECORD_TITLE_MAX);
  const d = (description ?? "").trim();
  if (!t && !d) return null;
  if (!d) return t;
  if (!t) return d;
  return `${t}\n${d}`;
}

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
      .refine((v) => !!v.logId || !!v.reservationId, {
        message: "Informe a reserva ou o registro do hóspede.",
      })
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
      file_name: await nextRecordName(supabase, data.propertyId),
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
      .refine((v) => !!v.logId || !!v.reservationId, {
        message: "Informe a reserva ou o registro do hóspede.",
      })
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

/* -----------------------------------------------------------------------
 * A SITUAÇÃO — um registro com título, descrição e VÁRIAS mídias
 *
 * Pedido explícito (10/09/2026): "cada vez que o prestador for gravar
 * video/audio/foto, etc.. criar uma folha para aquela situação e um botão
 * 'registrar situação' para que ele consiga registrar uma nova".
 *
 * Antes, cada arquivo subia sozinho e virava um registro e uma pendência
 * separados — três fotos do mesmo estrago = três pendências. Aqui é uma
 * chamada só: N mídias já enviadas ao storage viram N linhas com o MESMO
 * `group_id`, UMA pendência e UM nome (CASACHARM-05). A linha principal
 * (`id = group_id`) guarda o texto.
 * ----------------------------------------------------------------------- */

/** Teto de mídias por situação (decisão do cliente, 10/09/2026). Mais que
 * isso, com a internet de um imóvel no meio de uma limpeza, o envio trava e
 * a pessoa desiste no meio. */
export const SITUATION_MEDIA_MAX = 10;

const SituationMedia = z.object({
  path: z.string().min(3).max(500),
  kind: z.enum(["photo", "video", "audio", "file"]),
  mime: z.string().min(1).max(150),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional().nullable(),
});

export const createRecordSituation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        logId: z.string().uuid().optional(),
        reservationId: z.string().uuid().optional(),
        cardMode: CardMode,
        category: CategoryEnum,
        title: z.string().trim().max(RECORD_TITLE_MAX).optional().nullable(),
        description: z.string().trim().max(4000).optional().nullable(),
        media: z.array(SituationMedia).max(SITUATION_MEDIA_MAX),
        /* Quantas mídias ainda vão subir depois desta chamada.
         *
         * Existe por causa de 11/09/2026: a tela subia TODOS os arquivos e só
         * então gravava. Uma faxineira selecionou seis vídeos ao longo do dia,
         * em duas tentativas, e o celular matou a aba no meio do envio das duas
         * vezes — resultado: zero arquivos no servidor, zero registros, nenhum
         * erro para ela e nenhum rastro para nós. Agora a situação nasce
         * primeiro, com o texto, e cada arquivo se junta a ela conforme sobe
         * (ver `appendSituationMedia`). Morrendo no meio, o que já subiu fica. */
        pendingMedia: z.number().int().min(0).max(SITUATION_MEDIA_MAX).optional(),
      })
      .refine((v) => !!v.logId || !!v.reservationId, {
        message: "Informe a reserva ou o registro do hóspede.",
      })
      .refine((v) => v.media.length > 0 || (v.pendingMedia ?? 0) > 0 || !!(v.title ?? "").trim(), {
        message: "Uma situação precisa de pelo menos uma mídia ou um título.",
      })
      // TÍTULO OBRIGATÓRIO SÓ NAS PENDÊNCIAS (decisão do cliente, 10/09/2026):
      // dano, manutenção e objeto esquecido viram trabalho para alguém — sem
      // título ninguém sabe o que executar. Auditoria de limpeza é vídeo de
      // rotina e segue podendo entrar sem texto.
      .refine((v) => !TASK_RULES[v.category] || !!(v.title ?? "").trim(), {
        message: "Dano, manutenção e objeto esquecido precisam de um título.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;

    // Mesma checagem de caminho do anexo avulso, para cada mídia.
    for (const m of data.media) {
      if (!m.path.startsWith(`${data.propertyId}/`)) throw new Error("Caminho de anexo inválido.");
    }

    const body = composeBody(data.title, data.description);
    const who = await resolveAuthorName(supabase, context.userId);
    const taskId = await createLinkedTask(supabase, context.userId, {
      category: data.category,
      propertyId: data.propertyId,
      logId: data.logId,
      reservationId: data.reservationId,
      body: (data.title ?? "").trim() || null,
    });
    const fileName = await nextRecordName(supabase, data.propertyId);
    const groupId = crypto.randomUUID();

    const base = {
      property_id: data.propertyId,
      log_id: data.logId ?? null,
      reservation_id: data.reservationId ?? null,
      category: data.category,
      card_mode: data.cardMode,
      created_by: context.userId,
      created_by_name: who,
      task_id: taskId,
      group_id: groupId,
      file_name: fileName,
    };

    // Sem mídia é uma nota: a principal é a própria nota. Com mídia, a
    // primeira é a principal — o texto e a pendência moram nela.
    const rows =
      data.media.length === 0
        ? [{ ...base, id: groupId, kind: "note", body }]
        : data.media.map((m, i) => ({
            ...base,
            ...(i === 0 ? { id: groupId, body } : { body: null }),
            kind: m.kind,
            storage_path: m.path,
            mime: m.mime,
            size_bytes: m.sizeBytes,
            duration_ms: m.durationMs ?? null,
          }));

    const { error } = await supabase.from("reservation_records").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true, taskCreated: !!taskId, fileName, groupId };
  });

/**
 * ANEXA UMA MÍDIA A UMA SITUAÇÃO QUE JÁ EXISTE (11/09/2026).
 *
 * É a segunda metade da correção descrita em `pendingMedia`: a tela grava a
 * situação primeiro e chama esta função UMA VEZ POR ARQUIVO, conforme cada
 * upload termina. Se o celular matar a aba no terceiro vídeo, os dois
 * primeiros já estão registrados e visíveis — em vez de tudo evaporar.
 *
 * Não cria pendência: a tarefa, quando existe, já nasceu com a situação. Herda
 * categoria, reserva e modo do cartão da linha principal, para que um anexo
 * nunca possa cair num lugar diferente do resto do grupo.
 */
export const appendSituationMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        groupId: z.string().uuid(),
        propertyId: z.string().uuid(),
        path: z.string().min(3).max(500),
        kind: z.enum(["photo", "video", "audio", "file"]),
        mime: z.string().min(1).max(150),
        sizeBytes: z.number().int().nonnegative(),
        durationMs: z.number().int().nonnegative().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    if (!data.path.startsWith(`${data.propertyId}/`)) {
      throw new Error("Caminho de anexo inválido.");
    }

    // A linha principal do grupo é a fonte de verdade do contexto. Lê pelo
    // client do usuário: o RLS já decide se ele pode enxergar aquele registro.
    const { data: principal, error: readErr } = await supabase
      .from("reservation_records")
      .select("id, property_id, log_id, reservation_id, category, card_mode, file_name")
      .eq("id", data.groupId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const p = principal as {
      property_id: string;
      log_id: string | null;
      reservation_id: string | null;
      category: string;
      card_mode: string;
      file_name: string | null;
    } | null;
    if (!p) throw new Error("Situação não encontrada.");
    if (p.property_id !== data.propertyId) throw new Error("Situação de outro imóvel.");

    const who = await resolveAuthorName(supabase, context.userId);
    const { error } = await supabase.from("reservation_records").insert({
      property_id: p.property_id,
      log_id: p.log_id,
      reservation_id: p.reservation_id,
      category: p.category,
      card_mode: p.card_mode,
      group_id: data.groupId,
      file_name: p.file_name,
      kind: data.kind,
      storage_path: data.path,
      mime: data.mime,
      size_bytes: data.sizeBytes,
      duration_ms: data.durationMs ?? null,
      body: null,
      created_by: context.userId,
      created_by_name: who,
      task_id: null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * EDITAR o texto de uma situação já gravada (decisão do cliente, 10/09/2026:
 * "pode manter 'Sem título informado', mas com a possibilidade do
 * usuário/prestador editar posteriormente").
 *
 * Escreve sempre na LINHA PRINCIPAL do grupo, mesmo que o id recebido seja o
 * de uma mídia secundária — quem edita clica no que está vendo, não no que
 * está no banco. O título da pendência acompanha, senão o Kanban continua
 * dizendo "Dano/incidente registrado" para sempre.
 */
export const updateRecordText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().max(RECORD_TITLE_MAX),
        description: z.string().trim().max(4000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    const { data: row, error: readErr } = await supabase
      .from("reservation_records")
      .select("id, group_id, category, task_id")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Registro não encontrado.");

    const r = row as {
      id: string;
      group_id: string | null;
      category: RecordCategory;
      task_id: string | null;
    };
    if (TASK_RULES[r.category] && !data.title.trim()) {
      throw new Error("Dano, manutenção e objeto esquecido precisam de um título.");
    }
    const primaryId = r.group_id ?? r.id;
    const body = composeBody(data.title, data.description);

    // O RLS da tabela é quem decide se esta pessoa pode escrever aqui — não
    // repetimos a regra de acesso em código.
    const { error } = await supabase
      .from("reservation_records")
      .update({ body })
      .eq("id", primaryId);
    if (error) throw new Error(error.message);

    if (r.task_id && data.title.trim()) {
      const rule = TASK_RULES[r.category];
      await supabase
        .from("tasks")
        .update({ title: `${rule?.prefix ?? "Registro"}: ${data.title.trim()}`.slice(0, 200) })
        .eq("id", r.task_id);
    }
    return { ok: true };
  });

/**
 * DITADO nos campos de título e descrição — o prestador fala, vira texto.
 *
 * Usa a MESMA transcrição das duas IAs (src/lib/ai/transcribe.server.ts), pelo
 * mesmo motivo de sempre: falar tem que valer o mesmo que digitar. O áudio do
 * ditado é usado e descartado; áudio que a pessoa queira GUARDAR entra como
 * mídia da situação, pelo botão "+".
 */
export const transcribeRecordAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        audioBase64: z.string().min(100).max(20_000_000),
        mimeType: z.string().max(120).default("audio/webm"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Acesso ao imóvel pelo mesmo helper que recorta a aba Registros.
    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const allowed = await accessiblePropertyIds(context.supabase as never, null, context.userId);
    if (!allowed.includes(data.propertyId)) throw new Error("Sem acesso a este imóvel.");
    const { transcribeAudioBase64 } = await import("@/lib/ai/transcribe.server");
    return { text: await transcribeAudioBase64(data.audioBase64, data.mimeType) };
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
      file_name: await nextRecordName(supabase, data.propertyId),
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
      .select(
        "id, kind, category, storage_path, mime, size_bytes, duration_ms, file_name, body, created_by_name, created_at, is_resolution",
      )
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<{
      id: string;
      group_id: string | null;
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
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGN_TTL_SECONDS);
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

/* ---------------------------------------------------------------------- *
 * ABA "REGISTROS" (09/09/2026) — a mesma tabela, vista de fora da reserva.
 *
 * Até aqui um registro só era alcançável de DENTRO do card da reserva (o
 * clipe): para achar alguma coisa era preciso já saber em qual reserva ela
 * estava. Nenhuma pergunta transversal era possível — "todos os danos",
 * "os registros do Studio 101", "o que ainda não foi tratado".
 *
 * Esta função é essa porta. Sem recorte de período (pedido explícito): a
 * aba abre com o histórico inteiro, e quem quiser recortar usa o mesmo
 * botão de filtro das outras telas.
 *
 * O ALCANCE é o mesmo do resto do app — `accessiblePropertyIds` já resolve
 * empresa (conta inteira), proprietário (só os imóveis dele) e prestador
 * (só as residências que atende). Nada aqui recorta por perfil "na mão":
 * quem enxerga menos imóveis conta menos registros, inclusive nos
 * contadores das categorias.
 * ---------------------------------------------------------------------- */

/** Teto de linhas lidas. Cobre com folga o histórico de uma conta madura e
 * mantém a leitura em UMA consulta — os contadores por categoria saem da
 * mesma leitura, sem uma segunda ida ao banco. */
const ACCOUNT_RECORDS_SCAN_LIMIT = 2000;
/** Teto de linhas DEVOLVIDAS (e, portanto, de URLs assinadas em lote). */
const ACCOUNT_RECORDS_PAGE = 300;

export type AccountRecord = ReservationRecord & {
  propertyId: string;
  propertyName: string;
  ownerName: string | null;
  /** Comprovação de resolução anexada a uma pendência. */
  isResolution: boolean;
  /** Título da pendência gerada, quando houver. */
  taskTitle: string | null;
  /**
   * IDENTIDADE DA RESERVA — é por ela que a aba agrupa os registros no filtro
   * "Todos". Vem de `guide_access_logs` (formulário do hóspede: nome, código
   * e as duas datas) e, quando o registro só tem `reservation_id`, do próprio
   * `property_reservations` (iCal: só a dica de nome e as datas).
   *
   * `reservationKey` vazio = registro preso apenas ao imóvel ou a uma
   * pendência. Esses caem no grupo "Sem reserva" — nada some.
   */
  reservationKey: string | null;
  guestName: string | null;
  reservationCode: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
  /**
   * TODAS as mídias da situação, em ordem cronológica — a própria incluída.
   * Uma situação com quatro fotos é UMA linha na tela com quatro mídias
   * dentro, não quatro linhas (ver `createRecordSituation`).
   */
  media: RecordMedia[];
};

export type RecordMedia = {
  id: string;
  kind: ReservationRecord["kind"];
  storagePath: string | null;
  url: string | null;
  mime: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  createdAt: string;
};

export type AccountRecordsResult = {
  records: AccountRecord[];
  /** Total por categoria em TODO o histórico visível (alimenta os chips). */
  counts: Record<RecordCategory, number>;
  /** Quantos, por categoria, ainda têm pendência em aberto. */
  openCounts: Record<RecordCategory, number>;
  total: number;
  totalOpen: number;
  /** true quando o histórico passou do teto de leitura. */
  truncated: boolean;
};

function emptyCounts(): Record<RecordCategory, number> {
  return { forgotten: 0, damage: 0, cleaning_audit: 0, maintenance: 0, other: 0 };
}

export const listAccountRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: unknown) =>
      z
        .object({
          ownerId: z.string().uuid().nullable().optional(),
          /** Vazio = todas as categorias. */
          category: CategoryEnum.nullable().optional(),
          /** Só os que ainda têm pendência em aberto. */
          onlyOpen: z.boolean().optional(),
          /** Janela em dias. Vazio/0 = TODO o histórico (padrão pedido). */
          days: z.number().int().positive().max(3650).nullable().optional(),
          /**
           * Recorte por imóvel. O filtro de PROPRIETÁRIO também chega aqui,
           * já resolvido para a lista de imóveis dele — assim os contadores
           * por categoria refletem o recorte, em vez de continuarem contando
           * a conta inteira enquanto a lista mostra um imóvel só.
           */
          propertyIds: z.array(z.string().uuid()).max(500).nullable().optional(),
        })
        .optional()
        .parse(i) ?? {},
  )
  .handler(async ({ data, context }): Promise<AccountRecordsResult> => {
    const supabase = context.supabase as unknown as AnyClient;
    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const accessible = await accessiblePropertyIds(
      context.supabase as never,
      data.ownerId ?? null,
      context.userId,
    );
    // O recorte pedido pelo usuário nunca AMPLIA o alcance: é sempre uma
    // interseção com o que o perfil já podia ver.
    const requested = data.propertyIds ?? null;
    const propIds =
      requested && requested.length > 0
        ? accessible.filter((id) => requested.includes(id))
        : accessible;
    const empty: AccountRecordsResult = {
      records: [],
      counts: emptyCounts(),
      openCounts: emptyCounts(),
      total: 0,
      totalOpen: 0,
      truncated: false,
    };
    if (propIds.length === 0) return empty;

    let scan = supabase
      .from("reservation_records")
      .select(
        "id, group_id, property_id, log_id, reservation_id, kind, category, storage_path, mime, size_bytes, duration_ms, file_name, body, card_mode, created_by_name, created_at, task_id, is_resolution",
      )
      .in("property_id", propIds);
    if (data.days) {
      scan = scan.gte("created_at", new Date(Date.now() - data.days * 86_400_000).toISOString());
    }
    const { data: rows, error } = await scan
      .order("created_at", { ascending: false })
      .limit(ACCOUNT_RECORDS_SCAN_LIMIT);
    if (error) throw new Error(error.message);

    const all = (rows ?? []) as Array<{
      id: string;
      group_id: string | null;
      property_id: string;
      log_id: string | null;
      reservation_id: string | null;
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
      is_resolution: boolean;
    }>;
    if (all.length === 0) return empty;

    // Status das pendências geradas — lido de `tasks`, nunca copiado: o que
    // define "em aberto" é a pendência, não uma cópia guardada aqui.
    const taskIds = Array.from(new Set(all.map((r) => r.task_id).filter((v): v is string => !!v)));
    const taskById = new Map<
      string,
      { status: "pending" | "done" | "canceled"; title: string | null }
    >();
    if (taskIds.length > 0) {
      const { data: taskRows } = await supabase
        .from("tasks")
        .select("id, status, title")
        .in("id", taskIds);
      for (const t of (taskRows ?? []) as Array<{
        id: string;
        status: "pending" | "done" | "canceled";
        title: string | null;
      }>) {
        taskById.set(t.id, { status: t.status, title: t.title });
      }
    }

    const isOpen = (taskId: string | null) =>
      !!taskId && (taskById.get(taskId)?.status ?? null) === "pending";

    /* UMA SITUAÇÃO = UMA LINHA NA TELA. As linhas vêm da mais nova para a
     * mais velha; juntamos por `group_id` (registros antigos não têm grupo e
     * viram grupos de um só) e elegemos a PRINCIPAL — a que tem `id =
     * group_id`, ou, se ela tiver sido apagada, a mais antiga que sobrou.
     * Os contadores das categorias contam situações, que é o que o usuário
     * conta com o olho. */
    const byGroup = new Map<string, typeof all>();
    for (const r of all) {
      const key = r.group_id ?? r.id;
      const list = byGroup.get(key);
      if (list) list.push(r);
      else byGroup.set(key, [r]);
    }
    const primaries: typeof all = [];
    const mediaByGroup = new Map<string, RecordMedia[]>();
    for (const [key, list] of byGroup) {
      const primary = list.find((r) => r.id === key) ?? list[list.length - 1];
      primaries.push(primary);
      const media = [...list]
        .filter((r) => !!r.storage_path)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          storagePath: r.storage_path,
          url: null as string | null,
          mime: r.mime,
          durationMs: r.duration_ms,
          sizeBytes: r.size_bytes,
          createdAt: r.created_at,
        }));
      mediaByGroup.set(key, media);
    }
    primaries.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const counts = emptyCounts();
    const openCounts = emptyCounts();
    for (const r of primaries) {
      if (counts[r.category] === undefined) continue;
      counts[r.category] += 1;
      if (isOpen(r.task_id)) openCounts[r.category] += 1;
    }

    const selected = primaries
      .filter((r) => (data.category ? r.category === data.category : true))
      .filter((r) => (data.onlyOpen ? isOpen(r.task_id) : true))
      .slice(0, ACCOUNT_RECORDS_PAGE);

    // IDENTIDADE DA RESERVA das linhas que vão aparecer. Duas fontes, na
    // ordem de confiança: o formulário do hóspede (`guide_access_logs`, que
    // tem nome, código e as duas datas) e, na falta dele, a reserva importada
    // (`property_reservations`, que só tem a dica de nome e as datas).
    const logIds = Array.from(
      new Set(selected.map((r) => r.log_id).filter((v): v is string => !!v)),
    );
    const resIds = Array.from(
      new Set(selected.map((r) => r.reservation_id).filter((v): v is string => !!v)),
    );
    type ResInfo = {
      guestName: string | null;
      code: string | null;
      checkin: string | null;
      checkout: string | null;
    };
    const resByLog = new Map<string, ResInfo>();
    const resByRes = new Map<string, ResInfo>();
    const iso = (v: unknown) => (v ? String(v).slice(0, 10) : null);
    if (logIds.length > 0) {
      const { data: logs } = await supabase
        .from("guide_access_logs")
        .select("id, guest_name, reservation_code, checkin_date, checkout_date")
        .in("id", logIds);
      for (const l of (logs ?? []) as Array<{
        id: string;
        guest_name: string | null;
        reservation_code: string | null;
        checkin_date: string | null;
        checkout_date: string | null;
      }>) {
        resByLog.set(l.id, {
          guestName: (l.guest_name ?? "").trim() || null,
          code: (l.reservation_code ?? "").trim() || null,
          checkin: iso(l.checkin_date),
          checkout: iso(l.checkout_date),
        });
      }
    }
    if (resIds.length > 0) {
      const { data: res } = await supabase
        .from("property_reservations")
        .select("id, guest_hint, checkin_date, checkout_date")
        .in("id", resIds);
      for (const r of (res ?? []) as Array<{
        id: string;
        guest_hint: string | null;
        checkin_date: string | null;
        checkout_date: string | null;
      }>) {
        resByRes.set(r.id, {
          guestName: (r.guest_hint ?? "").trim() || null,
          code: null,
          checkin: iso(r.checkin_date),
          checkout: iso(r.checkout_date),
        });
      }
    }

    // Imóvel + proprietário só das linhas que vão de fato aparecer.
    const usedPropIds = Array.from(new Set(selected.map((r) => r.property_id)));
    const propById = new Map<string, { name: string; ownerContactId: string | null }>();
    if (usedPropIds.length > 0) {
      const { data: props } = await supabase
        .from("properties")
        .select("id, name, owner_contact_id")
        .in("id", usedPropIds);
      for (const p of (props ?? []) as Array<{
        id: string;
        name: string | null;
        owner_contact_id: string | null;
      }>) {
        propById.set(p.id, { name: p.name ?? "Sem nome", ownerContactId: p.owner_contact_id });
      }
    }
    const ownerIds = Array.from(
      new Set(
        Array.from(propById.values())
          .map((p) => p.ownerContactId)
          .filter((v): v is string => !!v),
      ),
    );
    const ownerNameById = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await supabase
        .from("property_owners")
        .select("id, name, trade_name")
        .in("id", ownerIds);
      for (const o of (owners ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
      }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) ownerNameById.set(o.id, label);
      }
    }

    // Mesmo lote único de assinaturas usado em listReservationRecords — agora
    // cobrindo TODAS as mídias das situações que vão aparecer, e não só a
    // principal, porque o visualizador navega entre elas. A capa de cada
    // situação (a primeira mídia) entra antes das demais, para que um teto
    // atingido tire as fotos do fim do carrossel, nunca a capa da lista.
    const MAX_SIGNED = 900;
    const coverPaths: string[] = [];
    const extraPaths: string[] = [];
    for (const r of selected) {
      const media = mediaByGroup.get(r.group_id ?? r.id) ?? [];
      media.forEach((m, i) => {
        if (!m.storagePath) return;
        (i === 0 ? coverPaths : extraPaths).push(m.storagePath);
      });
      if (r.storage_path && !media.some((m) => m.storagePath === r.storage_path)) {
        coverPaths.push(r.storage_path);
      }
    }
    const paths = Array.from(new Set([...coverPaths, ...extraPaths])).slice(0, MAX_SIGNED);
    const urlByPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGN_TTL_SECONDS);
      for (const s of (signed ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
      }
    }

    const records: AccountRecord[] = selected.map((r) => {
      const prop = propById.get(r.property_id);
      const task = r.task_id ? (taskById.get(r.task_id) ?? null) : null;
      const res =
        (r.log_id ? resByLog.get(r.log_id) : undefined) ??
        (r.reservation_id ? resByRes.get(r.reservation_id) : undefined) ??
        null;
      // A chave do grupo é o vínculo, não o nome: dois hóspedes homônimos em
      // reservas diferentes continuam sendo dois pacotes.
      const reservationKey = r.log_id ?? r.reservation_id ?? null;
      const media = (mediaByGroup.get(r.group_id ?? r.id) ?? []).map((m) => ({
        ...m,
        url: m.storagePath ? (urlByPath.get(m.storagePath) ?? null) : null,
      }));
      return {
        id: r.id,
        groupId: r.group_id,
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
        taskStatus: task?.status ?? null,
        propertyId: r.property_id,
        propertyName: prop?.name ?? "Sem nome",
        ownerName: prop?.ownerContactId ? (ownerNameById.get(prop.ownerContactId) ?? null) : null,
        isResolution: r.is_resolution,
        taskTitle: task?.title ?? null,
        reservationKey,
        guestName: res?.guestName ?? null,
        reservationCode: res?.code ?? null,
        checkinDate: res?.checkin ?? null,
        checkoutDate: res?.checkout ?? null,
        media,
      };
    });

    const total = primaries.length;
    const totalOpen = Object.values(openCounts).reduce((a, b) => a + b, 0);
    return {
      records,
      counts,
      openCounts,
      total,
      totalOpen,
      truncated: all.length >= ACCOUNT_RECORDS_SCAN_LIMIT,
    };
  });
