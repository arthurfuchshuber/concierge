import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestHeader } from "@tanstack/react-start/server";

const VehicleSchema = z.object({
  plate: z.string().trim().max(20).optional().nullable(),
  model: z.string().trim().max(80).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
});

const DocumentSchema = z.object({
  guest_name: z.string().trim().max(200).optional().nullable(),
  file_url: z.string().trim().max(1000).optional().nullable(),
  file_path: z.string().trim().max(500).optional().nullable(),
  doc_type: z.string().trim().max(40).optional().nullable(),
  doc_number: z.string().trim().max(80).optional().nullable(),
  file_name: z.string().trim().max(200).optional().nullable(),
  legible: z.boolean().optional().nullable(),
});

const AccessInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  property_id: z.string().uuid().optional(),
  guest_name: z.string().trim().min(2).max(200),
  reservation_code: z.string().trim().max(100).optional().nullable(),
  checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),

  guest_phone: z.string().trim().max(40).optional().nullable(),
  guest_phone_country: z.string().trim().max(4).optional().nullable(),
  guest_arrival_time: z.string().trim().max(10).optional().nullable(),
  guest_vehicles: z.array(VehicleSchema).max(10).optional().nullable(),
  guest_documents: z.array(DocumentSchema).max(20).optional().nullable(),
});

export const recordGuideAccess = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AccessInput.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-access:${clientIpFrom(getRequest())}`, 20, 60_000)) {
      throw new Error("Muitas tentativas. Aguarde um instante e tente novamente.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const propQuery = supabaseAdmin
      .from("properties")
      .select("id, checkin_time, tagline, airbnb_ical_url, airbnb_ical_last_sync_at")
      .eq("slug", data.slug)
      .eq("published", true);
    const { data: prop, error: propErr } = data.property_id
      ? await propQuery.eq("id", data.property_id).maybeSingle()
      : await propQuery.maybeSingle();
    if (propErr) throw (await import("@/lib/db-errors.server")).safeDbError("guide_access_logs", propErr);
    if (!prop) return { ok: false as const, reason: "not_found" };

    const hasIcal = !!((prop as { airbnb_ical_url?: string | null }).airbnb_ical_url ?? "").trim();
    let icalReservationCode: string | null = null;

    // Guias do tipo "Check-In & Check-Out" com calendário: o código da reserva
    // é obrigatório e validado ao vivo contra o iCal do Airbnb. As datas do
    // acesso passam a vir da própria reserva, nunca da escolha do hóspede.
    const { ETIQUETA_CHECKIN_CHECKOUT } = await import("@/lib/publish-requirements");
    const requiresCode =
      hasIcal && ((prop as { tagline?: string | null }).tagline ?? "").trim() === ETIQUETA_CHECKIN_CHECKOUT;
    if (requiresCode) {
      const codeRaw = (data.reservation_code ?? "").trim();
      if (!codeRaw) return { ok: false as const, reason: "code_required" };
      const found = await lookupReservationByCode(data.slug, data.property_id, codeRaw);
      if (!found.ok) return { ok: false as const, reason: found.reason };
      icalReservationCode = codeRaw.toUpperCase();
      data.checkin_date = found.checkin_date;
      data.checkout_date = found.checkout_date;
    }

    if (hasIcal && !requiresCode) {
      const { ensurePropertyIcalFresh } = await import("@/lib/airbnb-ical.server");
      await ensurePropertyIcalFresh(
        prop.id,
        (prop as { airbnb_ical_url?: string | null }).airbnb_ical_url,
        (prop as { airbnb_ical_last_sync_at?: string | null }).airbnb_ical_last_sync_at,
      );
      const { isAllowedGuidePeriod, isRealReservation } = await import("@/lib/reservations.server");
      // Sem data de saída informada, a validação usa apenas a data de entrada:
      // o hóspede nunca pode registrar um dia que não é chegada real do iCal.
      let query = supabaseAdmin
        .from("property_reservations")
        .select("checkin_date, checkout_date, raw_summary, status, guest_hint")
        .eq("property_id", prop.id)
        .eq("source", "airbnb")
        .eq("checkin_date", data.checkin_date);
      if (data.checkout_date) query = query.eq("checkout_date", data.checkout_date);
      const { data: periods } = await query.limit(50);
      const matched = data.checkout_date
        ? isAllowedGuidePeriod(periods as never, data.checkin_date, data.checkout_date).matched
        : ((periods ?? []) as never[]).some((r) => isRealReservation(r));
      if (!matched) return { ok: false as const, reason: "no_match" };

      // Captura o código HM… do iCal quando o par (imóvel, entrada, saída) é
      // único — assim o dashboard mapeia o log ao card certo mesmo quando o
      // formulário público não expõe o campo de código.
      const rows = ((periods ?? []) as Array<{ guest_hint: string | null }>).filter((r) => !!r.guest_hint);
      const codes = Array.from(new Set(rows.map((r) => (r.guest_hint ?? "").toUpperCase())));
      if (codes.length === 1) icalReservationCode = codes[0];
    }

    const userAgent = getRequestHeader("user-agent")?.slice(0, 500) ?? null;
    const { error } = await supabaseAdmin.from("guide_access_logs").insert({
      property_id: prop.id,
      guest_name: data.guest_name,
      reservation_code: (data.reservation_code?.trim() || icalReservationCode) || null,
      checkin_date: data.checkin_date,
      checkout_date: data.checkout_date ?? null,
      guest_phone: data.guest_phone?.trim() || null,

      guest_phone_country: data.guest_phone_country?.trim() || null,
      guest_arrival_time: data.guest_arrival_time?.trim() || null,
      guest_vehicles: data.guest_vehicles && data.guest_vehicles.length > 0 ? data.guest_vehicles : null,
      guest_documents: data.guest_documents && data.guest_documents.length > 0 ? data.guest_documents : null,
      user_agent: userAgent,
    } as never);
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("guide_access_logs", error);


    try {
      const { data: fullProp } = await supabaseAdmin
        .from("properties")
        .select("owner_id, name, slug")
        .eq("id", prop.id)
        .maybeSingle();
      if (fullProp?.owner_id) {
        const { data: ownerData } = await supabaseAdmin.auth.admin.getUserById(fullProp.owner_id);
        const ownerEmail = ownerData?.user?.email;
        if (ownerEmail) {
          const guestLabel = data.guest_name;
          const checkinLabel = data.checkin_date
            ? new Date(data.checkin_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
            : "data não informada";
          const guideUrl = `https://guia.anfitriaosigma.com.br/g/${fullProp.slug}`;
          console.info(
            `[guide-access] Guest "${guestLabel}" (check-in ${checkinLabel}) accessed guide "${fullProp.name}". Notify: ${ownerEmail} — ${guideUrl}`,
          );
        }
      }
    } catch {
      // Notification failure never blocks guest access
    }

    return {
      ok: true as const,
      checkin_time: prop.checkin_time as string | null,
      checkin_date: data.checkin_date,
      checkout_date: data.checkout_date ?? null,
    };

  });

const CheckReservationInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  property_id: z.string().uuid().optional(),
  checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const AvailabilityInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  property_id: z.string().uuid().optional(),
});

export const getGuideCalendarAvailability = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AvailabilityInput.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-availability:${clientIpFrom(getRequest())}`, 40, 60_000)) {
      throw new Error("Muitas tentativas. Aguarde um instante e tente novamente.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { classifyCalendarPeriod, operationalTodayISO } = await import("@/lib/reservations.server");
    const propQuery = supabaseAdmin
      .from("properties")
      .select("id, airbnb_ical_url, airbnb_ical_last_sync_at")
      .eq("slug", data.slug)
      .eq("published", true);
    const { data: prop } = data.property_id
      ? await propQuery.eq("id", data.property_id).maybeSingle()
      : await propQuery.maybeSingle();
    if (!prop) return { hasIcal: false as const, periods: [] as Array<{ checkin: string; checkout: string; type: "reservation" | "block" }> };
    const hasIcal = !!((prop.airbnb_ical_url as string | null) ?? "").trim();
    if (!hasIcal) return { hasIcal: false as const, periods: [] as Array<{ checkin: string; checkout: string; type: "reservation" | "block" }> };
    const { ensurePropertyIcalFresh } = await import("@/lib/airbnb-ical.server");
    await ensurePropertyIcalFresh(
      prop.id,
      prop.airbnb_ical_url as string | null,
      (prop as { airbnb_ical_last_sync_at?: string | null }).airbnb_ical_last_sync_at,
    );

    const today = operationalTodayISO();
    const { data: rows } = await supabaseAdmin
      .from("property_reservations")
      .select("checkin_date, checkout_date, raw_summary, status")
      .eq("property_id", prop.id)
      .eq("source", "airbnb")
      // Estadias em andamento também ocupam o calendário: filtramos pelo
      // checkout, não pelo checkin.
      .gte("checkout_date", today)
      .order("checkin_date", { ascending: true })
      .limit(500);

    const periods: Array<{ checkin: string; checkout: string; type: "reservation" | "block" }> = [];
    for (const row of (rows ?? []) as Array<{ checkin_date: string; checkout_date: string; raw_summary: string | null; status: string | null }>) {
      const type = classifyCalendarPeriod(row);
      if (type === "reservation") periods.push({ checkin: row.checkin_date, checkout: row.checkout_date, type });
    }

    return { hasIcal: true as const, periods };
  });

/**
 * Public reservation match check for the guest access gate.
 * Returns only booleans + a single hint date — never guest names or codes.
 */
export const checkReservationBySlug = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => CheckReservationInput.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-reservation-check:${clientIpFrom(getRequest())}`, 30, 60_000)) {
      throw new Error("Muitas tentativas. Aguarde um instante e tente novamente.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const propQuery = supabaseAdmin
      .from("properties")
      .select("id, airbnb_ical_url, airbnb_ical_last_sync_at")
      .eq("slug", data.slug)
      .eq("published", true);
    const { data: prop } = data.property_id
      ? await propQuery.eq("id", data.property_id).maybeSingle()
      : await propQuery.maybeSingle();
    if (!prop) return { hasIcal: false as const, matched: false as const };
    const hasIcal = !!(prop.airbnb_ical_url as string | null);
    if (!hasIcal) return { hasIcal: false as const, matched: false as const };
    const { ensurePropertyIcalFresh } = await import("@/lib/airbnb-ical.server");
    await ensurePropertyIcalFresh(
      prop.id,
      prop.airbnb_ical_url as string | null,
      (prop as { airbnb_ical_last_sync_at?: string | null }).airbnb_ical_last_sync_at,
    );

    const { isAllowedGuidePeriod } = await import("@/lib/reservations.server");
    const { data: exact } = await supabaseAdmin
      .from("property_reservations")
      .select("id, checkin_date, checkout_date, raw_summary, status")
      .eq("property_id", prop.id)
      .eq("source", "airbnb")
      .eq("checkin_date", data.checkin_date)
      .eq("checkout_date", data.checkout_date)
      .limit(50);
    const allowed = isAllowedGuidePeriod(exact as never, data.checkin_date, data.checkout_date);
    if (allowed.matched) {
      return { hasIcal: true as const, matched: true as const, matchType: allowed.type };
    }
    // Loose match: same check-in date, any check-out
    const { data: loose } = await supabaseAdmin
      .from("property_reservations")
      .select("checkin_date, checkout_date")
      .eq("property_id", prop.id)
      .eq("source", "airbnb")
      .eq("checkin_date", data.checkin_date)
      .limit(1);
    if ((loose ?? []).length > 0) {
      return {
        hasIcal: true as const,
        matched: false as const,
        looseMatch: true as const,
        suggestedCheckout: (loose![0] as { checkout_date: string }).checkout_date,
      };
    }
    return { hasIcal: true as const, matched: false as const };
  });






const StayStatusInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  property_id: z.string().uuid().optional(),
  guest_name: z.string().trim().max(200).optional().nullable(),
  checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

/**
 * Status de check-in/check-out marcado pelo ANFITRIÃO (Kanban da Operação),
 * para a reserva do hóspede que está vendo o guia. Retorna apenas booleanos.
 */
export const getGuideStayStatus = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => StayStatusInput.parse(i))
  .handler(async ({ data }) => {
    const empty = { checkinDone: false, checkoutDone: false };
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-stay-status:${clientIpFrom(getRequest())}`, 60, 60_000)) return empty;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const propQuery = supabaseAdmin.from("properties").select("id").eq("slug", data.slug).eq("published", true);
    const { data: prop } = data.property_id
      ? await propQuery.eq("id", data.property_id).maybeSingle()
      : await propQuery.maybeSingle();
    if (!prop) return empty;

    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const guest = data.guest_name ? norm(data.guest_name) : null;

    const [{ data: logs }, { data: reservations }] = await Promise.all([
      supabaseAdmin
        .from("guide_access_logs")
        .select("id, guest_name, checkin_date, checkout_date")
        .eq("property_id", prop.id)
        .eq("checkin_date", data.checkin_date)
        .limit(200),
      supabaseAdmin
        .from("property_reservations")
        .select("id, checkin_date, checkout_date")
        .eq("property_id", prop.id)
        .eq("checkin_date", data.checkin_date)
        .limit(50),
    ]);

    const logIds = ((logs ?? []) as Array<{ id: string; guest_name: string | null; checkout_date: string | null }>)
      .filter((l) => {
        if (data.checkout_date && l.checkout_date && l.checkout_date !== data.checkout_date) return false;
        if (guest && l.guest_name && norm(l.guest_name) !== guest) return false;
        return true;
      })
      .map((l) => l.id);
    const resIds = ((reservations ?? []) as Array<{ id: string; checkout_date: string }>)
      .filter((r) => !data.checkout_date || r.checkout_date === data.checkout_date)
      .map((r) => r.id);

    if (logIds.length === 0 && resIds.length === 0) return empty;

    const { data: statuses } = await supabaseAdmin
      .from("guest_arrival_status")
      .select("kind, status, done_at, log_id, reservation_id")
      .eq("property_id", prop.id)
      .limit(500);

    let checkinDone = false;
    let checkoutDone = false;
    for (const s of (statuses ?? []) as Array<{
      kind: string;
      status: string | null;
      done_at: string | null;
      log_id: string | null;
      reservation_id: string | null;
    }>) {
      const belongs =
        (s.log_id && logIds.includes(s.log_id)) || (s.reservation_id && resIds.includes(s.reservation_id));
      if (!belongs) continue;
      const done = s.status === "done" || !!s.done_at;
      if (!done) continue;
      if (s.kind === "checkin") checkinDone = true;
      if (s.kind === "checkout") checkoutDone = true;
    }
    return { checkinDone, checkoutDone };
  });

const MarkStepInput = StayStatusInput.extend({ kind: z.enum(["checkin", "checkout"]) });

/**
 * O próprio hóspede marca "já fiz o check-in/check-out" no guia — o mesmo
 * status que o anfitrião marca no Kanban da Operação.
 */
export const markGuideStayStep = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => MarkStepInput.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-mark-step:${clientIpFrom(getRequest())}`, 20, 60_000)) return { ok: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const propQuery = supabaseAdmin.from("properties").select("id").eq("slug", data.slug).eq("published", true);
    const { data: prop } = data.property_id
      ? await propQuery.eq("id", data.property_id).maybeSingle()
      : await propQuery.maybeSingle();
    if (!prop) return { ok: false as const };

    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const guest = data.guest_name ? norm(data.guest_name) : null;
    const { data: logs } = await supabaseAdmin
      .from("guide_access_logs")
      .select("id, guest_name, checkout_date")
      .eq("property_id", prop.id)
      .eq("checkin_date", data.checkin_date)
      .limit(200);
    const match = ((logs ?? []) as Array<{ id: string; guest_name: string | null; checkout_date: string | null }>).find(
      (l) => {
        if (data.checkout_date && l.checkout_date && l.checkout_date !== data.checkout_date) return false;
        if (guest && l.guest_name && norm(l.guest_name) !== guest) return false;
        return true;
      },
    );
    if (!match) return { ok: false as const };

    const { error } = await supabaseAdmin.from("guest_arrival_status").upsert(
      {
        log_id: match.id,
        property_id: prop.id,
        kind: data.kind,
        status: "done",
        done_at: new Date().toISOString(),
      } as never,
      { onConflict: "log_id,kind" },
    );
    if (error) return { ok: false as const };
    return { ok: true as const };
  });

/* ------------------------------------------------------------------ *
 * Validação do código da reserva (Airbnb) — guias "Check-In & Check-Out"
 *
 * O hóspede digita o código (HMxxxxxxx) e o sistema consulta o iCal do
 * imóvel na hora: se a reserva estiver ativa, devolvemos as datas para
 * preencher o período automaticamente; se sumir/cancelar depois, o mesmo
 * endpoint passa a responder "inativa" e o guia derruba o acesso.
 * ------------------------------------------------------------------ */

const ReservationCodeInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  property_id: z.string().uuid().optional(),
  code: z.string().trim().min(4).max(40),
});

type ReservationLookup =
  | { ok: true; checkin_date: string; checkout_date: string }
  | { ok: false; reason: "not_found" | "no_ical" | "inactive" | "expired" };

async function lookupReservationByCode(
  slug: string,
  propertyId: string | undefined,
  rawCode: string,
): Promise<ReservationLookup> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const propQuery = supabaseAdmin
    .from("properties")
    .select("id, airbnb_ical_url, airbnb_ical_last_sync_at")
    .eq("slug", slug)
    .eq("published", true);
  const { data: prop } = propertyId ? await propQuery.eq("id", propertyId).maybeSingle() : await propQuery.maybeSingle();
  if (!prop) return { ok: false, reason: "not_found" };
  const icalUrl = ((prop as { airbnb_ical_url?: string | null }).airbnb_ical_url ?? "").trim();
  if (!icalUrl) return { ok: false, reason: "no_ical" };

  const { ensurePropertyIcalFresh } = await import("@/lib/airbnb-ical.server");
  await ensurePropertyIcalFresh(
    prop.id,
    icalUrl,
    (prop as { airbnb_ical_last_sync_at?: string | null }).airbnb_ical_last_sync_at,
  );

  const code = rawCode.trim().toUpperCase();
  const { data: rows } = await supabaseAdmin
    .from("property_reservations")
    .select("checkin_date, checkout_date, raw_summary, status, guest_hint")
    .eq("property_id", prop.id)
    .eq("source", "airbnb")
    .ilike("guest_hint", code)
    .limit(20);

  const list = (rows ?? []) as Array<{
    checkin_date: string;
    checkout_date: string;
    raw_summary: string | null;
    status: string | null;
  }>;
  if (list.length === 0) return { ok: false, reason: "inactive" };

  const { isRealReservation, operationalTodayISO } = await import("@/lib/reservations.server");
  const active = list.filter((r) => isRealReservation(r));
  if (active.length === 0) return { ok: false, reason: "inactive" };

  const today = operationalTodayISO();
  const current = active.find((r) => r.checkout_date >= today);
  if (!current) return { ok: false, reason: "expired" };

  return { ok: true, checkin_date: current.checkin_date, checkout_date: current.checkout_date };
}

/** Valida o código digitado no formulário de primeiro acesso. */
export const validateGuideReservationCode = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ReservationCodeInput.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-res-code:${clientIpFrom(getRequest())}`, 15, 60_000)) {
      throw new Error("Muitas tentativas. Aguarde um instante e tente novamente.");
    }
    return await lookupReservationByCode(data.slug, data.property_id, data.code);
  });

/**
 * Revalidação contínua: o guia consulta este endpoint periodicamente e,
 * quando a reserva deixa de estar ativa no Airbnb, derruba o acesso.
 */
export const getReservationLiveStatus = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ReservationCodeInput.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-res-status:${clientIpFrom(getRequest())}`, 60, 60_000)) {
      // Sob rate-limit não derrubamos ninguém: apenas dizemos "desconhecido".
      return { active: null as boolean | null };
    }
    const res = await lookupReservationByCode(data.slug, data.property_id, data.code);
    if (res.ok) return { active: true as boolean | null, checkout_date: res.checkout_date };
    if (res.reason === "no_ical" || res.reason === "not_found") return { active: null as boolean | null };
    return { active: false as boolean | null, reason: res.reason };
  });
