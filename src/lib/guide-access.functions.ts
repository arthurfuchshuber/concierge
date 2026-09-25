import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestHeader } from "@tanstack/react-start/server";
import { guideUrl } from "@/lib/site-url";

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
  checkout_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),

  guest_phone: z.string().trim().max(40).optional().nullable(),
  guest_phone_country: z.string().trim().max(4).optional().nullable(),
  guest_arrival_time: z.string().trim().max(10).optional().nullable(),
  predicted_checkin_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  predicted_checkout_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  predicted_checkout_time: z.string().trim().max(10).optional().nullable(),
  guest_vehicles: z.array(VehicleSchema).max(10).optional().nullable(),
  guest_documents: z.array(DocumentSchema).max(20).optional().nullable(),
});

function timeToMinutes(t: string | null | undefined): number | null {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Mesma checagem de faixa usada no seletor de horário do anfitrião — aqui só
 * pra decidir se um horário previsto informado pelo hóspede fica dentro do
 * limite configurado para o imóvel antes de gravar como override. */
function withinTimeBounds(time: string | null, min: string | null, max: string | null): boolean {
  const t = timeToMinutes(time);
  if (t === null) return false;
  const lo = timeToMinutes(min);
  const hi = timeToMinutes(max);
  if (lo !== null && t < lo) return false;
  if (hi !== null && t > hi) return false;
  return true;
}

/**
 * DOCUMENTOS DO HÓSPEDE SÓ APONTAM PARA ARQUIVOS DESTE IMÓVEL (16/09/2026).
 *
 * O formulário é público. Antes, o que viesse em `guest_documents` era gravado
 * como veio: um `file_url` qualquer virava link clicável no painel da equipe
 * (Hóspedes → "Arquivo"), e um `file_path` de outro imóvel seria assinado pelo
 * painel com a chave de serviço. O upload legítimo (`guest-doc-upload`) sempre
 * devolve `<id do imóvel>/<uuid>.<ext>` e o formulário nunca envia `file_url`
 * — então as duas coisas saem aqui sem afetar nenhum hóspede real.
 */
function sanitizeGuestDocuments(
  docs: z.infer<typeof DocumentSchema>[] | null | undefined,
  propertyId: string,
) {
  if (!docs || docs.length === 0) return null;
  const pathRe = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i;
  return docs.map((d) => {
    const path = (d.file_path ?? "").trim();
    const validPath = !!path && pathRe.test(path) && path.startsWith(`${propertyId}/`);
    return { ...d, file_url: null, file_path: validPath ? path : null };
  });
}

const STAY_ACCESS_PURPOSE = "guide-stay-access";

/** Confere o comprovante do hóspede e devolve o id do registro dele. */
async function stayLogFromToken(token: string | null | undefined, propertyId: string) {
  if (!token) return null;
  const { verifyGuestToken } = await import("@/lib/guest-access.server");
  const pl = await verifyGuestToken<{ p: string; l: string; exp: number }>(STAY_ACCESS_PURPOSE, token);
  if (!pl || pl.exp < Date.now() || pl.p !== propertyId) return null;
  return pl.l;
}

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
      .select(
        "id, checkin_time, checkin_time_max, checkout_time, checkout_time_min, tagline, airbnb_ical_url, airbnb_ical_last_sync_at",
      )
      .eq("slug", data.slug)
      .eq("published", true);
    const { data: prop, error: propErr } = data.property_id
      ? await propQuery.eq("id", data.property_id).maybeSingle()
      : await propQuery.maybeSingle();
    if (propErr)
      throw (await import("@/lib/db-errors.server")).safeDbError("guide_access_logs", propErr);
    if (!prop) return { ok: false as const, reason: "not_found" };

    const hasIcal = !!((prop as { airbnb_ical_url?: string | null }).airbnb_ical_url ?? "").trim();
    let icalReservationCode: string | null = null;

    // Guias do tipo "Check-In & Check-Out" com calendário: o código da reserva
    // é obrigatório e validado ao vivo contra o iCal do Airbnb. As datas do
    // acesso passam a vir da própria reserva, nunca da escolha do hóspede.
    const { ETIQUETA_CHECKIN_CHECKOUT } = await import("@/lib/publish-requirements");
    const requiresCode =
      hasIcal &&
      ((prop as { tagline?: string | null }).tagline ?? "").trim() === ETIQUETA_CHECKIN_CHECKOUT;
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
      const rows = ((periods ?? []) as Array<{ guest_hint: string | null }>).filter(
        (r) => !!r.guest_hint,
      );
      const codes = Array.from(new Set(rows.map((r) => (r.guest_hint ?? "").toUpperCase())));
      if (codes.length === 1) icalReservationCode = codes[0];
    }

    // "Não compareceu" trava o guia (pedido explícito, 24/09/2026). Nos guias
    // com código a trava já veio de `lookupReservationByCode`; aqui cobre os
    // guias sem código (acesso pelas datas).
    if (!requiresCode) {
      const { isStayMarkedNoShow } = await import("@/lib/guest-access.server");
      if (await isStayMarkedNoShow(prop.id as string, data.checkin_date)) {
        return { ok: false as const, reason: "no_show" };
      }
    }

    const userAgent = getRequestHeader("user-agent")?.slice(0, 500) ?? null;
    const { data: insertedLog, error } = await supabaseAdmin
      .from("guide_access_logs")
      .insert({
        property_id: prop.id,
        guest_name: data.guest_name,
        reservation_code: data.reservation_code?.trim() || icalReservationCode || null,
        checkin_date: data.checkin_date,
        checkout_date: data.checkout_date ?? null,
        guest_phone: data.guest_phone?.trim() || null,

        guest_phone_country: data.guest_phone_country?.trim() || null,
        guest_arrival_time: data.guest_arrival_time?.trim() || null,
        guest_vehicles:
          data.guest_vehicles && data.guest_vehicles.length > 0 ? data.guest_vehicles : null,
        guest_documents: sanitizeGuestDocuments(data.guest_documents, prop.id as string),
        user_agent: userAgent,
      } as never)
      .select("id")
      .single();
    if (error)
      throw (await import("@/lib/db-errors.server")).safeDbError("guide_access_logs", error);

    // Previsão de chegada/saída informada pelo próprio hóspede no formulário
    // (mesmas regras já aplicadas no seletor do anfitrião): checkin nunca
    // antes da reserva confirmada nem no dia do checkout (ou depois);
    // checkout nunca antes do checkin nem depois da reserva confirmada. O
    // navegador do hóspede já aplica esses limites no input (min/max), isso
    // aqui é só defesa em profundidade — se vier fora do limite, ignoramos
    // silenciosamente em vez de derrubar o cadastro inteiro. Pedido
    // explícito (05/09/2026).
    const logId = (insertedLog as { id: string } | null)?.id ?? null;
    if (logId) {
      const stayCheckinDate = data.checkin_date;
      const stayCheckoutDate = data.checkout_date ?? null;
      const arrivalOverride =
        typeof data.predicted_checkin_date === "string" &&
        data.predicted_checkin_date >= stayCheckinDate &&
        (!stayCheckoutDate || data.predicted_checkin_date < stayCheckoutDate)
          ? data.predicted_checkin_date
          : null;
      const departureOverride =
        typeof data.predicted_checkout_date === "string" &&
        data.predicted_checkout_date >= stayCheckinDate &&
        (!stayCheckoutDate || data.predicted_checkout_date <= stayCheckoutDate)
          ? data.predicted_checkout_date
          : null;

      const p = prop as {
        checkin_time?: string | null;
        checkin_time_max?: string | null;
        checkout_time?: string | null;
        checkout_time_min?: string | null;
      };
      const arrivalTimeRaw = data.guest_arrival_time?.trim() || null;
      const arrivalTimeOverride =
        arrivalTimeRaw &&
        withinTimeBounds(arrivalTimeRaw, p.checkin_time ?? null, p.checkin_time_max ?? null)
          ? arrivalTimeRaw
          : null;
      const departureTimeRaw = data.predicted_checkout_time?.trim() || null;
      const departureTimeOverride =
        departureTimeRaw &&
        withinTimeBounds(departureTimeRaw, p.checkout_time_min ?? null, p.checkout_time ?? null)
          ? departureTimeRaw
          : null;

      try {
        const writes: Array<PromiseLike<unknown>> = [];
        if (arrivalOverride || arrivalTimeOverride) {
          writes.push(
            supabaseAdmin.from("guest_arrival_status").upsert(
              {
                log_id: logId,
                property_id: prop.id,
                kind: "checkin",
                arrival_date_override: arrivalOverride,
                arrival_time_override: arrivalTimeOverride,
              } as never,
              { onConflict: "log_id,kind" },
            ),
          );
        }
        if (departureOverride || departureTimeOverride) {
          writes.push(
            supabaseAdmin.from("guest_arrival_status").upsert(
              {
                log_id: logId,
                property_id: prop.id,
                kind: "checkout",
                arrival_date_override: departureOverride,
                arrival_time_override: departureTimeOverride,
              } as never,
              { onConflict: "log_id,kind" },
            ),
          );
        }
        if (writes.length > 0) await Promise.all(writes);
      } catch {
        // Não derruba o cadastro do hóspede por falha ao gravar a previsão.
      }
    }

    /* REGISTRO OPERACIONAL SEM DADO PESSOAL (23/09/2026).
       Este trecho só escrevia uma linha de diagnóstico, mas levava junto o
       nome do hóspede e o e-mail do anfitrião — dados que ficavam guardados
       fora da sessão, num log que qualquer pessoa da operação lê. Agora
       registra apenas o imóvel acessado; quem precisa do detalhe consulta o
       histórico de acessos do próprio guia, que é protegido. */
    try {
      console.info(`[guide-access] acesso registrado no imóvel ${prop.id}`);
    } catch {
      // Falha de log nunca bloqueia o acesso do hóspede
    }


    // Comprovante assinado de QUEM se identificou (liga o navegador ao
    // registro criado agora) — exigido para marcar check-in/out e previsão.
    let stay_token: string | null = null;
    if (logId) {
      const { signGuestToken } = await import("@/lib/guest-access.server");
      stay_token = await signGuestToken(STAY_ACCESS_PURPOSE, {
        p: prop.id,
        l: logId,
        exp: Date.now() + 120 * 24 * 3600 * 1000,
      });
    }

    return {
      ok: true as const,
      stay_token,
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
    const { classifyCalendarPeriod, operationalTodayISO } =
      await import("@/lib/reservations.server");
    const propQuery = supabaseAdmin
      .from("properties")
      .select("id, airbnb_ical_url, airbnb_ical_last_sync_at")
      .eq("slug", data.slug)
      .eq("published", true);
    const { data: prop } = data.property_id
      ? await propQuery.eq("id", data.property_id).maybeSingle()
      : await propQuery.maybeSingle();
    if (!prop)
      return {
        hasIcal: false as const,
        periods: [] as Array<{ checkin: string; checkout: string; type: "reservation" | "block" }>,
      };
    const hasIcal = !!((prop.airbnb_ical_url as string | null) ?? "").trim();
    if (!hasIcal)
      return {
        hasIcal: false as const,
        periods: [] as Array<{ checkin: string; checkout: string; type: "reservation" | "block" }>,
      };
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
    for (const row of (rows ?? []) as Array<{
      checkin_date: string;
      checkout_date: string;
      raw_summary: string | null;
      status: string | null;
    }>) {
      const type = classifyCalendarPeriod(row);
      if (type === "reservation")
        periods.push({ checkin: row.checkin_date, checkout: row.checkout_date, type });
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
  checkout_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

/**
 * Status de check-in/check-out marcado pelo ANFITRIÃO (Kanban da Operação),
 * para a reserva do hóspede que está vendo o guia. Retorna apenas booleanos.
 */
export const getGuideStayStatus = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => StayStatusInput.parse(i))
  .handler(async ({ data }) => {
    const empty = { checkinDone: false, checkoutDone: false, noShow: false };
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-stay-status:${clientIpFrom(getRequest())}`, 60, 60_000))
      return empty;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const propQuery = supabaseAdmin
      .from("properties")
      .select("id")
      .eq("slug", data.slug)
      .eq("published", true);
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

    const logIds = (
      (logs ?? []) as Array<{ id: string; guest_name: string | null; checkout_date: string | null }>
    )
      .filter((l) => {
        if (data.checkout_date && l.checkout_date && l.checkout_date !== data.checkout_date)
          return false;
        if (guest && l.guest_name && norm(l.guest_name) !== guest) return false;
        return true;
      })
      .map((l) => l.id);
    const resIds = ((reservations ?? []) as Array<{ id: string; checkout_date: string }>)
      .filter((r) => !data.checkout_date || r.checkout_date === data.checkout_date)
      .map((r) => r.id);

    // "Não compareceu" vale para a ESTADIA inteira (imóvel + data de entrada),
    // sem filtrar por nome/saída — mesma regra do quadro e de
    // `isStayMarkedNoShow`. Por isso usa todas as linhas da data.
    const stayLogIds = ((logs ?? []) as Array<{ id: string }>).map((l) => l.id);
    const stayResIds = ((reservations ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (stayLogIds.length === 0 && stayResIds.length === 0) return empty;

    const { data: statuses } = await supabaseAdmin
      .from("guest_arrival_status")
      .select("kind, status, done_at, log_id, reservation_id")
      .eq("property_id", prop.id)
      .limit(500);

    let checkinDone = false;
    let checkoutDone = false;
    let noShow = false;
    for (const s of (statuses ?? []) as Array<{
      kind: string;
      status: string | null;
      done_at: string | null;
      log_id: string | null;
      reservation_id: string | null;
    }>) {
      if (
        s.kind === "checkin" &&
        s.status === "no_show" &&
        ((s.log_id && stayLogIds.includes(s.log_id)) ||
          (s.reservation_id && stayResIds.includes(s.reservation_id)))
      ) {
        noShow = true;
      }
      const belongs =
        (s.log_id && logIds.includes(s.log_id)) ||
        (s.reservation_id && resIds.includes(s.reservation_id));
      if (!belongs) continue;
      const done = s.status === "done" || !!s.done_at;
      if (!done) continue;
      if (s.kind === "checkin") checkinDone = true;
      if (s.kind === "checkout") checkoutDone = true;
    }
    return { checkinDone, checkoutDone, noShow };
  });

const MarkStepInput = StayStatusInput.extend({
  kind: z.enum(["checkin", "checkout"]),
  /** Código da reserva do hóspede — exigido nos guias com código (16/09/2026). */
  reservation_code: z.string().trim().max(40).optional().nullable(),
  stay_token: z.string().max(2000).optional().nullable(),
});

/**
 * O próprio hóspede marca "já fiz o check-in/check-out" no guia — o mesmo
 * status que o anfitrião marca no Kanban da Operação.
 */
export const markGuideStayStep = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => MarkStepInput.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-mark-step:${clientIpFrom(getRequest())}`, 20, 60_000))
      return { ok: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const propQuery = supabaseAdmin
      .from("properties")
      .select("id, tagline, airbnb_ical_url")
      .eq("slug", data.slug)
      .eq("published", true);
    const { data: prop } = data.property_id
      ? await propQuery.eq("id", data.property_id).maybeSingle()
      : await propQuery.maybeSingle();
    if (!prop) return { ok: false as const };

    /* QUEM MARCA PRECISA SER O HÓSPEDE (16/09/2026).
     *
     * Esta função é pública e grava o MESMO status que o anfitrião marca no
     * Kanban — é ele que libera a limpeza e fecha a estadia. Antes bastava o
     * slug e uma data de entrada (o nome era opcional) para marcar o check-out
     * de qualquer hóspede. Agora o nome é obrigatório e, nos guias com código
     * de reserva, o código precisa estar ativo e bater com a data informada. */
    const guestNameRaw = (data.guest_name ?? "").trim();
    if (!guestNameRaw) return { ok: false as const };
    const { isReservationGated, lookupReservationByCode: lookup } =
      await import("@/lib/guest-access.server");
    if (isReservationGated(prop as { tagline?: string | null; airbnb_ical_url?: string | null })) {
      const code = (data.reservation_code ?? "").trim();
      if (!code) return { ok: false as const };
      const res = await lookup(data.slug, prop.id as string, code);
      if (!res.ok || res.checkin_date !== data.checkin_date) return { ok: false as const };
    }
    // Comprovante assinado emitido na identificação: só o próprio hóspede
    // (o navegador que se identificou) consegue alterar o registro dele.
    const tokenLogId = await stayLogFromToken(data.stay_token, prop.id as string);
    if (!tokenLogId) return { ok: false as const, reason: "not_identified" as const };

    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const guest = norm(guestNameRaw);
    const { data: logs } = await supabaseAdmin
      .from("guide_access_logs")
      .select("id, guest_name, checkout_date")
      .eq("property_id", prop.id)
      .eq("checkin_date", data.checkin_date)
      .limit(200);
    const match = (
      (logs ?? []) as Array<{ id: string; guest_name: string | null; checkout_date: string | null }>
    ).find((l) => {
      if (data.checkout_date && l.checkout_date && l.checkout_date !== data.checkout_date)
        return false;
      if (l.id !== tokenLogId) return false;
      if (guest && l.guest_name && norm(l.guest_name) !== guest) return false;
      return true;
    });
    if (!match) return { ok: false as const };

    /* BARRAS "JÁ ACESSEI" / "JÁ SAÍ" (pedido explícito, 24/09/2026: "esses
     * botões precisam refletir diretamente no card da reserva dentro do
     * sistema").
     *
     * Antes esta função gravava SÓ pela chave do formulário (`log_id`). O
     * quadro, porém, lê primeiro a linha da RESERVA (`reservation_id`) — então
     * num card do iCal que já tinha linha própria (ex.: depois de o anfitrião
     * informar uma previsão) o toque do hóspede nunca movia o card. E pulava
     * os efeitos do avanço normal (fechar a estadia no check-out, aviso de
     * limpeza). Agora o avanço é EXATAMENTE o mesmo do botão do painel
     * (`runAdvanceArrival`), com as duas chaves quando existem. */
    const { operationalTodayISO, isRealReservation } = await import("@/lib/reservations.server");
    const { isStayMarkedNoShow, signGuestToken } = await import("@/lib/guest-access.server");
    if (await isStayMarkedNoShow(prop.id as string, data.checkin_date)) {
      return { ok: false as const, reason: "no_show" as const };
    }

    const { data: resRows } = await supabaseAdmin
      .from("property_reservations")
      .select("id, checkin_date, checkout_date, raw_summary, status, guest_hint")
      .eq("property_id", prop.id)
      .eq("checkin_date", data.checkin_date)
      .limit(20);
    const code = (data.reservation_code ?? "").trim().toUpperCase();
    const reais = (
      (resRows ?? []) as Array<{
        id: string;
        checkin_date: string;
        checkout_date: string;
        raw_summary: string | null;
        status: string | null;
        guest_hint: string | null;
      }>
    ).filter((r) => isRealReservation(r as never));
    const reservation =
      (code && reais.find((r) => (r.guest_hint ?? "").toUpperCase() === code)) ||
      reais.find((r) => !data.checkout_date || r.checkout_date === data.checkout_date) ||
      null;
    const checkoutDate =
      reservation?.checkout_date ?? match.checkout_date ?? data.checkout_date ?? null;

    // Nada de "já saí" antes do dia da saída (nem "já entrei" antes do dia da
    // entrada). Um dia de folga cobre imóveis em fuso à frente de São Paulo
    // (o relógio da operação), onde a meia-noite local chega antes.
    const addDaysISO = (iso: string, n: number) => {
      const [y, m, d] = iso.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + n);
      return dt.toISOString().slice(0, 10);
    };
    const today = operationalTodayISO();
    const earliest = data.kind === "checkin" ? data.checkin_date : checkoutDate;
    if (earliest && addDaysISO(today, 1) < earliest) {
      return { ok: false as const, reason: "too_early" as const };
    }

    const logId = match.id;
    const reservationId = reservation?.id ?? null;

    // Foto de ANTES — é com ela que o "Desfazer" devolve o card exatamente
    // como estava (mesmo racional do "Desfazer" do painel, 17/09/2026).
    const before = await readStayStatusRows(supabaseAdmin, logId, reservationId);

    try {
      const { runAdvanceArrival } = await import("@/lib/dashboard.functions");
      await runAdvanceArrival(supabaseAdmin as never, {
        logId,
        ...(reservationId ? { reservationId } : {}),
        from: data.kind === "checkin" ? "checkin" : "checkout",
      });
    } catch (err) {
      // A trava operacional do painel continua valendo (ex.: estadia anterior
      // ainda aberta no imóvel). O hóspede vê um aviso e a equipe resolve.
      console.error("[markGuideStayStep] avanço recusado:", err);
      return { ok: false as const, reason: "blocked" as const };
    }

    const undoToken = await signGuestToken(STAY_UNDO_PURPOSE, {
      p: prop.id,
      l: logId,
      r: reservationId,
      k: data.kind,
      b: before,
      exp: Date.now() + STAY_UNDO_WINDOW_MS,
    } satisfies StayUndoPayload);
    return { ok: true as const, undoToken };
  });

/* ------------------------------------------------------------------ *
 * "Desfazer" do hóspede (pedido explícito, 24/09/2026: "lembre-se de colocar
 * também aquele 'Desfazer' com 5 segundos, que implementamos no painel")
 * ------------------------------------------------------------------ */

const STAY_UNDO_PURPOSE = "guide-stay-undo";
// A tela oferece 5 s; o servidor aceita um pouco mais para cobrir rede lenta.
const STAY_UNDO_WINDOW_MS = 60_000;

const STAY_ROW_COLUMNS =
  "id, kind, status, done_at, concluded_at, cleaning_type, cleaning_price_cents, cleaning_approval_status, cleaning_done_by";

type StayRowSnapshot = {
  id: string;
  kind: string;
  status: string;
  done_at: string | null;
  concluded_at: string | null;
  cleaning_type: string | null;
  cleaning_price_cents: number | null;
  cleaning_approval_status: string | null;
  cleaning_done_by: string | null;
};

type StayUndoPayload = {
  p: string;
  l: string;
  r: string | null;
  k: "checkin" | "checkout";
  b: StayRowSnapshot[];
  exp: number;
};

async function readStayStatusRows(
  db: unknown,
  logId: string,
  reservationId: string | null,
): Promise<StayRowSnapshot[]> {
  const client = db as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const filter = reservationId
    ? `log_id.eq.${logId},reservation_id.eq.${reservationId}`
    : `log_id.eq.${logId}`;
  const { data } = await client
    .from("guest_arrival_status")
    .select(STAY_ROW_COLUMNS)
    .in("kind", ["checkin", "checkout"])
    .or(filter)
    .limit(10);
  return (data ?? []) as StayRowSnapshot[];
}

export const undoGuideStayStep = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(10).max(8000) }).parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-undo-step:${clientIpFrom(getRequest())}`, 20, 60_000))
      return { ok: false as const };
    const { verifyGuestToken } = await import("@/lib/guest-access.server");
    const payload = await verifyGuestToken<StayUndoPayload>(STAY_UNDO_PURPOSE, data.token);
    if (!payload || payload.exp < Date.now()) return { ok: false as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const current = await readStayStatusRows(supabaseAdmin, payload.l, payload.r);
    const beforeIds = new Set(payload.b.map((r) => r.id));

    // 1) Linhas que existiam: voltam exatamente ao que eram.
    for (const row of payload.b) {
      const { id, kind: _kind, ...cols } = row;
      const { error } = await db.from("guest_arrival_status").update(cols).eq("id", id);
      if (error) return { ok: false as const };
    }
    // 2) Linhas que o toque CRIOU (não estavam na foto): somem.
    const created = current.filter((r) => !beforeIds.has(r.id)).map((r) => r.id);
    if (created.length > 0) {
      const { error } = await db.from("guest_arrival_status").delete().in("id", created);
      if (error) return { ok: false as const };
    }
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

/* A consulta em si mora em `guest-access.server.ts` (16/09/2026): o guia e o
 * chat do hóspede passaram a usá-la para liberar senhas, e ela ganhou a trava
 * contra curingas do `ilike` — antes um código "%%%%" casava com QUALQUER
 * reserva do imóvel e passava pelo formulário. */
async function lookupReservationByCode(
  slug: string,
  propertyId: string | undefined,
  rawCode: string,
) {
  const { lookupReservationByCode: lookup } = await import("@/lib/guest-access.server");
  return lookup(slug, propertyId, rawCode);
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
    if (res.reason === "no_ical" || res.reason === "not_found")
      return { active: null as boolean | null };
    return { active: false as boolean | null, reason: res.reason };
  });

/* ------------------------------------------------------------------ *
 * PREVISÃO DE HORÁRIO PELO PRÓPRIO HÓSPEDE (pedido explícito, 24/09/2026,
 * mockup aprovado "Previsão — seletor de horário do hóspede"): uma tela nova
 * dentro do guia (chegada, logo depois da confirmação; saída, na aba
 * "Saída") deixa o hóspede escolher data + horário previstos numa grade só,
 * sem navegar entre telas.
 *
 * Grava exatamente na MESMA tabela que o editor de previsão do painel
 * (`guest_arrival_status`, upsert por `kind` "checkin"/"checkout") — é assim
 * que o card da reserva no painel reflete automaticamente o que o hóspede
 * escolheu aqui, sem nenhuma sincronização extra: os dois leem/gravam a
 * mesma linha (pedido explícito: "a data/horário inserido pelo hóspede
 * deverá ser automaticamente inserida nos mesmos campos de previsão no card
 * do cliente").
 *
 * `upsertArrivalStatus` (em `dashboard.functions.ts`) faz a mesma gravação,
 * mas exige sessão autenticada da equipe (`requireSupabaseAuth`) — não dá
 * pra reaproveitar direto numa tela pública. Esta função espelha o mesmo
 * upsert atômico (com o mesmo cuidado de corrida quando os dois
 * identificadores coexistem), mas com a verificação de identidade pública
 * do `markGuideStayStep` (nome do hóspede + código da reserva quando o guia
 * exige) no lugar da sessão autenticada.
 */
const PredictedTimeInput = StayStatusInput.extend({
  kind: z.enum(["checkin", "checkout"]),
  reservation_code: z.string().trim().max(40).optional().nullable(),
  stay_token: z.string().max(2000).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const submitPredictedTime = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => PredictedTimeInput.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-predicted-time:${clientIpFrom(getRequest())}`, 20, 60_000))
      return { ok: false as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const propQuery = supabaseAdmin
      .from("properties")
      .select(
        "id, tagline, airbnb_ical_url, checkin_time, checkin_time_max, checkout_time, checkout_time_min",
      )
      .eq("slug", data.slug)
      .eq("published", true);
    const { data: prop } = data.property_id
      ? await propQuery.eq("id", data.property_id).maybeSingle()
      : await propQuery.maybeSingle();
    if (!prop) return { ok: false as const };

    // MESMA verificação de identidade do "já acessei/já saí" (16/09/2026):
    // pública, então nome do hóspede é obrigatório e, nos guias com código
    // de reserva, o código precisa bater com a data informada.
    const guestNameRaw = (data.guest_name ?? "").trim();
    if (!guestNameRaw) return { ok: false as const };
    const { isReservationGated, lookupReservationByCode: lookup } =
      await import("@/lib/guest-access.server");
    if (isReservationGated(prop as { tagline?: string | null; airbnb_ical_url?: string | null })) {
      const code = (data.reservation_code ?? "").trim();
      if (!code) return { ok: false as const };
      const res = await lookup(data.slug, prop.id as string, code);
      if (!res.ok || res.checkin_date !== data.checkin_date) return { ok: false as const };
    }
    // Comprovante assinado emitido na identificação: só o próprio hóspede
    // (o navegador que se identificou) consegue alterar o registro dele.
    const tokenLogId = await stayLogFromToken(data.stay_token, prop.id as string);
    if (!tokenLogId) return { ok: false as const, reason: "not_identified" as const };

    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const guest = norm(guestNameRaw);
    const { data: logs } = await supabaseAdmin
      .from("guide_access_logs")
      .select("id, guest_name, checkin_date, checkout_date")
      .eq("property_id", prop.id)
      .eq("checkin_date", data.checkin_date)
      .limit(200);
    const match = (
      (logs ?? []) as Array<{
        id: string;
        guest_name: string | null;
        checkin_date: string;
        checkout_date: string | null;
      }>
    ).find((l) => {
      if (data.checkout_date && l.checkout_date && l.checkout_date !== data.checkout_date)
        return false;
      if (l.id !== tokenLogId) return false;
      if (guest && l.guest_name && norm(l.guest_name) !== guest) return false;
      return true;
    });
    if (!match) return { ok: false as const };

    // Mesma reserva real (iCal) que o "já acessei/já saí" casa — quando
    // existe, a previsão grava nos dois identificadores (ver upsert abaixo).
    const { isRealReservation } = await import("@/lib/reservations.server");
    const { data: resRows } = await supabaseAdmin
      .from("property_reservations")
      .select("id, checkin_date, checkout_date, raw_summary, status, guest_hint")
      .eq("property_id", prop.id)
      .eq("checkin_date", data.checkin_date)
      .limit(20);
    const code = (data.reservation_code ?? "").trim().toUpperCase();
    const reais = (
      (resRows ?? []) as Array<{
        id: string;
        checkin_date: string;
        checkout_date: string;
        raw_summary: string | null;
        status: string | null;
        guest_hint: string | null;
      }>
    ).filter((r) => isRealReservation(r as never));
    const reservation =
      (code && reais.find((r) => (r.guest_hint ?? "").toUpperCase() === code)) ||
      reais.find((r) => !data.checkout_date || r.checkout_date === data.checkout_date) ||
      null;

    // TRAVA NO SERVIDOR da janela do imóvel (não só decoração da tela — sem
    // isto nada impede um bypass direto pela API). Mesma regra do editor do
    // painel: a janela só vale enquanto a data prevista cai no MESMO dia da
    // reserva confirmada — mudou o dia, qualquer horário passa a ser
    // possível (ex.: chegada adiada pro dia seguinte).
    const confirmedDate =
      data.kind === "checkout"
        ? (reservation?.checkout_date ?? match.checkout_date ?? data.checkout_date ?? null)
        : data.checkin_date;
    if (confirmedDate && data.date === confirmedDate) {
      const { isTimeWithin } = await import("@/lib/time-window");
      const windowMin =
        data.kind === "checkout"
          ? ((prop.checkout_time_min as string | null) ?? null)
          : ((prop.checkin_time as string | null) ?? null);
      const windowMax =
        data.kind === "checkout"
          ? ((prop.checkout_time as string | null) ?? null)
          : ((prop.checkin_time_max as string | null) ?? null);
      if (windowMin && !isTimeWithin(data.time, windowMin, windowMax)) {
        return { ok: false as const, reason: "outside_window" as const };
      }
    }

    const patch: {
      log_id: string;
      reservation_id?: string;
      property_id: string;
      kind: "checkin" | "checkout";
      arrival_date_override: string;
      arrival_time_override: string;
    } = {
      log_id: match.id,
      property_id: prop.id as string,
      kind: data.kind,
      arrival_date_override: data.date,
      arrival_time_override: data.time,
    };
    if (reservation?.id) patch.reservation_id = reservation.id;

    // Mesmo upsert atômico (com a mesma cautela de corrida quando os dois
    // identificadores coexistem) de `upsertArrivalStatus` — ver o comentário
    // longo lá para o porquê da consulta extra só nesse caso.
    if (reservation?.id) {
      const { data: existing, error: findErr } = await supabaseAdmin
        .from("guest_arrival_status")
        .select("id")
        .eq("kind", data.kind)
        .or(`log_id.eq.${match.id},reservation_id.eq.${reservation.id}`)
        .limit(1);
      if (findErr) return { ok: false as const };
      const existingId = (existing?.[0] as { id: string } | undefined)?.id;
      const { error } = existingId
        ? await supabaseAdmin.from("guest_arrival_status").update(patch).eq("id", existingId)
        : await supabaseAdmin.from("guest_arrival_status").insert(patch);
      if (error) return { ok: false as const };
      return { ok: true as const };
    }

    const { error } = await supabaseAdmin
      .from("guest_arrival_status")
      .upsert(patch, { onConflict: "log_id,kind" });
    if (error) return { ok: false as const };
    return { ok: true as const };
  });
