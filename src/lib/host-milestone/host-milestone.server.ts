/**
 * Mensagem do ANFITRIÃO/equipe (ou programada) no chat do Airbnb ⇒ a IA lê o CONTEXTO e, se a mensagem
 * atesta que o hóspede já entrou ou já saiu, dá a baixa pela MESMA rotina do painel (`applyOpsAction` →
 * `runAdvanceArrival`, origem "ai"). Sem lista de frases: o modelo interpreta; `decide.ts` aplica as travas
 * (reserva vinculada pelo código, dia certo no fuso do imóvel, card ainda pendente). Nunca lança.
 * Respeita `GUEST_AI_OPS_MODE` (off desliga; shadow só registra em log).
 */
import { decideHostMilestone, explicitHostConfirmation, parseHostReading, plausibleMilestones } from "./decide";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function localParts(now: Date, tz: string): { today: string; hm: string } | null {
  try {
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    return { today: d, hm };
  } catch {
    return null;
  }
}

const SCRUB = /\b\d{4,}\b/g; // códigos/senhas nunca vão ao modelo

export async function processHostMilestone(p: { conversationId: string; hostText: string; automated: boolean }): Promise<string> {
  try {
    const { opsMode } = await import("@/lib/guest-ai/ops/executor.server");
    const mode = opsMode();
    if (mode === "off") return "off";
    if (!p.hostText.trim()) return "empty";
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: conv } = await admin
      .from("property_chat_conversations")
      .select("id, property_id, reservation_id")
      .eq("id", p.conversationId)
      .maybeSingle();
    const c = conv as { property_id?: string; reservation_id?: string | null } | null;
    if (!c?.property_id || !c.reservation_id) return "no_reservation";
    const [{ data: res }, { data: prop }, { data: cards }] = await Promise.all([
      admin.from("property_reservations").select("id, property_id, status, checkin_date, checkout_date").eq("id", c.reservation_id).maybeSingle(),
      admin.from("properties").select("city, country").eq("id", c.property_id).maybeSingle(),
      admin.from("guest_arrival_status").select("kind, status, done_at").eq("reservation_id", c.reservation_id),
    ]);
    const r = res as Record<string, unknown> | null;
    if (!r || r["property_id"] !== c.property_id) return "no_reservation";
    const { propertyTimeZoneOrNull } = await import("@/lib/property-timezone");
    const pr = prop as { city?: string | null; country?: string | null } | null;
    const tz = propertyTimeZoneOrNull(pr?.city, pr?.country);
    if (!tz) return "no_timezone";
    const lp = localParts(new Date(), tz);
    if (!lp) return "no_timezone";
    const rows = (cards ?? []) as Array<{ kind: string; status: string | null; done_at: string | null }>;
    const done = (k: string) => rows.some((x) => x.kind === k && (x.status === "done" || x.status === "no_show" || !!x.done_at));
    const base = {
      today: lp.today,
      nowHm: lp.hm,
      reservation: { status: str(r["status"]), checkinDate: str(r["checkin_date"]), checkoutDate: str(r["checkout_date"]) },
      cards: { checkinDone: done("checkin"), checkoutDone: done("checkout") },
    };
    const allowed = plausibleMilestones(base);
    if (allowed.length === 0) return "outside_window"; // nem chama o modelo

    const { data: hist } = await admin
      .from("property_chat_messages")
      .select("role, sender_type, content, created_at")
      .eq("conversation_id", p.conversationId)
      .order("created_at", { ascending: false })
      .limit(12);
    const transcript = ((hist ?? []) as Array<{ role: string; sender_type: string | null; content: string | null }>)
      .reverse()
      .filter((m) => m.sender_type !== "internal_note")
      .map((m) => {
        const who = m.role === "user" ? "HÓSPEDE" : m.sender_type === "ai" ? "IA" : m.sender_type === "system" ? "MENSAGEM PROGRAMADA" : "ANFITRIÃO";
        return `${who}: ${String(m.content ?? "").replace(SCRUB, "[código]").slice(0, 800)}`;
      })
      .join("\n");

    // Afirmação explícita ("Check-in confirmado.") é fato consumado: não depende da leitura do modelo.
    const explicit = explicitHostConfirmation(p.hostText);
    let reading: import("./decide").HostReading | null = explicit && allowed.includes(explicit) ? { milestone: explicit, confidence: 1 } : null;
    if (!reading) {
    const { chatJson } = await import("@/lib/llm/gateway.server");
    const { data } = await chatJson<unknown>("content", [
      {
        role: "system",
        content:
          "Você lê conversas de hospedagem (Airbnb) e identifica se a ÚLTIMA mensagem do anfitrião/equipe atesta, pelo contexto, um fato JÁ CONSUMADO: " +
          "'checkin_done' = o hóspede já entrou/está acomodado no imóvel; 'checkout_done' = o hóspede já saiu/devolveu o imóvel. " +
          "Quando o anfitrião AFIRMA que o check-in/check-out foi confirmado, concluído ou realizado, isso é fato consumado e vale como o marco, mesmo que antes houvesse algum problema (ex.: chave). " +
          "AUTORIZAÇÃO não é confirmação: 'check-in autorizado', 'entrada antecipada liberada', 'pode entrar' ⇒ 'none'. " +
          "Interprete o sentido, não palavras específicas (ex.: despedida pós-saída, agradecimento pela estadia encerrada, confirmação de chaves devolvidas, boas-vindas a quem já chegou). " +
          "Responda 'none' para instruções, lembretes, previsões, perguntas, horários futuros, mensagens programadas de véspera ou qualquer dúvida. " +
          `Marcos possíveis agora: ${allowed.join(", ")}. Responda só JSON: {"milestone":"checkin_done|checkout_done|none","confidence":0..1}.`,
      },
      { role: "user", content: `Conversa (mais antiga → mais recente):\n${transcript}\n\nÚltima mensagem do anfitrião${p.automated ? " (programada)" : ""}:\n${p.hostText.replace(SCRUB, "[código]").slice(0, 800)}\n\nResponda em JSON.` },
    ] as never);
    reading = parseHostReading(data);
    }
    const decision = decideHostMilestone({ ...base, reading });
    if (!decision.act) return decision.code;
    if (mode === "shadow") {
      console.log("[host-milestone] shadow", decision.action, p.conversationId);
      return `shadow_${decision.action}`;
    }
    const { applyOpsAction } = await import("@/lib/guest-ai-ops-apply.server");
    const out = await applyOpsAction(
      decision.early
        ? { action: "early_departure", propertyId: c.property_id, reservationId: c.reservation_id, today: lp.today, checkoutDate: base.reservation.checkoutDate! }
        : { action: decision.action, propertyId: c.property_id, reservationId: c.reservation_id },
    );
    if (!out.ok && out.code === "panel_refused" && decision.action === "checkin_done" && (await propertyHasOpenTurnover(admin, c.property_id, c.reservation_id, lp.today))) {
      // imóvel ainda em limpeza/saída anterior: o check-in fica em espera e conclui sozinho ao fim da limpeza
      const { markCheckinStandby } = await import("./standby.server");
      const ok = await markCheckinStandby(c.property_id, c.reservation_id);
      console.log("[host-milestone] checkin em espera", ok, p.conversationId);
      return ok ? "standby_cleaning" : "panel_refused";
    }
    console.log("[host-milestone]", decision.action, out.ok ? "applied" : out.code, p.conversationId);
    return out.ok ? `applied_${decision.action}` : out.code;
  } catch (e) {
    console.error("[host-milestone] falhou", e instanceof Error ? e.message : "erro");
    return "failed";
  }
}

/** Outra estadia do imóvel ainda com saída/limpeza em aberto (a mesma trava do painel). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function propertyHasOpenTurnover(admin: any, propertyId: string, reservationId: string, today: string): Promise<boolean> {
  const { data } = await admin
    .from("guest_arrival_status")
    .select("reservation_id, kind, status, done_at, manual")
    .eq("property_id", propertyId)
    .eq("kind", "checkout")
    .is("concluded_at", null);
  const rows = ((data ?? []) as Array<{ reservation_id: string | null; manual: boolean | null }>).filter(
    (r) => r.reservation_id !== reservationId,
  );
  if (!rows.length) return false;
  const ids = rows.map((r) => r.reservation_id).filter((x): x is string => !!x);
  if (rows.some((r) => !r.reservation_id)) return true;
  const { data: res } = await admin.from("property_reservations").select("id, checkin_date, checkout_date").in("id", ids);
  return ((res ?? []) as Array<{ checkin_date: string | null; checkout_date: string | null }>).some(
    (r) => !!r.checkout_date && r.checkout_date <= today && !!r.checkin_date && r.checkin_date <= today,
  );
}
