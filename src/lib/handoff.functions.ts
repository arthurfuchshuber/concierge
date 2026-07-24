import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireMemberPermission } from "@/lib/member-permissions.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emptyHandoffListResult,
  normalizeHandoffConversationRows,
  parseHandoffConversationInput,
  parseHandoffListInput,
  parseHandoffSendInput,
  parseHandoffTransferInput,
  type HandoffConversationSummary,
  type HandoffGuestDetail,
  type HandoffListResult,
} from "@/lib/handoff.schemas";

// Resolve the owner_id of the property behind a conversation, then enforce chat_respond.
async function requireChatRespondForConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<void> {
  const { data: conv } = await supabase
    .from("property_chat_conversations")
    .select("property_id, properties:property_id(owner_id)")
    .eq("id", conversationId)
    .maybeSingle();
  const ownerId = (conv?.properties as { owner_id?: string } | null)?.owner_id;
  if (!ownerId) return; // conversa órfã: deixa a RLS decidir
  await requireMemberPermission(supabase, userId, ownerId, "chat_respond");
}


// -------- List conversations for the current user (filtered by queue) --------

export const listHandoffConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffListInput)
  .handler(async ({ data, context }): Promise<HandoffListResult> => {
    let list: HandoffConversationSummary[] = [];
    try {
      const { supabase, userId } = context;

      // Auto-encerra conversas com a IA sem atividade há mais de 1 hora → resolvidas.
      try {
        const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await supabase
          .from("property_chat_conversations")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("status", "ai")
          .lt("last_message_at", cutoff);
      } catch (e) {
        // não bloqueia leitura
        console.warn("auto-resolve AI stale failed", e);
      }

      let q = supabase
        .from("property_chat_conversations")
        .select(
          "id, property_id, guest_session_id, guest_name, status, ai_paused, assigned_to, handoff_reason, handoff_urgency, handoff_at, last_message_at, created_at, resolved_at, properties:property_id(id, name, owner_id, slug)",
        )
        .order("handoff_at", { ascending: false, nullsFirst: false })
        .order("last_message_at", { ascending: false })
        .limit(data.limit);

      if (data.queue === "needs_human") q = q.eq("status", "needs_human");
      else if (data.queue === "assigned_to_me") q = q.eq("assigned_to", userId).in("status", ["assigned", "needs_human"]);
      else if (data.queue === "all_active") q = q.in("status", ["needs_human", "assigned"]);
      else if (data.queue === "ai_only") q = q.eq("status", "ai");
      else if (data.queue === "resolved") q = q.eq("status", "resolved");
      // "all" → sem filtro de status

      const { data: rows, error } = await q;
      if (error) {
        console.error("listHandoffConversations failed", error);
        return emptyHandoffListResult(error.message);
      }
      list = normalizeHandoffConversationRows(rows);
    } catch (error) {
      console.error("listHandoffConversations crashed", error);
      return emptyHandoffListResult("Não foi possível carregar as conversas agora.");
    }


    // Enriquece cada conversa com nome do hóspede, telefone e check-in.
    // A identidade primária vem de guest_name da conversa; quando ela não existe,
    // usamos guide_section_events pelo guest_session_id antes de qualquer fallback.
    // A unificação usa apenas identidade real/enriquecida; fallback é só visual.
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "").replace(/^0+/, "");
    const timeOf = (iso: string | null | undefined) => {
      const t = iso ? Date.parse(iso) : NaN;
      return Number.isFinite(t) ? t : 0;
    };
    const isPreviewName = (s: string | null | undefined) =>
      !!s && /pr[eé]\s*-?\s*visualiza|preview/i.test(s.trim());
    const details: Record<string, HandoffGuestDetail> = {};
    const mergeDetails: Record<string, HandoffGuestDetail> = {};
    if (list.length > 0) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const propIds = Array.from(new Set(list.map((c) => c.property_id).filter(Boolean) as string[]));
        const [logsR, eventsR] = await Promise.all([
          supabaseAdmin
            .from("guide_access_logs")
            .select("property_id, guest_name, guest_phone, guest_phone_country, checkin_date, checkout_date, reservation_code, created_at")
            .in("property_id", propIds)
            .order("created_at", { ascending: false })
            .limit(5000),
          (supabaseAdmin.from("guide_section_events" as never) as ReturnType<typeof supabaseAdmin.from>)
            .select("property_id, guest_session_id, guest_name, guest_phone, created_at")
            .in("property_id", propIds)
            .order("created_at", { ascending: false })
            .limit(10000),
        ]);


        type LogRow = {
          property_id: string;
          guest_name: string | null;
          guest_phone: string | null;
          guest_phone_country: string | null;
          checkin_date: string | null;
          checkout_date: string | null;
          reservation_code: string | null;
          created_at: string;
        };
        type EventRow = {
          property_id: string;
          guest_session_id: string | null;
          guest_name: string | null;
          guest_phone: string | null;
          created_at: string;
        };
        const logs = (logsR.data ?? []) as Array<{
          property_id: string;
          guest_name: string | null;
          guest_phone: string | null;
          guest_phone_country: string | null;
          checkin_date: string | null;
          checkout_date: string | null;
          reservation_code: string | null;
          created_at: string;
        }>;
        const events = (eventsR.data ?? []) as EventRow[];
        const logRows: LogRow[] = [];
        const latestEventBySession = new Map<string, EventRow>();

        for (const l of logs) {
          // Ignora registros de "Pré-visualização" (acesso do admin em modo preview)
          // para que não vazem como nome do hóspede na fila de atendimento.
          if (isPreviewName(l.guest_name as string | null)) continue;
          const row: LogRow = {
            property_id: l.property_id as string,
            guest_name: l.guest_name as string | null,
            guest_phone: l.guest_phone as string | null,
            guest_phone_country: l.guest_phone_country as string | null,
            checkin_date: (l.checkin_date as string | null) ?? null,
            checkout_date: (l.checkout_date as string | null) ?? null,
            reservation_code: (l.reservation_code as string | null) ?? null,
            created_at: l.created_at as string,
          };
          logRows.push(row);
        }

        for (const e of events) {
          if (!e.guest_session_id) continue;
          const key = `${e.property_id}|${e.guest_session_id}`;
          const sanitizedEvent: EventRow = {
            ...e,
            guest_name: isPreviewName(e.guest_name) ? null : e.guest_name,
          };
          if (!sanitizedEvent.guest_name && !sanitizedEvent.guest_phone) continue;
          if (!latestEventBySession.has(key)) {
            latestEventBySession.set(key, sanitizedEvent);
          }
        }

        const chooseLog = (conv: HandoffConversationSummary, identity: { name?: string | null; phone?: string | null }) => {
          const propId = conv.property_id ?? "";
          const name = norm(identity.name);
          const phone = onlyDigits(identity.phone);
          const convTime = timeOf(conv.last_message_at ?? conv.created_at);
          const candidates = logRows.filter((l) => {
            if (l.property_id !== propId) return false;
            if (phone && onlyDigits(l.guest_phone) === phone) return true;
            if (name && norm(l.guest_name) === name) return true;
            return false;
          });
          if (candidates.length === 0) return null;
          return candidates.sort((a, b) => {
            const da = Math.abs(timeOf(a.created_at) - convTime);
            const db = Math.abs(timeOf(b.created_at) - convTime);
            if (da !== db) return da - db;
            return (b.checkin_date ?? "").localeCompare(a.checkin_date ?? "") || b.created_at.localeCompare(a.created_at);
          })[0];
        };

        const chooseNearestVisualLog = (conv: HandoffConversationSummary) => {
          const propId = conv.property_id ?? "";
          const anchor = timeOf(conv.created_at) || timeOf(conv.last_message_at);
          const fallbackWindowMs = 1000 * 60 * 60 * 96;
          if (!propId || !anchor) return null;
          const candidates = logRows.filter((l) => {
            if (l.property_id !== propId) return false;
            if (!l.guest_name && !l.guest_phone) return false;
            return Math.abs(timeOf(l.created_at) - anchor) <= fallbackWindowMs;
          });
          if (candidates.length === 0) return null;
          return candidates.sort((a, b) => {
            const da = Math.abs(timeOf(a.created_at) - anchor);
            const db = Math.abs(timeOf(b.created_at) - anchor);
            if (da !== db) return da - db;
            return (b.checkin_date ?? "").localeCompare(a.checkin_date ?? "") || b.created_at.localeCompare(a.created_at);
          })[0];
        };

        for (const conv of list) {
          const eventMatch = conv.guest_session_id
            ? latestEventBySession.get(`${conv.property_id}|${conv.guest_session_id}`)
            : null;
          const identity = {
            name: isPreviewName(conv.guest_name) ? (eventMatch?.guest_name ?? null) : (conv.guest_name ?? eventMatch?.guest_name ?? null),
            phone: eventMatch?.guest_phone ?? null,
          };
          const matchedLog = chooseLog(conv, identity);
          if (matchedLog) {
            const d: HandoffGuestDetail = {
              name: matchedLog.guest_name ?? identity.name,
              phone: matchedLog.guest_phone,
              phoneCountry: matchedLog.guest_phone_country,
              checkinDate: matchedLog.checkin_date,
              checkoutDate: matchedLog.checkout_date,
              reservationCode: matchedLog.reservation_code,
            };
            details[conv.id as string] = d;
            mergeDetails[conv.id as string] = d;
          } else if (eventMatch?.guest_name || eventMatch?.guest_phone) {
            details[conv.id as string] = {
              name: eventMatch.guest_name ?? identity.name,
              phone: eventMatch.guest_phone,
              phoneCountry: null,
              checkinDate: null,
              checkoutDate: null,
              reservationCode: null,
            };
          } else {
            // Fallback visual: usa o acesso mais próximo do início da conversa,
            // não o hóspede mais recente do imóvel. Assim recupera nomes de
            // conversas antigas sem grudar tudo no último hóspede que acessou.
            const fallback = chooseNearestVisualLog(conv);
            if (fallback) {
              details[conv.id as string] = {
                name: fallback.guest_name ?? identity.name,
                phone: fallback.guest_phone,
                phoneCountry: fallback.guest_phone_country,
                checkinDate: fallback.checkin_date,
                checkoutDate: fallback.checkout_date,
                reservationCode: fallback.reservation_code,
              };
              mergeDetails[conv.id as string] = details[conv.id as string];
            }
          }

        }
      } catch {
        // silencioso — se falhar, seguimos apenas com o que temos na conversa
      }
    }

    // Unifica conversas do mesmo hóspede (Nome preenchido + Data de Check-in + Guia).
    const bestByKey = new Map<string, HandoffConversationSummary>();
    const ordered: HandoffConversationSummary[] = [];
    const keyFor = (c: HandoffConversationSummary): string => {
      const d = mergeDetails[c.id as string];
      const name = norm(d?.name ?? c.guest_name);
      const checkin = d?.checkinDate ?? "";
      const propId = c.property_id ?? "";
      return name && checkin && propId ? `${propId}|${name}|${checkin}` : `__solo__:${c.id}`;
    };
    for (const conv of list) {
      const key = keyFor(conv);
      const prev = bestByKey.get(key);
      const prevTs = prev ? Date.parse(prev.last_message_at ?? "") : -1;
      const curTs = Date.parse(conv.last_message_at ?? "");
      if (!prev) {
        bestByKey.set(key, conv);
        ordered.push(conv);
      } else if (curTs > prevTs) {
        const idx = ordered.indexOf(prev);
        if (idx >= 0) ordered[idx] = conv;
        bestByKey.set(key, conv);
      }
    }
    const deduped = ordered.filter((c) => bestByKey.get(keyFor(c)) === c);

    // Ordena: 1) data/hora da última mensagem (desc); 2) data/hora do check-in do guia (desc).
    deduped.sort((a, b) => {
      const aMsg = Date.parse(a.last_message_at ?? "") || 0;
      const bMsg = Date.parse(b.last_message_at ?? "") || 0;
      if (bMsg !== aMsg) return bMsg - aMsg;
      const aCk = Date.parse(mergeDetails[a.id as string]?.checkinDate ?? "") || 0;
      const bCk = Date.parse(mergeDetails[b.id as string]?.checkinDate ?? "") || 0;
      return bCk - aCk;
    });

    // Enriquece com nomes dos atendentes atribuídos (para a coluna "Com alguém").
    const assignedNames: Record<string, string> = {};
    try {
      const assignedIds = Array.from(
        new Set(deduped.map((c) => c.assigned_to).filter((v): v is string => !!v)),
      );
      if (assignedIds.length > 0) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: profs } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, trade_name")
          .in("id", assignedIds);
        const byId = new Map<string, string>();
        for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null; trade_name: string | null }>) {
          const name = (p.full_name || p.trade_name || "").trim();
          if (name) byId.set(p.id, name);
        }


        for (const c of deduped) {
          if (c.assigned_to) {
            const n = byId.get(c.assigned_to);
            if (n) assignedNames[c.id] = n;
          }
        }
      }
    } catch (e) {
      console.warn("assigned names lookup failed", e);
    }

    // Cruzamento com reservas Airbnb (iCal) — status por conversa.
    const reservations: Record<string, import("@/lib/handoff.schemas").HandoffReservationMatch> = {};
    try {
      const propIds = Array.from(new Set(deduped.map((c) => c.property_id).filter((v): v is string => !!v)));
      if (propIds.length > 0) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const [propsR, resR] = await Promise.all([
          supabaseAdmin.from("properties").select("id, airbnb_ical_url").in("id", propIds),
          supabaseAdmin
            .from("property_reservations")
            .select("property_id, checkin_date, checkout_date")
            .in("property_id", propIds)
            .eq("source", "airbnb"),
        ]);
        const hasIcal = new Set<string>();
        for (const p of (propsR.data ?? []) as Array<{ id: string; airbnb_ical_url: string | null }>) {
          if (p.airbnb_ical_url && p.airbnb_ical_url.trim()) hasIcal.add(p.id);
        }
        const byProp = new Map<string, Array<{ checkin: string; checkout: string }>>();
        for (const r of (resR.data ?? []) as Array<{ property_id: string; checkin_date: string; checkout_date: string }>) {
          const list = byProp.get(r.property_id) ?? [];
          list.push({ checkin: r.checkin_date, checkout: r.checkout_date });
          byProp.set(r.property_id, list);
        }
        for (const conv of deduped) {
          const pid = conv.property_id ?? "";
          if (!pid || !hasIcal.has(pid)) {
            reservations[conv.id] = { status: "no_ical", checkin: null, checkout: null };
            continue;
          }
          const det = mergeDetails[conv.id];
          const ci = det?.checkinDate ?? null;
          const co = det?.checkoutDate ?? null;
          if (!ci) {
            reservations[conv.id] = { status: "missing", checkin: null, checkout: null };
            continue;
          }
          const rows = byProp.get(pid) ?? [];
          const exact = rows.find((r) => r.checkin === ci && (!co || r.checkout === co));
          if (exact) {
            reservations[conv.id] = { status: "confirmed", checkin: exact.checkin, checkout: exact.checkout };
            continue;
          }
          const loose = rows.find((r) => r.checkin === ci);
          reservations[conv.id] = loose
            ? { status: "loose", checkin: loose.checkin, checkout: loose.checkout }
            : { status: "missing", checkin: null, checkout: null };
        }
      }
    } catch (e) {
      console.warn("reservation cross-check failed", e);
    }

    return {
      conversations: deduped.map((c) => (isPreviewName(c.guest_name) ? { ...c, guest_name: null } : c)),
      details,
      assignedNames,
      reservations,
    };
  });






// -------- Get one conversation with messages --------

export const getHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const isPreviewName = (s: string | null | undefined) =>
      !!s && /pr[eé]\s*-?\s*visualiza|preview/i.test(s.trim());
    const [{ data: conv, error: cErr }, { data: msgs, error: mErr }] = await Promise.all([
      supabase
        .from("property_chat_conversations")
        .select(
          "id, property_id, guest_session_id, guest_name, status, ai_paused, assigned_to, claim_requested_by, claim_requested_at, handoff_reason, handoff_urgency, handoff_at, last_message_at, created_at, resolved_at, properties:property_id(id, name, owner_id, slug, city)",
        )
        .eq("id", data.conversationId)
        .maybeSingle(),
      supabase
        .from("property_chat_messages")
        .select(
          "id, role, content, sender_type, sender_user_id, is_internal_note, created_at, attachment_path, attachment_type, attachment_mime, attachment_duration_ms, attachment_size_bytes, attachment_name",
        )
        .eq("conversation_id", data.conversationId)
        .order("created_at", { ascending: true }),
    ]);
    if (cErr) throw new Error(cErr.message);
    if (mErr) throw new Error(mErr.message);
    if (!conv) throw new Error("Conversa não encontrada.");

    // Busca o registro de acesso mais recente (nome, telefone, checkin) via service-role
    // — a RLS de guide_access_logs só permite owner; usamos admin porque a RLS de
    // property_chat_conversations já confirmou que o usuário pode ver esta conversa.
    let guestDetails: {
      name: string | null;
      phone: string | null;
      phoneCountry: string | null;
      checkinDate: string | null;
      checkoutDate: string | null;
      reservationCode: string | null;
    } = { name: null, phone: null, phoneCountry: null, checkinDate: null, checkoutDate: null, reservationCode: null };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (conv.property_id) {
        const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "").replace(/^0+/, "");
        const timeOf = (iso: string | null | undefined) => {
          const t = iso ? Date.parse(iso) : NaN;
          return Number.isFinite(t) ? t : 0;
        };
        let identity: { name: string | null; phone: string | null } = { name: isPreviewName(conv.guest_name) ? null : conv.guest_name, phone: null };
        if ((!identity.name || !identity.phone) && conv.guest_session_id) {
          const { data: events } = await (supabaseAdmin.from("guide_section_events" as never) as ReturnType<typeof supabaseAdmin.from>)
            .select("guest_name, guest_phone, created_at")
            .eq("property_id", conv.property_id)
            .eq("guest_session_id", conv.guest_session_id)
            .or("guest_name.not.is.null,guest_phone.not.is.null")
            .order("created_at", { ascending: false })
            .limit(20);
          const event = (events as Array<{ guest_name: string | null; guest_phone: string | null }> | null)
            ?.find((e) => !isPreviewName(e.guest_name) && (!!e.guest_name || !!e.guest_phone));
          if (event) identity = { name: event.guest_name, phone: event.guest_phone };
        }

        const phone = onlyDigits(identity.phone);
        const name = norm(identity.name);
        type AccessLog = { guest_name: string | null; guest_phone: string | null; guest_phone_country: string | null; checkin_date: string | null; checkout_date: string | null; reservation_code: string | null; created_at: string };
        let log: AccessLog | null = null;
        if (name || phone) {
          const { data: logs } = await supabaseAdmin
            .from("guide_access_logs")
            .select("guest_name, guest_phone, guest_phone_country, checkin_date, checkout_date, reservation_code, created_at")
            .eq("property_id", conv.property_id)
            .order("checkin_date", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(100);
          log = ((logs ?? []) as AccessLog[]).filter((l) => !isPreviewName(l.guest_name)).find((l) =>
            (phone && onlyDigits(l.guest_phone) === phone) || (name && norm(l.guest_name) === name),
          ) ?? null;
        }
        if (!log) {
          const anchor = timeOf(conv.created_at) || timeOf(conv.last_message_at);
          const { data: logs } = await supabaseAdmin
            .from("guide_access_logs")
            .select("guest_name, guest_phone, guest_phone_country, checkin_date, checkout_date, reservation_code, created_at")
            .eq("property_id", conv.property_id)
            .order("created_at", { ascending: false })
            .limit(500);
          log = ((logs ?? []) as AccessLog[]).filter((l) => {
            if (isPreviewName(l.guest_name)) return false;
            if (!anchor || (!l.guest_name && !l.guest_phone)) return false;
            return Math.abs(timeOf(l.created_at) - anchor) <= 1000 * 60 * 60 * 96;
          }).sort((a, b) => Math.abs(timeOf(a.created_at) - anchor) - Math.abs(timeOf(b.created_at) - anchor))[0] ?? null;
        }
        if (log) {
          guestDetails = {
            name: log.guest_name ?? identity.name,
            phone: log.guest_phone,
            phoneCountry: log.guest_phone_country,
            checkinDate: log.checkin_date,
            checkoutDate: log.checkout_date,
            reservationCode: log.reservation_code,
          };
        } else if (identity.name || identity.phone) {
          guestDetails = { ...guestDetails, name: identity.name, phone: identity.phone };
        }
      }

    } catch {
      // silencioso — se não achar, seguimos com o que temos
    }


    // Nome do solicitante do claim (se houver)
    let claimRequester: { userId: string; displayName: string | null } | null = null;
    if (conv.claim_requested_by) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", conv.claim_requested_by)
        .maybeSingle();
      claimRequester = {
        userId: conv.claim_requested_by,
        displayName: prof?.full_name ?? null,
      };
    }
    let assignedProfile: { userId: string; displayName: string | null } | null = null;
    if (conv.assigned_to) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", conv.assigned_to)
        .maybeSingle();
      assignedProfile = { userId: conv.assigned_to, displayName: prof?.full_name ?? null };
    }

    // Perfis de todos os remetentes humanos (para exibir o nome em negrito nas mensagens).
    const senderIds = Array.from(
      new Set(
        (msgs ?? [])
          .map((m) => (m as { sender_user_id: string | null }).sender_user_id)
          .filter((v): v is string => !!v),
      ),
    );
    const senderProfiles: Record<string, { displayName: string | null }> = {};
    if (senderIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", senderIds);
      for (const p of profs ?? []) {
        senderProfiles[p.id as string] = { displayName: (p.full_name as string) ?? null };
      }
    }

    return {
      conversation: isPreviewName(conv.guest_name) ? { ...conv, guest_name: null } : conv,
      messages: msgs ?? [],
      guestDetails,
      claimRequester,
      assignedProfile,
      senderProfiles,
    };
  });

// -------- Claim / assign to me (bloqueia se já está com outro atendente) --------

export const claimHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireChatRespondForConversation(supabase, userId, data.conversationId);

    // Assumir sempre é permitido — se já pertence a outro, registra uma nota interna
    // avisando quem assumiu. A confirmação (popup) é feita no cliente.
    const { data: cur, error: readErr } = await supabase
      .from("property_chat_conversations")
      .select("assigned_to, status")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!cur) throw new Error("Conversa não encontrada.");
    const previousAssignee = cur.assigned_to as string | null;
    const takingOver = previousAssignee && previousAssignee !== userId;

    const { error } = await supabase
      .from("property_chat_conversations")
      .update({
        status: "assigned",
        assigned_to: userId,
        ai_paused: true,
        claim_requested_by: null,
        claim_requested_at: null,
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);

    if (takingOver) {
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
      const who = prof?.full_name ?? "Um membro da equipe";
      await supabase.from("property_chat_messages").insert({
        conversation_id: data.conversationId,
        role: "assistant",
        content: `↪ ${who} assumiu esta conversa.`,
        sender_type: "human",
        sender_user_id: userId,
        is_internal_note: true,
      });
    }
    return { ok: true };
  });

// -------- Solicitar acesso a uma conversa já assumida por outro --------

export const requestHandoffClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cur, error: readErr } = await supabase
      .from("property_chat_conversations")
      .select("assigned_to")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!cur) throw new Error("Conversa não encontrada.");
    if (!cur.assigned_to) throw new Error("Conversa livre — assuma diretamente.");
    if (cur.assigned_to === userId) return { ok: true, alreadyMine: true };

    const { error } = await supabase
      .from("property_chat_conversations")
      .update({ claim_requested_by: userId, claim_requested_at: new Date().toISOString() })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);

    // Registra nota interna para o atendente atual visualizar o pedido.
    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    const who = prof?.full_name ?? "Um membro da equipe";
    await supabase.from("property_chat_messages").insert({
      conversation_id: data.conversationId,
      role: "assistant",
      content: `🔔 ${who} solicitou acesso a esta conversa.`,
      sender_type: "human",
      sender_user_id: userId,
      is_internal_note: true,
    });
    return { ok: true };
  });

// -------- Transferir a conversa para outro membro (só quem está atendendo) --------

export const transferHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffTransferInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cur, error: readErr } = await supabase
      .from("property_chat_conversations")
      .select("assigned_to")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!cur) throw new Error("Conversa não encontrada.");
    if (cur.assigned_to !== userId) {
      throw new Error("Apenas o atendente responsável pode transferir esta conversa.");
    }
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({
        assigned_to: data.toUserId,
        status: "assigned",
        ai_paused: true,
        claim_requested_by: null,
        claim_requested_at: null,
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);

    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", data.toUserId).maybeSingle();
    const who = prof?.full_name ?? "outro membro";
    await supabase.from("property_chat_messages").insert({
      conversation_id: data.conversationId,
      role: "assistant",
      content: `🔁 Conversa transferida para ${who}.`,
      sender_type: "human",
      sender_user_id: userId,
      is_internal_note: true,
    });
    return { ok: true };
  });

// -------- Cancelar solicitação de acesso pendente (quem solicitou) --------

export const cancelHandoffClaimRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({ claim_requested_by: null, claim_requested_at: null })
      .eq("id", data.conversationId)
      .eq("claim_requested_by", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Release back to AI --------

export const releaseHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({
        status: "ai",
        assigned_to: null,
        ai_paused: false,
        handoff_reason: null,
        handoff_at: null,
        handoff_urgency: null,
        claim_requested_by: null,
        claim_requested_at: null,
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Resolve --------

export const resolveHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        ai_paused: false,
        claim_requested_by: null,
        claim_requested_at: null,
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// -------- Send a human/agent message --------

export const sendHandoffMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffSendInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireChatRespondForConversation(supabase, userId, data.conversationId);

    const { data: cur } = await supabase
      .from("property_chat_conversations")
      .select("assigned_to")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (cur?.assigned_to && cur.assigned_to !== userId) {
      throw new Error("Esta conversa está sendo atendida por outro membro. Solicite acesso ou peça uma transferência.");
    }
    const { error } = await supabase.from("property_chat_messages").insert({
      conversation_id: data.conversationId,
      role: data.internalNote ? "assistant" : "assistant",
      content: data.content,
      sender_type: "human",
      sender_user_id: userId,
      is_internal_note: data.internalNote,
    });
    if (error) throw new Error(error.message);
    // Ensure conversation status stays assigned + ai paused when agent replies
    if (!data.internalNote) {
      await supabase
        .from("property_chat_conversations")
        .update({ ai_paused: true, status: "assigned", assigned_to: userId, last_message_at: new Date().toISOString() })
        .eq("id", data.conversationId);

      // Dispara push para o hóspede (se ele tiver ativado notificações).
      try {
        const { data: conv } = await supabase
          .from("property_chat_conversations")
          .select("id, properties:property_id(name, slug)")
          .eq("id", data.conversationId)
          .maybeSingle();
        const propName = (conv?.properties as { name?: string } | null)?.name ?? "Anfitrião";
        const slug = (conv?.properties as { slug?: string } | null)?.slug ?? "";
        const { sendPushToGuest } = await import("@/lib/guest-push.server");
        const preview = data.content.length > 120 ? `${data.content.slice(0, 117)}…` : data.content;
        await sendPushToGuest(data.conversationId, {
          title: `Nova mensagem — ${propName}`,
          body: preview,
          data: {
            url: slug ? `/g/${slug}?chat=1` : "/",
            conversationId: data.conversationId,
            tag: `guest-reply-${data.conversationId}`,
          },
        });
      } catch {
        // Não bloqueia o envio se o push falhar.
      }
    }
    return { ok: true };
  });

// -------- Count of pending handoffs (for badge/dock) --------

export const countPendingHandoffs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { supabase } = context;
      const { count, error } = await supabase
        .from("property_chat_conversations")
        .select("id", { count: "exact", head: true })
        .eq("status", "needs_human");
      if (error) {
        console.error("countPendingHandoffs failed", error);
        return { count: 0, error: error.message };
      }
      return { count: count ?? 0 };
    } catch (error) {
      console.error("countPendingHandoffs crashed", error);
      return { count: 0, error: "Não foi possível carregar o contador agora." };
    }
  });

// -------- Check whether current user has access to central de atendimento --------
// (Owner com plano business/enterprise, ou membro ativo de tal owner)

export const getAtendimentoAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { resolveUserPlan } = await import("@/lib/plan-guard.server");
    const ownPlan = await resolveUserPlan(supabase, userId);
    const isOwnerEligible = ownPlan.plan === "business" || ownPlan.plan === "enterprise";
    if (isOwnerEligible) {
      return { allowed: true, as: "owner" as const, plan: ownPlan.plan };
    }
    // Membro? Verifica se algum owner ativo tem plano elegível.
    const { data: memberships } = await supabase
      .from("account_members")
      .select("owner_id, role, status")
      .eq("member_user_id", userId)
      .eq("status", "active");
    if (!memberships || memberships.length === 0) {
      return { allowed: false as const, as: null, plan: null };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (const m of memberships) {
      const p = await resolveUserPlan(supabaseAdmin as unknown as typeof supabase, m.owner_id as string);
      if (p.plan === "business" || p.plan === "enterprise") {
        return { allowed: true as const, as: "member" as const, plan: p.plan };
      }
    }
    return { allowed: false as const, as: null, plan: null };
  });

// -------- List transfer targets for a conversation (owner + active members) --------

export const listConversationTransferTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: conv } = await supabase
      .from("property_chat_conversations")
      .select("id, properties:property_id(owner_id)")
      .eq("id", data.conversationId)
      .maybeSingle();
    const ownerId = (conv?.properties as { owner_id?: string } | null)?.owner_id ?? null;
    if (!ownerId) return { targets: [] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: members } = await supabaseAdmin
      .from("account_members")
      .select("member_user_id, role")
      .eq("owner_id", ownerId)
      .eq("status", "active");

    const ids = new Set<string>([ownerId, ...((members ?? []).map((m) => m.member_user_id as string))]);
    ids.delete(userId); // sem transferir para si mesmo
    const idList = Array.from(ids);
    if (idList.length === 0) return { targets: [] };

    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", idList);
    const nameById = new Map<string, string | null>();
    for (const p of profs ?? []) nameById.set(p.id as string, (p.full_name as string) ?? null);

    const roleById = new Map<string, string>();
    roleById.set(ownerId, "owner");
    for (const m of members ?? []) roleById.set(m.member_user_id as string, m.role as string);

    return {
      targets: idList.map((id) => ({
        userId: id,
        displayName: nameById.get(id) ?? null,
        role: roleById.get(id) ?? "agent",
      })),
    };
  });
