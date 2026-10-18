/**
 * HÓSPEDE SEM RESPOSTA DEPOIS DA PAUSA — todos os canais.
 *
 * Regra do produto (15/10/2026): o atendente falou → a IA pausa 10 min. Se o
 * prazo venceu e a ÚLTIMA fala da conversa é do hóspede, ninguém respondeu:
 * a IA retoma sozinha e responde o que ficou pendente com base no histórico.
 * Se alguém da equipe respondeu nesse meio tempo, a última fala não é do
 * hóspede e nada acontece.
 *
 * Roda no cron de 1 min. Cada pausa vencida é "reivindicada" uma vez só
 * (update condicionado ao mesmo `paused_until`), então execuções paralelas
 * nunca respondem em dobro. O silêncio estratégico ([SILENCIO] para
 * confirmação mecânica isolada) continua valendo: resposta vazia não é enviada.
 */
type Admin = any;

/** Só pausas que venceram há pouco: não ressuscita conversas antigas. */
export const STALLED_LOOKBACK_MS = 3 * 60 * 60 * 1000;

export function stalledChannel(sessionId: string | null | undefined): "airbnb" | "whatsapp" | "guide" {
  const s = String(sessionId ?? "");
  if (s.startsWith("airbnb:")) return "airbnb";
  if (s.startsWith("wa:")) return "whatsapp";
  return "guide";
}

export async function sweepStalledGuestReplies(limit = 20): Promise<number> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const now = Date.now();
  const { data: rows } = await admin
    .from("property_chat_conversations")
    .select("id, property_id, guest_session_id, guest_name, paused_until")
    .eq("ai_paused", true)
    .not("paused_until", "is", null)
    .lte("paused_until", new Date(now).toISOString())
    .gte("paused_until", new Date(now - STALLED_LOOKBACK_MS).toISOString())
    .limit(limit);
  let done = 0;
  for (const c of (rows ?? []) as Array<{
    id: string;
    property_id: string;
    guest_session_id: string | null;
    guest_name: string | null;
    paused_until: string;
  }>) {
    try {
      // Só avalia uma vez por mensagem pendente (evita reprocessar a cada minuto).
      const { data: lastMsg } = await admin
        .from("property_chat_messages")
        .select("id, role")
        .eq("conversation_id", c.id)
        .not("is_internal_note", "is", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastMsg || lastMsg.role !== "user") continue;
      const { data: own } = await admin.from("properties").select("owner_id").eq("id", c.property_id).maybeSingle();
      if (!own?.owner_id) continue;
      const { error: seen } = await admin.from("ops_push_log").insert({
        owner_id: own.owner_id,
        kind: "resume-gate",
        dedupe_key: `resume-gate:${c.id}:${lastMsg.id}`,
        payload: { conversationId: c.id, messageId: lastMsg.id },
      });
      if (seen) continue;
      // Retoma SÓ se a resposta está explícita no cadastro do imóvel e não é
      // assunto do atendimento humano em andamento. Senão, segue com a equipe.
      const { canResumeAfterPause } = await import("./sweep-gates.server");
      if (!(await canResumeAfterPause(admin, c.id, c.property_id))) continue;
      // Reivindica: devolve à IA só se ninguém mexeu na pausa desde a leitura.
      const { data: claimed } = await admin
        .from("property_chat_conversations")
        .update({ ai_paused: false, paused_until: null })
        .eq("id", c.id)
        .eq("paused_until", c.paused_until)
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
      if (await answerIfGuestWaiting(admin, c)) done += 1;
    } catch (e) {
      console.error("[stalled-replies] falhou", c.id, e);
    }
  }
  done += await sweepUnansweredGuestMessages(admin, limit);
  done += await sweepSilentCloses(admin, limit).catch((e) => {
    console.error("[silent-close] falhou", e);
    return 0;
  });
  // Follow-ups de acompanhamento ("a equipe já está com o seu caso", "deu certo
  // por aí?") DESLIGADOS por decisão do anfitrião (18/10/2026): disparavam fora
  // de contexto. Não religar sem pedido explícito.
  void sweepNeedsHumanFollowUps;
  void sweepResolutionChecks;
  // Cérebro contínuo: aprende com mensagens da IA que o anfitrião apagou/editou.
  done += await import("./learning/property-playbooks.server")
    .then((m) => m.sweepHostCorrections(admin, limit))
    .catch((e) => {
      console.error("[host-corrections] falhou", e);
      return 0;
    });
  return done;
}

/**
 * ACOMPANHAMENTO ÚNICO ENQUANTO A EQUIPE NÃO RESPONDE (17/10/2026, decisão do
 * anfitrião). Conversa em `needs_human` sem NENHUMA fala humana depois do
 * acionamento: passados 10 min (acesso/problema no imóvel/urgência alta) ou
 * 30 min (demais), UMA mensagem curta e honesta — sem prazo, sem promessa de
 * ação da IA. Só se o hóspede não escreveu de novo desde a última fala da IA;
 * nunca entre 22h e 8h (horário do imóvel), salvo urgência alta. Uma vez por
 * acionamento (dedupe por `handoff_at`).
 */
export const FOLLOWUP_URGENT_MS = 10 * 60 * 1000;
export const FOLLOWUP_NORMAL_MS = 30 * 60 * 1000;
const URGENT_REASON = /\b(acesso|portao|porta|fechadura|chave|senha|codigo|vazamento|sem (?:agua|luz|energia)|quebrad|nao funciona|urgente|emergencia)\b/;

export function followUpDelayMs(reason: string | null, urgency: string | null): number {
  const r = (reason ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return urgency === "high" || URGENT_REASON.test(r) ? FOLLOWUP_URGENT_MS : FOLLOWUP_NORMAL_MS;
}

export function followUpText(guestName: string | null, language: string, seed: number): string {
  const fn = (guestName ?? "").trim().split(/\s+/)[0] ?? "";
  const nm = fn && !/^h[oó]spede$/i.test(fn) && !/teste/i.test(fn) ? `${fn.charAt(0).toUpperCase()}${fn.slice(1).toLowerCase()}` : "";
  if (language.startsWith("en"))
    return `${nm ? `${nm}, ` : ""}our team already has your case and will get back to you here. If anything gets worse, just let me know.`;
  if (language.startsWith("es"))
    return `${nm ? `${nm}, ` : ""}el equipo ya tiene tu caso y te responderá por aquí. Si algo empeora, avísame.`;
  const v = [
    `${nm ? `${nm}, a` : "A"} equipe já está com o seu caso e retorna por aqui. Se piorar, me avise.`,
    `${nm ? `${nm}, o` : "O"} seu caso segue com a equipe, que retorna por aqui. Se algo mudar ou piorar, é só me avisar.`,
  ];
  return v[seed % v.length]!;
}

async function sweepNeedsHumanFollowUps(admin: Admin, limit: number): Promise<number> {
  const now = Date.now();
  const { data: rows } = await admin
    .from("property_chat_conversations")
    .select("id, property_id, guest_session_id, guest_name, handoff_at, handoff_reason, handoff_urgency, status")
    .eq("status", "needs_human")
    .not("handoff_at", "is", null)
    .lte("handoff_at", new Date(now - FOLLOWUP_URGENT_MS).toISOString())
    .gte("handoff_at", new Date(now - STALLED_LOOKBACK_MS).toISOString())
    .limit(limit * 5);
  let done = 0;
  for (const c of (rows ?? []) as Array<any>) {
    if (done >= limit) break;
    try {
      const wait = followUpDelayMs(c.handoff_reason, c.handoff_urgency);
      if (now - new Date(c.handoff_at).getTime() < wait) continue;
      const { data: msgs } = await admin
        .from("property_chat_messages")
        .select("role, sender_type, content, created_at")
        .eq("conversation_id", c.id)
        .not("is_internal_note", "is", true)
        .gte("created_at", c.handoff_at)
        .order("created_at", { ascending: false })
        .limit(30);
      const list = (msgs ?? []) as Array<{ role: string; sender_type: string | null; content: string | null; created_at: string }>;
      // Equipe já falou depois do acionamento: nada a acompanhar.
      if (list.some((m) => m.sender_type === "human")) continue;
      // Hóspede escreveu por último: a vez é de quem responde (outro mecanismo cuida).
      if (list[0]?.role === "user") continue;
      const guestMsg = list.find((m) => m.role === "user")?.content ?? "";

      const { data: prop } = await admin
        .from("properties")
        .select("owner_id, city, country")
        .eq("id", c.property_id)
        .maybeSingle();
      if (!prop?.owner_id) continue;
      const high = c.handoff_urgency === "high";
      if (!high) {
        const { propertyTimeZone } = await import("@/lib/property-timezone");
        const h = localHour(propertyTimeZone(prop.city ?? null, prop.country ?? null));
        if (h >= 22 || h < 8) continue;
      }
      const { error: dup } = await admin.from("ops_push_log").insert({
        owner_id: prop.owner_id,
        kind: "needs-human-followup",
        dedupe_key: `needs-human-followup:${c.id}:${c.handoff_at}`,
        payload: { conversationId: c.id },
      });
      if (dup) continue;

      const channel = stalledChannel(c.guest_session_id);
      const { detectLanguage } = await import("./intent.server");
      const lang = channel === "whatsapp" && guestMsg ? detectLanguage(guestMsg) : "pt";
      const reply = followUpText(c.guest_name, lang, list.length);
      if (channel === "whatsapp") {
        const phone = String(c.guest_session_id).slice("wa:".length);
        let externalId: string | null = null;
        try {
          const { sendWhatsappText } = await import("@/lib/ai/channels/whatsapp/provider.server");
          externalId = (await sendWhatsappText({ supabase: admin, tenantId: prop.owner_id, toPhone: phone, text: reply })).messageId ?? null;
        } catch (e) {
          console.error("[needs-human-followup] whatsapp falhou", c.id, e);
        }
        await admin.from("property_chat_messages").insert({
          conversation_id: c.id,
          role: "assistant",
          content: reply,
          sender_type: "ai",
          channel: "whatsapp",
          external_id: externalId,
          delivery_status: externalId ? "sent" : null,
        });
      } else {
        const { speakToGuest } = await import("./outbound/speak.server");
        await speakToGuest({ supabase: admin, conversationId: c.id, text: reply, reason: "follow_up", urgent: high, allowAfterAi: true });
      }
      done += 1;
    } catch (e) {
      console.error("[needs-human-followup] conversa falhou", c.id, e);
    }
  }
  return done;
}

/**
 * CONFIRMAR SE RESOLVEU (ponto 2, 17/10/2026). Depois que a IA ajudou num
 * problema prático (categoria "operacional") e o hóspede ficou em silêncio por
 * 20 min, UMA pergunta curta ("deu certo?") gera um desfecho real para o
 * aprendizado — em vez de adivinhar pelo silêncio. A resposta é lida em
 * `readResolutionCheck` (analisador). Uma vez por problema; nunca entre 22h e
 * 8h (horário do imóvel); nunca se a conversa está com a equipe (needs_human /
 * assigned) ou se a última fala da IA já era uma pergunta.
 */
export const RESOLUTION_CHECK_AFTER_MS = 20 * 60 * 1000;

function localHour(tz: string, now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now)) % 24;
}

export function resolutionCheckText(guestName: string | null, seed: number): string {
  const fn = (guestName ?? "").trim().split(/\s+/)[0] ?? "";
  const n = fn && !/^h[oó]spede$/i.test(fn) && !/teste/i.test(fn) ? `, ${fn.charAt(0).toUpperCase()}${fn.slice(1).toLowerCase()}` : "";
  const variants = [
    `Deu certo por aí${n}? Se ainda não resolveu, me conta o que está acontecendo que sigo te ajudando.`,
    `Conseguiu resolver por aí${n}? Se continuar com o problema, é só me dizer como está agora.`,
    `Só passando para saber se resolveu por aí${n}. Se algo ainda não estiver certo, me avisa.`,
  ];
  return variants[seed % variants.length]!;
}

async function sweepResolutionChecks(admin: Admin, limit: number): Promise<number> {
  const now = Date.now();
  const { data: rows } = await admin
    .from("property_chat_conversations")
    .select("id, property_id, guest_session_id, guest_name, last_message_at, status")
    .eq("ai_paused", false)
    .lte("last_message_at", new Date(now - RESOLUTION_CHECK_AFTER_MS).toISOString())
    .gte("last_message_at", new Date(now - STALLED_LOOKBACK_MS).toISOString())
    .limit(limit * 5);
  let done = 0;
  for (const c of (rows ?? []) as Array<any>) {
    if (done >= limit) break;
    if (c.status === "assigned" || c.status === "needs_human") continue;
    try {
      const { data: msgs } = await admin
        .from("property_chat_messages")
        .select("role, content, created_at")
        .eq("conversation_id", c.id)
        .not("is_internal_note", "is", true)
        .order("created_at", { ascending: false })
        .limit(6);
      const list = (msgs ?? []) as Array<{ role: string; content: string | null; created_at: string }>;
      const lastMsg = list[0];
      if (!lastMsg || lastMsg.role !== "assistant") continue;
      if (now - new Date(lastMsg.created_at).getTime() < RESOLUTION_CHECK_AFTER_MS) continue;
      if (/\?\s*$/.test((lastMsg.content ?? "").trim())) continue; // a bola está com o hóspede
      if (list.some((m) => /deu certo por a[ií]|conseguiu resolver|resolveu por a[ií]/i.test(m.content ?? ""))) continue;

      const { data: log } = await admin
        .from("ai_agent_logs")
        .select("id, intent, needs_human, escalation_triggered")
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const category = (log?.intent as { category?: string } | null)?.category;
      if (!log || category !== "operacional" || log.needs_human === true || log.escalation_triggered === true) continue;

      const { data: prop } = await admin
        .from("properties")
        .select("owner_id, city, country")
        .eq("id", c.property_id)
        .maybeSingle();
      if (!prop?.owner_id) continue;
      const { propertyTimeZone } = await import("@/lib/property-timezone");
      const h = localHour(propertyTimeZone(prop.city ?? null, prop.country ?? null));
      if (h >= 22 || h < 8) continue;

      const { error: dup } = await admin.from("ops_push_log").insert({
        owner_id: prop.owner_id,
        kind: "resolution-check",
        dedupe_key: `resolution-check:${c.id}:${log.id}`,
        payload: { conversationId: c.id, logId: log.id },
      });
      if (dup) continue;

      // Só pergunta com contexto real (passo prático dado para um problema) e
      // citando o problema concreto; sem contexto, não manda nada.
      const { contextualResolutionQuestion } = await import("./sweep-gates.server");
      const { firstName } = await import("./silent-close");
      const reply = await contextualResolutionQuestion(list, firstName(c.guest_name));
      if (!reply) continue;
      const channel = stalledChannel(c.guest_session_id);
      if (channel === "whatsapp") {
        const phone = String(c.guest_session_id).slice("wa:".length);
        let externalId: string | null = null;
        try {
          const { sendWhatsappText } = await import("@/lib/ai/channels/whatsapp/provider.server");
          externalId = (await sendWhatsappText({ supabase: admin, tenantId: prop.owner_id, toPhone: phone, text: reply })).messageId ?? null;
        } catch (e) {
          console.error("[resolution-check] whatsapp falhou", c.id, e);
        }
        await admin.from("property_chat_messages").insert({
          conversation_id: c.id,
          role: "assistant",
          content: reply,
          sender_type: "ai",
          channel: "whatsapp",
          external_id: externalId,
          delivery_status: externalId ? "sent" : null,
        });
      } else {
        const { speakToGuest } = await import("./outbound/speak.server");
        await speakToGuest({ supabase: admin, conversationId: c.id, text: reply, reason: "follow_up", urgent: false, allowAfterAi: true });
      }
      done += 1;
    } catch (e) {
      console.error("[resolution-check] conversa falhou", c.id, e);
    }
  }
  return done;
}

/**
 * ENCERRAMENTO POR SILÊNCIO: hóspede disse que um passo da entrada/saída deu
 * certo, a IA respondeu e ele sumiu por 10 min → mensagem calorosa de
 * encerramento + baixa de check-in/check-out no painel (com push à equipe
 * vinculada, via `runAdvanceArrival`). Uma vez por conversa e etapa.
 */
async function sweepSilentCloses(admin: Admin, limit: number): Promise<number> {
  const { SILENT_CLOSE_AFTER_MS, isEntryProgress, isCheckoutProgress, silentCloseText } = await import("./silent-close");
  const now = Date.now();
  const { data: rows } = await admin
    .from("property_chat_conversations")
    .select("id, property_id, guest_session_id, guest_name, last_message_at, status")
    .eq("ai_paused", false)
    .lte("last_message_at", new Date(now - SILENT_CLOSE_AFTER_MS).toISOString())
    .gte("last_message_at", new Date(now - STALLED_LOOKBACK_MS).toISOString())
    .limit(limit * 5);
  let done = 0;
  for (const c of (rows ?? []) as Array<any>) {
    if (done >= limit) break;
    if (c.status === "assigned") continue;
    try {
      const { data: msgs } = await admin
        .from("property_chat_messages")
        .select("role, content, created_at")
        .eq("conversation_id", c.id)
        .not("is_internal_note", "is", true)
        .order("created_at", { ascending: false })
        .limit(6);
      const list = (msgs ?? []) as Array<{ role: string; content: string | null; created_at: string }>;
      const last = list[0];
      if (!last || last.role !== "assistant") continue;
      if (now - new Date(last.created_at).getTime() < SILENT_CLOSE_AFTER_MS) continue;
      const guest = list.find((m) => m.role === "user");
      if (!guest) continue;
      const text = guest.content ?? "";
      const kind: "checkin" | "checkout" | null = isCheckoutProgress(text)
        ? "checkout"
        : isEntryProgress(text)
          ? "checkin"
          : null;
      if (!kind) continue;
      // Já encerrado pela própria IA? Não repete.
      if (/excelente estadia|boa estadia|otima estadia|ótima estadia|aproveite a estadia|boa viagem|até a próxima/i.test(last.content ?? "")) continue;

      const { findStayForEvent, applyStayEvent, assessStayTimes } = await import("./stay-events.server");
      const stay = await findStayForEvent(admin, { propertyId: c.property_id, checkinDate: null, checkoutDate: null, conversationId: c.id });
      if (!stay) continue;
      const { data: st } = await admin
        .from("guest_arrival_status")
        .select("kind, status, done_at")
        .eq("reservation_id", stay.reservationId);
      const sts = (st ?? []) as Array<{ kind: string; status: string; done_at: string | null }>;
      const isDone = (k: string) => sts.some((r) => r.kind === k && (r.status === "done" || !!r.done_at));
      if (sts.some((r) => r.kind === "checkin" && r.status === "no_show")) continue;
      if (isDone(kind)) continue;
      if (kind === "checkin") {
        const tw = await assessStayTimes(admin, { propertyId: c.property_id, stay });
        if (tw.early) continue; // antecipado sem autorização da equipe: nunca presume
      }

      const { data: prop } = await admin.from("properties").select("owner_id").eq("id", c.property_id).maybeSingle();
      if (!prop?.owner_id) continue;
      const { error: dup } = await admin.from("ops_push_log").insert({
        owner_id: prop.owner_id,
        kind: "silent-close",
        dedupe_key: `silent-close:${c.id}:${kind}`,
        payload: { conversationId: c.id, reservationId: stay.reservationId },
      });
      if (dup) continue;

      const { data: aiHist } = await admin
        .from("property_chat_messages")
        .select("content")
        .eq("conversation_id", c.id)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(40);
      const prevAi = ((aiHist ?? []) as Array<{ content: string | null }>).map((m) => m.content ?? "");
      const reply = silentCloseText(kind, c.guest_name, prevAi, prevAi.length);
      const channel = stalledChannel(c.guest_session_id);
      if (channel === "whatsapp") {
        const phone = String(c.guest_session_id).slice("wa:".length);
        let externalId: string | null = null;
        try {
          const { sendWhatsappText } = await import("@/lib/ai/channels/whatsapp/provider.server");
          externalId = (await sendWhatsappText({ supabase: admin, tenantId: prop.owner_id, toPhone: phone, text: reply })).messageId ?? null;
        } catch (e) {
          console.error("[silent-close] whatsapp falhou", c.id, e);
        }
        await admin.from("property_chat_messages").insert({
          conversation_id: c.id,
          role: "assistant",
          content: reply,
          sender_type: "ai",
          channel: "whatsapp",
          external_id: externalId,
          delivery_status: externalId ? "sent" : null,
        });
      } else {
        const { speakToGuest } = await import("./outbound/speak.server");
        await speakToGuest({ supabase: admin, conversationId: c.id, text: reply, reason: "follow_up", urgent: true, allowAfterAi: true });
      }
      await applyStayEvent(admin, stay, kind);
      done += 1;
    } catch (e) {
      console.error("[silent-close] conversa falhou", c.id, e);
    }
  }
  return done;
}

/**
 * Rede de segurança contra vácuo (conversas SEM pausa): a última fala é do
 * hóspede há mais de 2 min e ninguém respondeu (ex.: processamento caiu antes
 * da IA). Reivindica uma vez via `last_message_at` para não responder em dobro.
 */
export const UNANSWERED_AFTER_MS = 2 * 60 * 1000;
async function sweepUnansweredGuestMessages(admin: Admin, limit: number): Promise<number> {
  const now = Date.now();
  const { data: rows } = await admin
    .from("property_chat_conversations")
    .select("id, property_id, guest_session_id, guest_name, last_message_at, status")
    .eq("ai_paused", false)
    .lte("last_message_at", new Date(now - UNANSWERED_AFTER_MS).toISOString())
    .gte("last_message_at", new Date(now - STALLED_LOOKBACK_MS).toISOString())
    .order("last_message_at", { ascending: false })
    .limit(limit * 5);
  let done = 0;
  for (const c of (rows ?? []) as Array<any>) {
    if (done >= limit) break;
    if (c.status === "assigned") continue;
    try {
      const { data: last } = await admin
        .from("property_chat_messages")
        .select("id, role, created_at")
        .eq("conversation_id", c.id)
        .not("is_internal_note", "is", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!last || last.role !== "user") continue;
      if (now - new Date(last.created_at).getTime() < UNANSWERED_AFTER_MS) continue;
      // UMA tentativa por mensagem do hóspede. Sem isso, quando a IA escolhe o
      // silêncio ([SILENCIO] para "ok/obrigado"), a última fala continua sendo
      // do hóspede e esta varredura reprocessava a mesma mensagem a cada
      // 2 min durante 3 h (custo de modelo + risco de resposta tardia).
      const { data: owner } = await admin.from("properties").select("owner_id").eq("id", c.property_id).maybeSingle();
      if (!owner?.owner_id) continue;
      const { error: already } = await admin.from("ops_push_log").insert({
        owner_id: owner.owner_id,
        kind: "unanswered-sweep",
        dedupe_key: `unanswered:${c.id}:${last.id}`,
        payload: { conversationId: c.id, messageId: last.id },
      });
      if (already) continue;
      const { data: claimed } = await admin
        .from("property_chat_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", c.id)
        .eq("last_message_at", c.last_message_at)
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
      if (await answerIfGuestWaiting(admin, c)) done += 1;
    } catch (e) {
      console.error("[stalled-replies] vácuo falhou", c.id, e);
    }
  }
  return done;
}

/** Responde a conversa se a última fala (não interna) for do hóspede. */
export async function answerIfGuestWaiting(
  admin: Admin,
  c: { id: string; property_id: string; guest_session_id: string | null; guest_name: string | null },
): Promise<boolean> {
  const { data: last } = await admin
    .from("property_chat_messages")
    .select("role, sender_type")
    .eq("conversation_id", c.id)
    .not("is_internal_note", "is", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last || last.role !== "user") return false;

  const channel = stalledChannel(c.guest_session_id);

  if (channel === "airbnb") {
    const { data: sw } = await admin
      .from("property_listing_raw_data")
      .select("airbnb_ai_enabled")
      .eq("property_id", c.property_id)
      .maybeSingle();
    if (!sw?.airbnb_ai_enabled) return false;
    // Mesmo motor consolidado do webhook (reserva, dossiê, idioma, envio pela Channex).
    await admin
      .from("property_chat_conversations")
      .update({
        ai_reply_due_at: new Date().toISOString(),
        ai_reply_ctx: {
          threadId: String(c.guest_session_id).slice("airbnb:".length),
          bookingId: null,
          channexPropertyId: null,
          guestName: c.guest_name,
          propertyId: c.property_id,
        },
      })
      .eq("id", c.id);
    const { processDueAiReplies } = await import("@/lib/channex-messages.server");
    await processDueAiReplies().catch(() => 0);
    return true;
  }

  const { consolidatedGuestBlock } = await import("@/lib/channex-messages.server");
  const block = await consolidatedGuestBlock(admin, c.id);
  if (!block.count) return false;

  if (channel === "guide") {
    const { speakWithAgent } = await import("@/lib/ai/outbound/speak.server");
    const r = await speakWithAgent({
      supabase: admin,
      conversationId: c.id,
      instruction: block.text,
      reason: "follow_up",
      urgent: true,
    });
    return r.sent;
  }

  // WhatsApp: resposta no idioma do hóspede, entregue pelo número do anfitrião.
  const { data: prop } = await admin.from("properties").select("*").eq("id", c.property_id).maybeSingle();
  if (!prop || !process.env["LOVABLE_API_KEY"]) return false;
  const phone = String(c.guest_session_id).slice("wa:".length);
  const { loadAgentHistory } = await import("@/lib/chat-audio.server");
  const history = await loadAgentHistory(admin, c.id, 20 + block.count);
  for (let i = 0; i < block.count && history.length && history[history.length - 1]!.role === "user"; i += 1) history.pop();
  const { runHospitalityAgent } = await import("@/lib/ai/orchestrator.server");
  const result = await runHospitalityAgent({
    supabase: admin,
    property: prop as Record<string, unknown>,
    conversationId: c.id,
    sessionId: String(c.guest_session_id),
    guestName: c.guest_name,
    message: block.text,
    history,
    surface: "whatsapp",
    channel: "whatsapp",
    channelReference: phone,
  });
  const reply = (result.reply ?? "").trim();
  if (!reply) return false;
  let externalId: string | null = null;
  try {
    const { sendWhatsappText } = await import("@/lib/ai/channels/whatsapp/provider.server");
    externalId = (await sendWhatsappText({ supabase: admin, tenantId: (prop as any).owner_id, toPhone: phone, text: reply })).messageId ?? null;
  } catch (e) {
    const { reportDeliveryFailure } = await import("@/lib/delivery-failure.server");
    await reportDeliveryFailure(admin, {
      conversationId: c.id,
      propertyId: c.property_id,
      channel: "whatsapp",
      propertyName: (prop as any).name ?? null,
      guestName: c.guest_name,
      guestMessage: block.text,
      detail: (e instanceof Error ? e.message : String(e)).slice(0, 120),
    } as never);
  }
  await admin.from("property_chat_messages").insert({
    conversation_id: c.id,
    role: "assistant",
    content: reply,
    sender_type: "ai",
    channel: "whatsapp",
    external_id: externalId,
    delivery_status: externalId ? "sent" : null,
  });
  await admin.from("property_chat_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", c.id);
  return true;
}
