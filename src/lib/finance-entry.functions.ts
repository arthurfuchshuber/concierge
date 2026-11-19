// Detalhe de UM lançamento das janelas de limpeza/serviços (Financeiro, Serviços, Limpeza):
// o que o lançamento da lista não carrega — descrição, reserva ligada e fotos/vídeos/áudios.
// Tudo lido com o cliente do usuário (RLS): quem não enxerga o imóvel não enxerga o detalhe.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RESERVATION_IDENTITY_COLUMNS, resolveReservationIdentity } from "@/lib/reservation-identity";

type AnyClient = { from: (t: string) => any; storage: { from: (b: string) => any } };

const BUCKET = "reservation-records";
const SIGN_TTL_SECONDS = 3600; // 1 h: recibos e comprovantes não quebram depois de alguns minutos na tela
const MEDIA_MAX = 12;

export type FinanceEntryMedia = {
  id: string;
  kind: "photo" | "video" | "audio" | "file" | "note";
  url: string | null;
  mime: string | null;
  fileName: string | null;
  /** Quem enviou e quando — rodapé do visualizador de mídia. */
  author: string | null;
  createdAt: string | null;
};

/** Reserva ligada ao lançamento — alimenta o quadrante "Reserva" e a janela "Detalhes da Reserva" (Fin-22). */
export type FinanceReservation = {
  guestName: string | null;
  checkin: string | null;
  checkout: string | null;
  /** Horários do imóvel (check-in / check-out), "HH:MM". */
  checkinTime: string | null;
  checkoutTime: string | null;
  guestPhone: string | null;
  guestPhoneCountry: string | null;
  code: string | null;
  channel: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
};

export type FinanceEntryDetail = {
  description: string | null;
  reservation: FinanceReservation | null;
  media: FinanceEntryMedia[];
  /** Serviço extra: a tarefa dona da situação (onde anexar fotos/vídeos novos). */
  taskId: string | null;
  /** Serviço extra: prestador que executou (para a janela "Alterar Prestador"). */
  providerId: string | null;
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
    let providerId: string | null = null;

    if (data.kind === "extra") {
      const { data: t } = await db
        .from("tasks")
        .select("id, description, log_id, reservation_id, resolved_by_provider_id")
        .eq("id", data.id)
        .maybeSingle();
      if (t) {
        taskId = t.id as string;
        description = (t.description as string | null) ?? null;
        providerId = (t.resolved_by_provider_id as string | null) ?? null;
        logId = logId ?? ((t.log_id as string | null) ?? null);
        reservationId = reservationId ?? ((t.reservation_id as string | null) ?? null);
      } else {
        // Conclusão de tarefa recorrente: a descrição vive na tarefa-mãe.
        const { data: c } = await db
          .from("task_completions")
          .select("task_id, log_id, reservation_id, resolved_by_provider_id")
          .eq("id", data.id)
          .maybeSingle();
        if (c) {
          taskId = c.task_id as string;
          providerId = (c.resolved_by_provider_id as string | null) ?? null;
          logId = logId ?? ((c.log_id as string | null) ?? null);
          reservationId = reservationId ?? ((c.reservation_id as string | null) ?? null);
          const { data: p } = await db.from("tasks").select("description").eq("id", taskId).maybeSingle();
          description = (p?.description as string | null) ?? null;
        }
      }
    }

    // Reserva ligada: o registro do hóspede (nome, telefone, código e datas) e/ou a reserva oficial
    // (ocupação e canal). Os horários são os do imóvel.
    let reservation: FinanceReservation | null = null;
    let propertyId: string | null = null;
    type ResRow = Record<string, unknown> & { checkin_date: string | null; checkout_date: string | null };
    let official: ResRow | null = null;
    const resCols = `property_id, guest_hint, checkin_date, checkout_date, ${RESERVATION_IDENTITY_COLUMNS}`;
    if (reservationId) {
      const { data: r } = await db.from("property_reservations").select(resCols).eq("id", reservationId).maybeSingle();
      if (r) {
        official = r as ResRow;
        propertyId = (r.property_id as string | null) ?? null;
      }
    }
    if (logId) {
      const { data: l } = await db
        .from("guide_access_logs")
        .select("property_id, guest_name, guest_phone, guest_phone_country, reservation_code, checkin_date, checkout_date")
        .eq("id", logId)
        .maybeSingle();
      if (l) {
        propertyId = propertyId ?? ((l.property_id as string | null) ?? null);
        if (!official && propertyId && l.checkin_date && l.checkout_date) {
          const { data: r } = await db
            .from("property_reservations")
            .select(resCols)
            .eq("property_id", propertyId)
            .eq("checkin_date", l.checkin_date)
            .eq("checkout_date", l.checkout_date)
            .neq("status", "cancelled")
            .limit(1)
            .maybeSingle();
          if (r) official = r as ResRow;
        }
        const id = official ? resolveReservationIdentity(official as never) : null;
        reservation = {
          guestName: ((l.guest_name as string | null) ?? "").trim() || id?.guestName || null,
          checkin: (l.checkin_date as string | null) ?? null,
          checkout: (l.checkout_date as string | null) ?? null,
          checkinTime: null,
          checkoutTime: null,
          guestPhone: (l.guest_phone as string | null) ?? id?.guestPhone ?? null,
          guestPhoneCountry: (l.guest_phone_country as string | null) ?? null,
          code: ((l.reservation_code as string | null) ?? "").trim() || id?.reservationCode || null,
          channel: id?.channel ?? null,
          adults: id?.adults ?? null,
          children: id?.children ?? null,
          infants: id?.infants ?? null,
        };
      }
    }
    if (!reservation && official) {
      const id = resolveReservationIdentity(official as never);
      reservation = {
        guestName: id.guestName,
        checkin: official.checkin_date ?? null,
        checkout: official.checkout_date ?? null,
        checkinTime: null,
        checkoutTime: null,
        guestPhone: id.guestPhone,
        guestPhoneCountry: null,
        code: id.reservationCode,
        channel: id.channel,
        adults: id.adults,
        children: id.children,
        infants: id.infants,
      };
    }
    if (reservation && propertyId) {
      const { data: p } = await db.from("properties").select("checkin_time, checkout_time").eq("id", propertyId).maybeSingle();
      const hhmm = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 5) : null);
      reservation.checkinTime = hhmm(p?.checkin_time);
      reservation.checkoutTime = hhmm(p?.checkout_time);
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
      created_by_name: string | null;
      created_at: string | null;
    };
    const cols = "id, group_id, kind, storage_path, mime, file_name, body, created_by_name, created_at";
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
      taskId,
      providerId,
      media: files.map((r) => ({
        id: r.id,
        kind: r.kind,
        url: r.storage_path ? (urlByPath.get(r.storage_path) ?? null) : null,
        mime: r.mime,
        fileName: r.file_name,
        author: r.created_by_name,
        createdAt: r.created_at,
      })),
    };
  });
