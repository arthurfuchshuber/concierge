import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// "Registros da reserva" (pedido explícito, 07/09/2026): uma linha do tempo
// ÚNICA por reserva — foto, vídeo, áudio, arquivo ou nota de
// situação/problema/auditoria — visível a partir do card em QUALQUER status
// (Check-in, Estadia, Checkout, Fila de Limpeza, Concluídos, Não
// Compareceu). A tabela `reservation_records` é NOVA (migração
// 20260907130000_reservation_records.sql) e só existe de verdade depois que
// essa migração for aplicada no Supabase — até lá (e também depois, já que
// os tipos gerados em `types.ts` não incluem tabelas fora do schema
// conhecido no momento da geração) o `.from("reservation_records")` precisa
// de um client "solto" (mesmo padrão de `AnyClient` já usado em
// arrival-board.server.ts) em vez do `SupabaseClient<Database>` estrito.
type AnyClient = { from: (table: string) => any; storage: any };

const BUCKET = "reservation-records";
const SIGN_TTL_SECONDS = 60 * 60; // 1h — mesmo prazo de signChatAttachmentUrl/signPropertyImages.

const RecordKind = z.enum(["photo", "video", "audio", "file", "note"]);
const CardMode = z.enum(["checkin", "checkout", "stay", "cleaning", "done", "no_show"]);

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
  storagePath: string | null;
  url: string | null;
  mime: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  fileName: string | null;
  body: string | null;
  cardMode: "checkin" | "checkout" | "stay" | "cleaning" | "done" | "no_show";
  createdByName: string | null;
  createdAt: string;
};

/**
 * Lista, em ordem cronológica, TODOS os registros de uma reserva — não
 * importa em qual card/status cada um foi criado. `logId`/`reservationId`
 * são os mesmos já resolvidos no cliente (ver resolveReservationTarget em
 * ReservationRecords.tsx), idênticos aos usados por advanceArrival/
 * markNoShow — por isso a busca cobre os dois campos: a mesma estadia pode
 * ter sido gravada com um OU outro dependendo de qual card/rota criou o
 * registro (log de formulário vs. reserva do iCal), mas ambos apontam pra
 * mesma reserva de verdade.
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
        "id, kind, storage_path, mime, size_bytes, duration_ms, file_name, body, card_mode, created_by_name, created_at",
      )
      .or(orParts.join(","))
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<{
      id: string;
      kind: ReservationRecord["kind"];
      storage_path: string | null;
      mime: string | null;
      size_bytes: number | null;
      duration_ms: number | null;
      file_name: string | null;
      body: string | null;
      card_mode: ReservationRecord["cardMode"];
      created_by_name: string | null;
      created_at: string;
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

    const out: ReservationRecord[] = list.map((r) => ({
      id: r.id,
      kind: r.kind,
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
    }));
    return { records: out };
  });

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

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, trade_name")
      .eq("id", context.userId)
      .maybeSingle();
    const who = (prof?.trade_name || prof?.full_name) ?? "Um membro da equipe";

    const { error } = await supabase.from("reservation_records").insert({
      property_id: data.propertyId,
      log_id: data.logId ?? null,
      reservation_id: data.reservationId ?? null,
      kind: data.kind,
      storage_path: data.path,
      mime: data.mime,
      size_bytes: data.sizeBytes,
      duration_ms: data.durationMs ?? null,
      file_name: data.fileName ?? null,
      body: data.caption ?? null,
      card_mode: data.cardMode,
      created_by: context.userId,
      created_by_name: who,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
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
        body: z.string().trim().min(1).max(2000),
      })
      .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as AnyClient;
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, trade_name")
      .eq("id", context.userId)
      .maybeSingle();
    const who = (prof?.trade_name || prof?.full_name) ?? "Um membro da equipe";

    const { error } = await supabase.from("reservation_records").insert({
      property_id: data.propertyId,
      log_id: data.logId ?? null,
      reservation_id: data.reservationId ?? null,
      kind: "note",
      body: data.body,
      card_mode: data.cardMode,
      created_by: context.userId,
      created_by_name: who,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Remove um registro (e o arquivo do storage, se houver). */
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
