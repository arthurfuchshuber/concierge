import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isPendingCategory } from "@/lib/record-pending";

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
 * URLS ASSINADAS ESTÁVEIS (03/10/2026: "as imagens demoram, deveria ser
 * instantâneo").
 *
 * Cada leitura da aba assinava tudo de novo, e uma assinatura nova é uma URL
 * nova — o navegador não reconhece como a mesma imagem e baixa de novo. Como a
 * aba relê a cada minuto, ao voltar para a aba e a cada aviso ao vivo, os
 * quadradinhos recarregavam sem parar. Aqui a URL de um arquivo é reaproveitada
 * enquanto ainda tiver folga de validade: mesma URL ⇒ cache do navegador ⇒
 * imagem na hora (e uma ida a menos ao storage).
 *
 * O cache é do processo (cada instância tem o seu); só guarda caminhos que o
 * chamador já checou que a pessoa pode ver, e some sozinho ao vencer.
 */
const SIGNED_URL_CACHE = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_MIN_REMAINING_MS = 15 * 60_000;
const SIGNED_URL_CACHE_MAX = 5000;

async function signPathsCached(supabase: AnyClient, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const missing: string[] = [];
  for (const p of paths) {
    const hit = SIGNED_URL_CACHE.get(p);
    if (hit && hit.expiresAt - now > SIGNED_URL_MIN_REMAINING_MS) out.set(p, hit.url);
    else missing.push(p);
  }
  if (missing.length === 0) return out;
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(missing, SIGN_TTL_SECONDS);
  const expiresAt = now + SIGN_TTL_SECONDS * 1000;
  for (const s of (signed ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
    if (!s.path || !s.signedUrl) continue;
    out.set(s.path, s.signedUrl);
    SIGNED_URL_CACHE.set(s.path, { url: s.signedUrl, expiresAt });
  }
  if (SIGNED_URL_CACHE.size > SIGNED_URL_CACHE_MAX) {
    for (const [k, v] of SIGNED_URL_CACHE) if (v.expiresAt <= now) SIGNED_URL_CACHE.delete(k);
    // Ainda grande: descarta as mais antigas (Map preserva a ordem de inserção).
    for (const k of SIGNED_URL_CACHE.keys()) {
      if (SIGNED_URL_CACHE.size <= SIGNED_URL_CACHE_MAX) break;
      SIGNED_URL_CACHE.delete(k);
    }
  }
  return out;
}

/**
 * Categorias na ORDEM definida pelo cliente (07/09/2026) — a mesma ordem em
 * que aparecem no seletor que abre ANTES da câmera/gravação.
 */
export const RECORD_CATEGORIES = [
  "forgotten",
  "damage",
  "incident",
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
/** Marca das pendências que o próprio registro abriu — só essas somem junto. */
const DESCRICAO_PENDENCIA_AUTOMATICA = "Aberta automaticamente a partir de um registro da reserva.";

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
    prefix: "Dano",
  },
  incident: {
    taskCategory: "inspection",
    priority: "high",
    showInCleaning: false,
    prefix: "Incidente",
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
    /**
     * A COLUNA ONDE O REGISTRO NASCEU. É ela que decide se a pendência entra
     * no checklist da limpeza — ver `show_in_cleaning` no insert abaixo.
     */
    cardMode?: z.infer<typeof CardMode>;
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
      description: DESCRICAO_PENDENCIA_AUTOMATICA,
      category: rule.taskCategory,
      priority: rule.priority,
      due_date: null,
      /* "APARECE NA LIMPEZA" SEGUE A ORIGEM, NÃO SÓ A CATEGORIA (pedido
         explícito, 18/09/2026: "tudo que a própria limpeza abre deve ser
         marcado como 'aparecer na limpeza' automaticamente para que ela faça
         o acompanhamento").

         Antes valia só a categoria, e por isso um DANO registrado pela
         própria faxineira, na coluna de Limpeza, nascia invisível para ela:
         das 8 pendências abertas da Casa Charmosa, 7 eram dano e o checklist
         mostrava 1. Quem abriu na limpeza está dizendo "isto é para a próxima
         faxina olhar" — a categoria descreve o QUE é, não PARA QUEM é.

         Fora da limpeza, o padrão da categoria continua valendo, e o usuário
         interno continua podendo desmarcar no formulário; desmarcada, não
         aparece no checklist. */
      show_in_cleaning: input.cardMode === "cleaning" ? true : rule.showInCleaning,
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
      cardMode: data.cardMode,
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
      cardMode: data.cardMode,
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
        /* Vazio quando o registro nasce no "+" da página Registros: não veio de
         * nenhuma coluna do Kanban (ver migração 20261005130000). */
        cardMode: CardMode.optional().nullable(),
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
      // Sem reserva e sem registro do hóspede = registro só do IMÓVEL ("+" da
      // página Registros). Só vale sem coluna de origem (cardMode vazio).
      .refine((v) => !!v.logId || !!v.reservationId || !v.cardMode, {
        message: "Informe a reserva ou o registro do hóspede.",
      })
      // TÍTULO SEMPRE OBRIGATÓRIO (decisão do cliente, 25/09/2026).
      .transform((v) => {
        if (!(v.title ?? "").trim()) {
          throw new Error("Escreva um título antes de registrar — em poucas palavras, o que aconteceu.");
        }
        return v;
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;

    // Mesma checagem de caminho do anexo avulso, para cada mídia.
    for (const m of data.media) {
      if (!m.path.startsWith(`${data.propertyId}/`)) throw new Error("Caminho de anexo inválido.");
    }

    // A reserva escolhida precisa ser do imóvel escolhido (o "+" deixa
    // escolher as duas coisas separadamente).
    if (data.reservationId) {
      const { data: resRow } = await supabase
        .from("property_reservations")
        .select("id")
        .eq("id", data.reservationId)
        .eq("property_id", data.propertyId)
        .maybeSingle();
      if (!resRow) throw new Error("Essa reserva não pertence ao imóvel escolhido.");
    }

    const body = composeBody(data.title, data.description);
    const who = await resolveAuthorName(supabase, context.userId);
    const taskId = await createLinkedTask(supabase, context.userId, {
      category: data.category,
      propertyId: data.propertyId,
      logId: data.logId,
      reservationId: data.reservationId,
      body: (data.title ?? "").trim() || null,
      cardMode: data.cardMode ?? undefined,
    });
    const fileName = await nextRecordName(supabase, data.propertyId);
    const groupId = crypto.randomUUID();

    const base = {
      property_id: data.propertyId,
      log_id: data.logId ?? null,
      reservation_id: data.reservationId ?? null,
      category: data.category,
      card_mode: data.cardMode ?? null,
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
        ? // Só mídia a caminho e sem texto: a principal nasce com corpo vazio
          // ("" e não null) para respeitar a regra do banco que exige
          // arquivo ou texto — as mídias entram logo depois no mesmo grupo.
          [{ ...base, id: groupId, kind: "note", body: body ?? "" }]
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
    return { ok: true, taskCreated: !!taskId, taskId, fileName, groupId };
  });

/**
 * "DESFAZER" de uma situação registrada (17/09/2026): tira a situação
 * inteira — todas as mídias do grupo, os arquivos e a pendência que ela
 * abriu. A pendência só sai se foi esta pessoa que a criou; o RLS das duas
 * tabelas decide o resto.
 */
export const undoRecordSituation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ groupId: z.string().uuid(), taskId: z.string().uuid().nullable().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    const { data: rows, error } = await supabase
      .from("reservation_records")
      .select("id, storage_path")
      .or(`id.eq.${data.groupId},group_id.eq.${data.groupId}`);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ id: string; storage_path: string | null }>;
    if (list.length > 0) {
      const { error: delErr } = await supabase
        .from("reservation_records")
        .delete()
        .in(
          "id",
          list.map((r) => r.id),
        );
      if (delErr) throw new Error(delErr.message);
      const paths = list.map((r) => r.storage_path).filter((p): p is string => !!p);
      if (paths.length > 0) {
        try {
          await supabase.storage.from(BUCKET).remove(paths);
        } catch {
          // ignore
        }
      }
    }
    if (data.taskId) {
      await supabase.from("tasks").delete().eq("id", data.taskId).eq("created_by", context.userId);
    }
    return { ok: true };
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
      card_mode: string | null;
      file_name: string | null;
    } | null;
    if (!p) throw new Error("Situação não encontrada.");
    if (p.property_id !== data.propertyId) throw new Error("Situação de outro imóvel.");

    /* ANEXAR DUAS VEZES O MESMO ARQUIVO NÃO PODE CRIAR DOIS REGISTROS
     * (20/09/2026).
     *
     * Em rede móvel a resposta desta chamada se perde: o aparelho tenta de
     * novo (até três vezes) sem saber que a primeira gravou. Foi assim que um
     * único vídeo virou quatro cartões iguais na tela da equipe. O caminho no
     * armazenamento é único por arquivo, então ele é a chave de idempotência:
     * se já existe linha com este caminho, a mídia já está anexada. */
    const { data: jaExiste } = await supabase
      .from("reservation_records")
      .select("id")
      .eq("storage_path", data.path)
      .limit(1)
      .maybeSingle();
    if (jaExiste) return { ok: true, duplicate: true };

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
    // Corrida entre duas tentativas simultâneas: o índice único do caminho
    // barra a segunda. Isso é sucesso, não erro — a mídia está anexada.
    if (error && (error as { code?: string }).code === "23505") {
      return { ok: true, duplicate: true };
    }
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
    const { data: inserted, error } = await supabase
      .from("reservation_records")
      .insert({
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
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // O id volta para o "Desfazer" da conclusão conseguir retirar o anexo.
    return { ok: true, id: (inserted as { id: string }).id };
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
 *
 * DESFAZER (17/09/2026): com `keepFile`, o arquivo fica no storage durante
 * os 5s do botão "Desfazer" e a linha apagada volta para o cliente. Se a
 * pessoa desfizer, `restoreReservationRecord` recoloca a linha; se não,
 * `purgeRecordFile` apaga o arquivo quando a janela fecha.
 */
const RECORD_RESTORE_COLUMNS =
  "id, property_id, log_id, reservation_id, kind, storage_path, mime, size_bytes, duration_ms, file_name, body, card_mode, created_by, created_by_name, created_at, category, task_id, is_resolution, group_id";

const RemovedRecordSchema = z.object({
  id: z.string().uuid(),
  property_id: z.string().uuid(),
  log_id: z.string().uuid().nullable(),
  reservation_id: z.string().uuid().nullable(),
  kind: z.string().max(20),
  storage_path: z.string().max(500).nullable(),
  mime: z.string().max(150).nullable(),
  size_bytes: z.number().int().nonnegative().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  file_name: z.string().max(300).nullable(),
  body: z.string().max(10000).nullable(),
  card_mode: z.string().max(40).nullable(),
  created_by: z.string().uuid().nullable(),
  created_by_name: z.string().max(200).nullable(),
  created_at: z.string(),
  category: z.string().max(40),
  task_id: z.string().uuid().nullable(),
  is_resolution: z.boolean(),
  group_id: z.string().uuid().nullable(),
});
export type RemovedRecord = z.infer<typeof RemovedRecordSchema>;

/**
 * A PENDÊNCIA MORRE COM O REGISTRO (19/09/2026, pedido do cliente com print:
 * "o checklist de pendências não está replicando fielmente a lista de
 * registros — ao excluir algum, ele não atualiza no card de limpeza").
 *
 * Antes, apagar o registro deixava a pendência que ele criou viva: o card da
 * limpeza continuava cobrando uma coisa que já não existia em lugar nenhum.
 * Agora a pendência é apagada junto, com três travas: só se AINDA ESTIVER EM
 * ABERTO (uma já concluída é histórico de gasto/execução, não some), só se
 * NENHUM outro registro apontar para ela, e ela volta inteira se a pessoa
 * tocar em "Desfazer".
 */
const TASK_COLUMNS = [
  "id",
  "account_owner_id",
  "property_id",
  "log_id",
  "reservation_id",
  "owner_contact_id",
  "title",
  "description",
  "category",
  "priority",
  "status",
  "due_date",
  "recurrence_days",
  "show_in_cleaning",
  "amount_spent_cents",
  "cost_payer",
  "cost_payer_id",
  "paid_by",
  "paid_by_id",
  "amount_paid_cents",
  "resolved_by_provider_id",
  "resolution_note",
  "completed_at",
  "created_at",
  "created_by",
  "updated_at",
] as const;

export type RemovedTask = Record<string, string | number | boolean | null>;

/**
 * EXCLUIR = LIXEIRA OCULTA DE 30 DIAS (pedido explícito, 04/10/2026).
 *
 * O registro some NA HORA de todo o sistema (sai de `reservation_records`,
 * então aba Registros, clipe da reserva, contadores e card de limpeza deixam
 * de enxergá-lo) e uma cópia completa — linhas do grupo, pendência automática
 * que morreu junto e caminhos dos arquivos — vai para
 * `reservation_records_trash`, que NINGUÉM lê pelo navegador. Os arquivos
 * ficam no storage; a varredura diária (`purgeExpiredRecordTrash`) apaga de
 * vez o que passou de 30 dias.
 *
 * O QUE ESTAVA ERRADO ("ao clicar em excluir ele sai e volta"): o botão do
 * visualizador mandava só o id da linha PRINCIPAL. Numa situação com 2+
 * mídias a principal tem irmãs, e a regra de "apagar uma foto nunca apaga a
 * situação" só tirava o arquivo dela e mantinha a linha viva — o refresh
 * trazia o registro de volta. Agora a tela manda o grupo inteiro numa única
 * chamada e o servidor decide com o grupo todo à vista (sem corrida entre
 * apagamentos paralelos). A regra da foto avulsa continua valendo: só quando
 * sobram irmãs FORA do que está sendo excluído.
 *
 * Além disso o apagamento agora é conferido (`select` do que saiu): uma
 * política de RLS que barre em silêncio vira erro na tela, não um registro
 * que "volta sozinho".
 */
export const deleteReservationRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; ids?: string[]; keepFile?: boolean }) =>
    z
      .object({
        id: z.string().uuid().optional(),
        ids: z.array(z.string().uuid()).max(100).optional(),
        // Mantido por compatibilidade: o arquivo agora SEMPRE fica na lixeira.
        keepFile: z.boolean().optional(),
      })
      .refine((v) => !!v.id || (v.ids?.length ?? 0) > 0, "Informe o registro.")
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    const wanted = Array.from(new Set([...(data.id ? [data.id] : []), ...(data.ids ?? [])]));

    const { data: found } = await supabase
      .from("reservation_records")
      .select(RECORD_RESTORE_COLUMNS)
      .in("id", wanted);
    const existing = (found ?? []) as RemovedRecord[];
    if (existing.length === 0) {
      return {
        ok: true,
        trashId: null as string | null,
        removed: [] as RemovedRecord[],
        removedTasks: [] as RemovedTask[],
      };
    }

    /* Linhas principais (`id = group_id` de alguém) que ainda teriam irmãs
       vivas FORA desta exclusão: só perdem a mídia e viram o texto do grupo. */
    const wantedSet = new Set(existing.map((r) => r.id));
    const { data: filhas } = await supabase
      .from("reservation_records")
      .select("id, group_id")
      .in("group_id", existing.map((r) => r.id));
    const comIrmasFora = new Set<string>();
    for (const f of (filhas ?? []) as Array<{ id: string; group_id: string | null }>) {
      if (f.group_id && f.id !== f.group_id && !wantedSet.has(f.id)) comIrmasFora.add(f.group_id);
    }

    const toStrip = existing.filter((r) => comIrmasFora.has(r.id));
    const toDelete = existing.filter((r) => !comIrmasFora.has(r.id));

    const gone: RemovedRecord[] = [];
    if (toDelete.length > 0) {
      const { data: apagadas, error } = await supabase
        .from("reservation_records")
        .delete()
        .in(
          "id",
          toDelete.map((r) => r.id),
        )
        .select("id");
      if (error) throw new Error(error.message);
      const apagadasIds = new Set(((apagadas ?? []) as Array<{ id: string }>).map((a) => a.id));
      for (const r of toDelete) if (apagadasIds.has(r.id)) gone.push(r);
    }
    const stripped: RemovedRecord[] = [];
    for (const r of toStrip) {
      const { data: tiradas, error: stripErr } = await supabase
        .from("reservation_records")
        .update({
          kind: "note",
          storage_path: null,
          mime: null,
          size_bytes: null,
          duration_ms: null,
          file_name: null,
        })
        .eq("id", r.id)
        .select("id");
      if (stripErr) throw new Error(stripErr.message);
      if ((tiradas ?? []).length > 0) stripped.push(r);
    }

    if (gone.length + stripped.length === 0) {
      throw new Error("Não foi possível excluir: sem permissão para este registro.");
    }

    /* PENDÊNCIA AUTOMÁTICA MORRE JUNTO (19/09/2026) — só em aberto, só se
       nenhum outro registro aponta para ela, só a que o registro abriu. */
    const removedTasks: RemovedTask[] = [];
    const taskIds = Array.from(
      new Set(gone.map((r) => r.task_id).filter((t): t is string => !!t)),
    );
    for (const taskId of taskIds) {
      const { data: outros } = await supabase
        .from("reservation_records")
        .select("id")
        .eq("task_id", taskId)
        .limit(1);
      if ((outros ?? []).length > 0) continue;
      const { data: task } = await supabase
        .from("tasks")
        .select(TASK_COLUMNS.join(", "))
        .eq("id", taskId)
        .maybeSingle();
      if (!task) continue;
      const automatica =
        (task as { description?: string | null }).description === DESCRICAO_PENDENCIA_AUTOMATICA;
      if (!automatica || (task as { status?: string }).status !== "pending") continue;
      const { data: tarefaApagada, error: delErr } = await supabase
        .from("tasks")
        .delete()
        .eq("id", taskId)
        .select("id");
      if (!delErr && (tarefaApagada ?? []).length > 0) removedTasks.push(task as RemovedTask);
    }

    /* LIXEIRA: cópia completa por 30 dias. Se não conseguir guardar, DESFAZ
       o apagamento — nunca perder um registro sem cópia. */
    const removed = [...gone, ...stripped];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as AnyClient;
    const { data: lixo, error: trashErr } = await admin
      .from("reservation_records_trash")
      .insert({
        property_id: removed[0].property_id,
        records: removed,
        tasks: removedTasks,
        storage_paths: removed.map((r) => r.storage_path).filter((p): p is string => !!p),
        deleted_by: (context as unknown as { userId?: string }).userId ?? null,
      })
      .select("id")
      .single();
    if (trashErr || !lixo) {
      if (removedTasks.length > 0) {
        await supabase.from("tasks").upsert(removedTasks, { onConflict: "id" });
      }
      await supabase.from("reservation_records").upsert(removed, { onConflict: "id" });
      const faltaTabela = /reservation_records_trash|schema cache|does not exist|42P01|PGRST205/i.test(
        trashErr?.message ?? "",
      );
      throw new Error(
        faltaTabela
          ? "A lixeira de registros ainda não existe no banco. Aplique a migração da lixeira e tente de novo — nada foi apagado."
          : "Não foi possível guardar a cópia na lixeira, então nada foi apagado. Tente de novo.",
      );
    }

    return {
      ok: true,
      trashId: (lixo as { id: string }).id as string | null,
      removed,
      removedTasks,
    };
  });

/** "Desfazer" da exclusão: as mesmas linhas, com os mesmos ids, de volta — e,
 *  se a pendência tiver ido junto, ela volta antes (o registro aponta para
 *  ela). Tira também a cópia da lixeira. */
export const restoreReservationRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        trashId: z.string().uuid().nullish(),
        removed: z.array(RemovedRecordSchema).min(1).max(100),
        removedTasks: z
          .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
          .max(100)
          .nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    for (const task of data.removedTasks ?? []) {
      // Só as colunas conhecidas da tabela — nada que venha do navegador
      // entra numa coluna que não seja essa lista.
      const linha: Record<string, string | number | boolean | null> = {};
      for (const col of TASK_COLUMNS) {
        if (col in task) linha[col] = task[col];
      }
      if (linha.id) await supabase.from("tasks").upsert(linha, { onConflict: "id" });
    }
    const { error } = await supabase
      .from("reservation_records")
      .upsert(data.removed, { onConflict: "id" });
    if (error) throw new Error(error.message);
    if (data.trashId) {
      // Só tira da lixeira a cópia do MESMO imóvel que acabou de voltar (o
      // upsert acima já passou pela checagem de acesso ao imóvel).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await (supabaseAdmin as unknown as AnyClient)
        .from("reservation_records_trash")
        .delete()
        .eq("id", data.trashId)
        .eq("property_id", data.removed[0].property_id);
    }
    return { ok: true };
  });

/**
 * Fim da janela do "Desfazer": apaga o arquivo que ficou guardado. Só apaga
 * se nenhum registro aponta mais para ele e se o imóvel do caminho é um que
 * a pessoa enxerga — um caminho qualquer vindo do navegador não apaga nada.
 */
export const purgeRecordFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ storagePath: z.string().min(3).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    const propertyId = data.storagePath.split("/")[0] ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(propertyId)) return { ok: true, removed: false };
    const [{ data: prop }, { data: refs }] = await Promise.all([
      supabase.from("properties").select("id").eq("id", propertyId).maybeSingle(),
      supabase
        .from("reservation_records")
        .select("id")
        .eq("storage_path", data.storagePath)
        .limit(1),
    ]);
    if (!prop || (refs ?? []).length > 0) return { ok: true, removed: false };
    try {
      await supabase.storage.from(BUCKET).remove([data.storagePath]);
    } catch {
      // ignore
    }
    return { ok: true, removed: true };
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
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  /**
   * Capa do imóvel (`properties.hero_image_url`), a MESMA foto do cartão de
   * Guias. Dado de exibição para o cartão de Registros (04/10/2026, proposta
   * A: "foto à esquerda como em Guias"); não entra em nenhuma regra.
   */
  propertyCoverUrl?: string | null;
  /** Capa + galeria, em ordem de tentativa (ver `CoverImage`). */
  propertyCoverUrls?: string[];
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

/**
 * UMA PENDÊNCIA EM ABERTO, em forma enxuta — alimenta o tooltip do "Ver só
 * elas" (resumo por urgência e por imóvel). Vem da MESMA leitura dos
 * contadores, sem o teto de linhas da lista: o tooltip sempre fecha com o
 * número da faixa.
 */
export type PendingItem = {
  id: string;
  propertyId: string;
  propertyName: string;
  category: RecordCategory;
  title: string;
  createdAt: string;
  /** Proprietário do imóvel (para a linha "Proprietário(a): nome" + mensagem). */
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
};

export type AccountRecordsResult = {
  records: AccountRecord[];
  /** Total por categoria em TODO o histórico visível (alimenta os chips). */
  counts: Record<RecordCategory, number>;
  /** Quantos, por categoria, ainda têm pendência em aberto. */
  openCounts: Record<RecordCategory, number>;
  total: number;
  totalOpen: number;
  /**
   * PENDÊNCIAS EM ABERTO (dano + manutenção + incidente, ver `record-pending`)
   * e em quantos imóveis. É o número da faixa de alerta da tela — sai da MESMA
   * leitura dos contadores, sem depender do que coube na lista (teto de 300
   * linhas, categoria selecionada ou busca) e, por isso, sempre fecha com a
   * soma das "em aberto" dos cartões.
   */
  pendingOpen: number;
  pendingProperties: number;
  /** As pendências em aberto, da mais antiga para a mais nova. */
  pendingItems: PendingItem[];
  /** true quando o histórico passou do teto de leitura. */
  truncated: boolean;
  /** Primeiro/último dia (SP) com registro no recorte de imóveis — limita o calendário. */
  bounds?: { min: string | null; max: string | null };
};

function emptyCounts(): Record<RecordCategory, number> {
  return { forgotten: 0, damage: 0, incident: 0, cleaning_audit: 0, maintenance: 0, other: 0 };
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
          /** Período por datas (dia local de São Paulo, AAAA-MM-DD), igual à Limpeza. */
          fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
          toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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
      pendingOpen: 0,
      pendingProperties: 0,
      pendingItems: [],
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
    if (data.fromDate) scan = scan.gte("created_at", new Date(`${data.fromDate}T00:00:00-03:00`).toISOString());
    if (data.toDate) scan = scan.lte("created_at", new Date(`${data.toDate}T23:59:59.999-03:00`).toISOString());
    const spDay = (iso: string | undefined) =>
      iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : null;
    const [firstQ, lastQ] = await Promise.all([
      supabase.from("reservation_records").select("created_at").in("property_id", propIds).order("created_at", { ascending: true }).limit(1),
      supabase.from("reservation_records").select("created_at").in("property_id", propIds).order("created_at", { ascending: false }).limit(1),
    ]);
    const bounds = {
      min: spDay((firstQ.data as Array<{ created_at: string }> | null)?.[0]?.created_at),
      max: spDay((lastQ.data as Array<{ created_at: string }> | null)?.[0]?.created_at),
    };
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
    const pendingPropertyIds = new Set<string>();
    const pendingRows: typeof all = [];
    for (const r of primaries) {
      if (counts[r.category] === undefined) continue;
      counts[r.category] += 1;
      if (isOpen(r.task_id)) {
        openCounts[r.category] += 1;
        if (isPendingCategory(r.category)) {
          pendingPropertyIds.add(r.property_id);
          pendingRows.push(r);
        }
      }
    }

    // "Ver só elas" mostra exatamente o que a faixa conta: pendência em aberto
    // das categorias de trabalho — não qualquer registro com tarefa aberta.
    const selected = primaries
      .filter((r) => (data.category ? r.category === data.category : true))
      .filter((r) => (data.onlyOpen ? isOpen(r.task_id) && isPendingCategory(r.category) : true))
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
    const usedPropIds = Array.from(
      new Set([...selected.map((r) => r.property_id), ...pendingRows.map((r) => r.property_id)]),
    );
    const propById = new Map<string, { name: string; ownerContactId: string | null; coverUrl: string | null; coverUrls: string[] }>();
    if (usedPropIds.length > 0) {
      const { data: props } = await supabase
        .from("properties")
        .select("id, name, owner_contact_id, hero_image_url, gallery_images")
        .in("id", usedPropIds);
      for (const p of (props ?? []) as Array<{
        id: string;
        name: string | null;
        owner_contact_id: string | null;
        hero_image_url: string | null;
        gallery_images: string[] | null;
      }>) {
        propById.set(p.id, {
          name: p.name ?? "Sem nome",
          ownerContactId: p.owner_contact_id,
          coverUrl: p.hero_image_url ?? null,
          // Capa primeiro, depois a galeria: se a capa sair do ar no Airbnb, a tela
          // cai na próxima foto em vez de ficar em branco.
          coverUrls: [p.hero_image_url, ...(p.gallery_images ?? [])].filter((u): u is string => !!u),
        });
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
    const ownerPhoneById = new Map<string, { phone: string | null; country: string | null }>();
    if (ownerIds.length > 0) {
      const { data: owners } = await supabase
        .from("property_owners")
        .select("id, name, trade_name, phone, phone_country")
        .in("id", ownerIds);
      for (const o of (owners ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
        phone: string | null;
        phone_country: string | null;
      }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) ownerNameById.set(o.id, label);
        ownerPhoneById.set(o.id, { phone: o.phone ?? null, country: o.phone_country ?? null });
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
    const urlByPath = await signPathsCached(supabase, paths);

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
        propertyCoverUrl: prop?.coverUrl ?? null,
        propertyCoverUrls: prop?.coverUrls ?? [],
        ownerName: prop?.ownerContactId ? (ownerNameById.get(prop.ownerContactId) ?? null) : null,
        ownerPhone: prop?.ownerContactId ? (ownerPhoneById.get(prop.ownerContactId)?.phone ?? null) : null,
        ownerPhoneCountry: prop?.ownerContactId ? (ownerPhoneById.get(prop.ownerContactId)?.country ?? null) : null,
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
    const ownerOf = (propertyId: string) => propById.get(propertyId)?.ownerContactId ?? null;
    const pendingItems: PendingItem[] = pendingRows
      .map((r) => {
        const first = (r.body ?? "").trim().split("\n")[0]?.trim() ?? "";
        return {
          id: r.id,
          propertyId: r.property_id,
          propertyName: propById.get(r.property_id)?.name ?? "Sem nome",
          category: r.category,
          title: first || "Sem título",
          createdAt: r.created_at,
          ownerName: ownerOf(r.property_id)
            ? (ownerNameById.get(ownerOf(r.property_id) as string) ?? null)
            : null,
          ownerPhone: ownerOf(r.property_id) ? (ownerPhoneById.get(ownerOf(r.property_id) as string)?.phone ?? null) : null,
          ownerPhoneCountry: ownerOf(r.property_id)
            ? (ownerPhoneById.get(ownerOf(r.property_id) as string)?.country ?? null)
            : null,
        };
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const totalOpen = Object.values(openCounts).reduce((a, b) => a + b, 0);
    const pendingOpen = (Object.keys(openCounts) as RecordCategory[])
      .filter(isPendingCategory)
      .reduce((n, k) => n + openCounts[k], 0);
    return {
      records,
      counts,
      openCounts,
      total,
      totalOpen,
      pendingOpen,
      pendingProperties: pendingPropertyIds.size,
      pendingItems,
      truncated: all.length >= ACCOUNT_RECORDS_SCAN_LIMIT,
      bounds,
    };
  });

/**
 * LIMPEZAS SEM REGISTRO — limpezas concluídas (saídas com limpeza marcada)
 * no recorte pedido que não têm nenhum registro de LIMPEZA ligado à mesma
 * estadia (mesmo log do hóspede ou mesma reserva). Alimenta o cartão da aba
 * Registros.
 */
export const countCleaningsWithoutRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: unknown) =>
      z
        .object({
          ownerId: z.string().uuid().nullable().optional(),
          days: z.number().int().positive().max(3650).nullable().optional(),
          propertyIds: z.array(z.string().uuid()).max(500).nullable().optional(),
        })
        .optional()
        .parse(i) ?? {},
  )
  .handler(async ({ data, context }): Promise<{ count: number }> => {
    const supabase = context.supabase as unknown as AnyClient;
    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const accessible = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId);
    const requested = data.propertyIds ?? null;
    const propIds =
      requested && requested.length > 0 ? accessible.filter((id) => requested.includes(id)) : accessible;
    if (propIds.length === 0) return { count: 0 };

    let q = supabase
      .from("guest_arrival_status")
      .select("id, log_id, reservation_id")
      .eq("kind", "checkout")
      .not("cleaning_type", "is", null)
      .not("concluded_at", "is", null)
      .in("property_id", propIds)
      .limit(5000);
    if (data.days) q = q.gte("concluded_at", new Date(Date.now() - data.days * 86_400_000).toISOString());
    const { data: rows, error } = await q;
    if (error) throw new Error("Não foi possível contar as limpezas sem registro. Tente de novo.");
    const cleanings = (rows ?? []) as { id: string; log_id: string | null; reservation_id: string | null }[];
    if (cleanings.length === 0) return { count: 0 };

    const { data: recs, error: e2 } = await supabase
      .from("reservation_records")
      .select("log_id, reservation_id")
      .eq("category", "cleaning_audit")
      .in("property_id", propIds)
      .limit(20000);
    if (e2) throw new Error("Não foi possível contar as limpezas sem registro. Tente de novo.");
    const logs = new Set<string>();
    const resv = new Set<string>();
    for (const r of (recs ?? []) as { log_id: string | null; reservation_id: string | null }[]) {
      if (r.log_id) logs.add(r.log_id);
      if (r.reservation_id) resv.add(r.reservation_id);
    }
    const count = cleanings.filter(
      (c) => !(c.log_id && logs.has(c.log_id)) && !(c.reservation_id && resv.has(c.reservation_id)),
    ).length;
    return { count };
  });

/* ───────────────────────── "+ REGISTRO" (05/10/2026) ─────────────────────────
 *
 * Opções do "+" da página Registros: os imóveis que a pessoa enxerga (com o
 * proprietário e o contato dele, para o cabeçalho da folha) e as reservas em
 * curso, recém-encerradas e próximas.
 *
 * Quem pode: qualquer pessoa da equipe e o prestador vinculado ao imóvel —
 * exatamente o alcance de `accessiblePropertyIds`, o mesmo que já decide o que
 * aparece na própria lista de Registros. Nada de regra de aprovação aqui
 * (diferente da limpeza avulsa, que mexe em dinheiro).
 */
export type NewRecordProperty = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
};
export type NewRecordReservation = {
  id: string;
  propertyId: string;
  label: string;
  checkin: string;
  checkout: string | null;
};

export const getNewRecordOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ ownerId: z.string().uuid().nullable().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as AnyClient;
    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const propIds = await accessiblePropertyIds(
      context.supabase as never,
      data.ownerId ?? null,
      context.userId,
    );
    const empty = {
      properties: [] as NewRecordProperty[],
      reservations: [] as NewRecordReservation[],
    };
    if (propIds.length === 0) return empty;

    const from = new Date(Date.now() - 3 * 3600_000 - 7 * 86400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() - 3 * 3600_000 + 90 * 86400_000).toISOString().slice(0, 10);
    const [{ data: props }, { data: res }] = await Promise.all([
      sb.from("properties").select("id, name, owner_contact_id").in("id", propIds).order("name"),
      sb
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date, guest_hint, status, raw_summary")
        .in("property_id", propIds)
        .gte("checkout_date", from)
        .lte("checkin_date", to)
        .order("checkin_date", { ascending: true })
        .limit(400),
    ]);

    type PropRow = { id: string; name: string | null; owner_contact_id: string | null };
    const propRows = (props ?? []) as PropRow[];
    const ownerIds = Array.from(
      new Set(propRows.map((p) => p.owner_contact_id).filter((v): v is string => !!v)),
    );
    const owner = new Map<string, { name: string; phone: string | null; country: string | null }>();
    if (ownerIds.length > 0) {
      const { data: owners } = await sb
        .from("property_owners")
        .select("id, name, trade_name, phone, phone_country")
        .in("id", ownerIds);
      for (const o of (owners ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
        phone: string | null;
        phone_country: string | null;
      }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) owner.set(o.id, { name: label, phone: o.phone ?? null, country: o.phone_country ?? null });
      }
    }

    type ResRow = {
      id: string;
      property_id: string;
      checkin_date: string;
      checkout_date: string | null;
      guest_hint: string | null;
      status: string | null;
      raw_summary: string | null;
    };
    // Mesmo critério de "reserva de verdade" da limpeza avulsa.
    const resRows = ((res ?? []) as ResRow[]).filter((r) => {
      const st = (r.status ?? "").toLowerCase();
      const sum = (r.raw_summary ?? "").toLowerCase();
      if (st.includes("cancel") || st.includes("block")) return false;
      return !(
        sum.includes("not available") ||
        sum.includes("unavailable") ||
        sum.includes("bloqueado")
      );
    });
    const guestByStay = new Map<string, string>();
    if (resRows.length > 0) {
      const { data: logs } = await sb
        .from("guide_access_logs")
        .select("property_id, checkin_date, guest_name")
        .in("property_id", propIds)
        .gte("checkin_date", from)
        .lte("checkin_date", to)
        .limit(2000);
      for (const l of (logs ?? []) as Array<{
        property_id: string;
        checkin_date: string;
        guest_name: string | null;
      }>) {
        const n = (l.guest_name ?? "").trim();
        if (!n || n.toLowerCase() === "hóspede pendente") continue;
        const k = `${l.property_id}|${l.checkin_date}`;
        if (!guestByStay.has(k)) guestByStay.set(k, n);
      }
    }

    return {
      properties: propRows.map((p) => {
        const o = p.owner_contact_id ? owner.get(p.owner_contact_id) : undefined;
        return {
          id: p.id,
          name: (p.name ?? "Imóvel").trim(),
          ownerName: o?.name ?? null,
          ownerPhone: o?.phone ?? null,
          ownerPhoneCountry: o?.country ?? null,
        };
      }),
      reservations: resRows.map((r) => ({
        id: r.id,
        propertyId: r.property_id,
        label: guestByStay.get(`${r.property_id}|${r.checkin_date}`) ?? (r.guest_hint ?? "").trim(),
        checkin: r.checkin_date,
        checkout: r.checkout_date,
      })),
    };
  });
