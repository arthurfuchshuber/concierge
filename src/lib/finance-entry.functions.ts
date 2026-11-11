// Detalhe de UM lançamento das janelas de limpeza/serviços (Financeiro, Serviços, Limpeza):
// o que o lançamento da lista não carrega — descrição, reserva ligada e fotos/vídeos/áudios.
// Tudo lido com o cliente do usuário (RLS): quem não enxerga o imóvel não enxerga o detalhe.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AnyClient = { from: (t: string) => any; storage: { from: (b: string) => any } };

const BUCKET = "reservation-records";
const SIGN_TTL_SECONDS = 300;
const MEDIA_MAX = 12;

export type FinanceEntryMedia = {
  id: string;
  kind: "photo" | "video" | "audio" | "file" | "note";
  url: string | null;
  mime: string | null;
  fileName: string | null;
};

export type FinanceEntryDetail = {
  description: string | null;
  reservation: { guestName: string | null; checkin: string | null; checkout: string | null } | null;
  media: FinanceEntryMedia[];
};

const Input = z.object({
  kind: z.enum(["extra", "cleaning"]),
  /** Serviço extra: id da tarefa (ou da conclusão de tarefa recorrente). */
  id: z.string().uuid(),
  logId: z.string().uuid().nullish(),
  reservationId: z.string().uuid().nullish(),
});

export const getFinanceEntryDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<FinanceEntryDetail> => {
    const db = context.supabase as unknown as AnyClient;
    let logId = data.logId ?? null;
    let reservationId = data.reservationId ?? null;
    let taskId: string | null = null;
    let description: string | null = null;

    if (data.kind === "extra") {
      const { data: t } = await db
        .from("tasks")
        .select("id, description, log_id, reservation_id")
        .eq("id", data.id)
        .maybeSingle();
      if (t) {
        taskId = t.id as string;
        description = (t.description as string | null) ?? null;
        logId = logId ?? ((t.log_id as string | null) ?? null);
        reservationId = reservationId ?? ((t.reservation_id as string | null) ?? null);
      } else {
        // Conclusão de tarefa recorrente: a descrição vive na tarefa-mãe.
        const { data: c } = await db
          .from("task_completions")
          .select("task_id, log_id, reservation_id")
          .eq("id", data.id)
          .maybeSingle();
        if (c) {
          taskId = c.task_id as string;
          logId = logId ?? ((c.log_id as string | null) ?? null);
          reservationId = reservationId ?? ((c.reservation_id as string | null) ?? null);
          const { data: p } = await db.from("tasks").select("description").eq("id", taskId).maybeSingle();
          description = (p?.description as string | null) ?? null;
        }
      }
    }

    // Reserva ligada: o registro do hóspede (nome + datas) ou a reserva do calendário.
    let reservation: FinanceEntryDetail["reservation"] = null;
    if (logId) {
      const { data: l } = await db
        .from("guide_access_logs")
        .select("guest_name, checkin_date, checkout_date")
        .eq("id", logId)
        .maybeSingle();
      if (l) {
        reservation = {
          guestName: ((l.guest_name as string | null) ?? "").trim() || null,
          checkin: (l.checkin_date as string | null) ?? null,
          checkout: (l.checkout_date as string | null) ?? null,
        };
      }
    }
    if (!reservation && reservationId) {
      const { data: r } = await db
        .from("property_reservations")
        .select("guest_hint, checkin_date, checkout_date")
        .eq("id", reservationId)
        .maybeSingle();
      if (r) {
        reservation = {
          guestName: ((r.guest_hint as string | null) ?? "").trim() || null,
          checkin: (r.checkin_date as string | null) ?? null,
          checkout: (r.checkout_date as string | null) ?? null,
        };
      }
    }

    // Mídias: as da situação (serviço extra) ou as da conferência da limpeza.
    type Rec = {
      id: string;
      group_id: string | null;
      kind: FinanceEntryMedia["kind"];
      storage_path: string | null;
      mime: string | null;
      file_name: string | null;
      body: string | null;
    };
    const cols = "id, group_id, kind, storage_path, mime, file_name, body";
    let recs: Rec[] = [];
    if (data.kind === "extra" && taskId) {
      const { data: first } = await db.from("reservation_records").select(cols).eq("task_id", taskId).limit(200);
      const firstRows = (first ?? []) as Rec[];
      const groups = Array.from(new Set(firstRows.map((r) => r.group_id ?? r.id)));
      if (groups.length > 0) {
        const { data: all } = await db
          .from("reservation_records")
          .select(cols)
          .or(`group_id.in.(${groups.join(",")}),id.in.(${groups.join(",")})`)
          .order("created_at", { ascending: true })
          .limit(200);
        recs = (all ?? []) as Rec[];
      }
    } else if (data.kind === "cleaning" && (logId || reservationId)) {
      const orParts: string[] = [];
      if (logId) orParts.push(`log_id.eq.${logId}`);
      if (reservationId) orParts.push(`reservation_id.eq.${reservationId}`);
      const { data: all } = await db
        .from("reservation_records")
        .select(cols)
        .eq("card_mode", "cleaning")
        .or(orParts.join(","))
        .order("created_at", { ascending: true })
        .limit(200);
      recs = (all ?? []) as Rec[];
    }

    if (data.kind === "extra" && !description?.trim()) {
      // Sem descrição na tarefa: o texto da situação (título na 1ª linha, descrição nas demais).
      const note = recs.find((r) => r.body?.trim());
      const lines = (note?.body ?? "").split("\n").slice(1).join("\n").trim();
      if (lines) description = lines;
    }

    const files = recs.filter((r) => r.kind === "photo" || r.kind === "video" || r.kind === "audio").slice(0, MEDIA_MAX);
    const paths = files.map((r) => r.storage_path).filter((p): p is string => !!p);
    const urlByPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL_SECONDS);
      for (const s of (signed ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
      }
    }

    return {
      description: description?.trim() || null,
      reservation,
      media: files.map((r) => ({
        id: r.id,
        kind: r.kind,
        url: r.storage_path ? (urlByPath.get(r.storage_path) ?? null) : null,
        mime: r.mime,
        fileName: r.file_name,
      })),
    };
  });
