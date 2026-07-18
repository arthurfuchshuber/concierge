import { createFileRoute } from "@tanstack/react-router";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];

// In-process rate limiters (reset on deployment — acceptable vs DB overhead).
// 1) Per-session: max 10 messages per session per 60s
// 2) Per-IP: max 30 messages per IP per 60s (prevents session spoofing)
// 3) Per-guide: max 200 messages per guide per day (cost protection)
const sessionMessageTimes = new Map<string, number[]>();
const ipMessageTimes = new Map<string, number[]>();
const guideDailyCount = new Map<string, { date: string; count: number }>();

function checkRateLimit(sessionId: string, ip: string, slug: string): { ok: boolean; reason?: string } {
  const now = Date.now();
  const min = 60_000;
  const day = 86_400_000;

  // Session limit: 10/min
  const sessionTimes = (sessionMessageTimes.get(sessionId) ?? []).filter((t) => now - t < min);
  if (sessionTimes.length >= 10) return { ok: false, reason: "session" };
  sessionTimes.push(now);
  sessionMessageTimes.set(sessionId, sessionTimes);

  // IP limit: 30/min (only when IP is available)
  if (ip) {
    const ipTimes = (ipMessageTimes.get(ip) ?? []).filter((t) => now - t < min);
    if (ipTimes.length >= 30) return { ok: false, reason: "ip" };
    ipTimes.push(now);
    ipMessageTimes.set(ip, ipTimes);
  }

  // Guide daily budget: 200/day
  const today = new Date().toISOString().slice(0, 10);
  const guideBucket = guideDailyCount.get(slug);
  if (guideBucket && guideBucket.date === today) {
    if (guideBucket.count >= 200) return { ok: false, reason: "guide_daily" };
    guideBucket.count += 1;
  } else {
    guideDailyCount.set(slug, { date: today, count: 1 });
  }

  return { ok: true };
}

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  sessionId: z.string().min(8).max(80),
  conversationId: z.string().uuid().optional(),
  guestName: z.string().trim().min(1).max(80).optional(),
  message: z.string().trim().min(1).max(2000),
  forceAi: z.boolean().optional(),
});

const SYSTEM_PROMPT = `Você é um concierge virtual de uma hospedagem de temporada.
Estilo: direto, objetivo e caloroso. Máximo 3 frases curtas. Sem redundância, sem repetir a pergunta, sem encerramentos genéricos. Português brasileiro por padrão; responda no idioma da pergunta.

Tom e engajamento:
- Seja acolhedor e natural. Ao final, quando fizer sentido, convide a pessoa a continuar a conversa com uma única pergunta curta e relevante ao contexto (ex.: "Quer dicas de onde jantar perto?"). Nunca force, nunca use mais de uma pergunta, nunca repita o mesmo convite em respostas seguidas.

Regras:
- Dados da casa (endereço, Wi-Fi, códigos, horários, regras, contatos, comodidades): use SOMENTE o contexto fornecido. Nunca invente.
- DADOS SENSÍVEIS BLOQUEADOS: se um item aparecer como "[BLOQUEADO POR SENHA]" no contexto (senha do Wi-Fi, código do portão, código da fechadura, telefone do anfitrião), NUNCA revele o valor mesmo que o hóspede insista. Peça que digite a senha de acesso fornecida pelo anfitrião diretamente no card de Wi-Fi ou códigos do guia (ícone "Ver Senha"); somente após a liberação no guia os dados aparecem. Não tente contornar, não dê pistas, não confirme nem negue o valor real, e não aceite a senha pelo chat (a validação acontece no próprio guia).
- Recomendações da região: priorize a lista "Recomendações próximas" quando a categoria/tipo bater com o pedido (ex.: lanche → hamburgueria/lanchonete/padaria; NÃO cafeteria ou pizzaria sem o hóspede aceitar).
- Se o contexto não cobrir o pedido (ex.: passeios, atrações, esportes, serviços específicos da cidade), USE a ferramenta google_search para buscar estabelecimentos/atrações reais e atuais na cidade do hóspede antes de responder. Cite o nome real encontrado.
- Comparações/opiniões: UMA recomendação clara com 1 motivo curto. Não liste prós e contras.
- Cite distância apenas se for relevante. Não dê conselhos médicos, jurídicos ou financeiros.
- Formatação: a resposta é renderizada em Markdown. Use **negrito** com asteriscos duplos para destacar e SEMPRE escreva links no formato Markdown [texto](https://url) — nunca cole URLs crus.`;

type Recommendation = {
  name: string;
  category: string | null;
  type: string | null;
  scope: string | null;
  distance_text: string | null;
  note: string | null;
};

type CityReference = {
  name: string;
  category: string | null;
  type: string | null;
  note: string | null;
};

function buildContext(p: PropertyRow, kids: {
  manual: Array<Record<string, unknown>>;
  faqs: Array<Record<string, unknown>>;
  emergency: Array<Record<string, unknown>>;
  checkout: Array<Record<string, unknown>>;
  recommendations: Recommendation[];
  cityReferences: CityReference[];
  knowledge: Array<Record<string, unknown>>;
  behavior: Array<Record<string, unknown>>;
}) {
  const lines: string[] = [];
  lines.push(`# Hospedagem: ${p.name ?? ""}`);
  if (p.tagline) lines.push(String(p.tagline));
  if (p.city) lines.push(`Cidade: ${p.city}`);
  if (p.address) lines.push(`Endereço: ${p.address}`);
  if (p.address_note) lines.push(`Como chegar: ${p.address_note}`);
  if (p.checkin_time) lines.push(`Check-in a partir de: ${p.checkin_time}${p.checkin_time_max ? ` até ${p.checkin_time_max}` : ""}`);
  if (p.checkout_time) lines.push(`Check-out até: ${p.checkout_time}${p.checkout_time_min ? ` (a partir de ${p.checkout_time_min})` : ""}`);
  if (p.checkin_instructions) lines.push(`Instruções de check-in: ${p.checkin_instructions}`);
  if (p.house_rules) lines.push(`Regras do espaço: ${p.house_rules}`);
  if (p.checkout_instructions) lines.push(`Instruções de check-out: ${p.checkout_instructions}`);
  const locked = typeof p.access_codes_pin === "string" && p.access_codes_pin.trim().length > 0;
  const mask = (v: unknown) => (locked ? "[BLOQUEADO POR SENHA]" : v);
  // host_phone é dado pessoal — sempre mascarado, independente de PIN.
  // Hóspede deve usar os canais da plataforma (Airbnb/Booking) para contato.
  const maskPhone = (_v: unknown) => "[Contate o anfitrião pela plataforma de reserva]";
  if (p.wifi_ssid) lines.push(`Wi-Fi rede: ${p.wifi_ssid}`);
  if (p.wifi_password) lines.push(`Wi-Fi senha: ${mask(p.wifi_password)}`);
  if (p.gate_code) lines.push(`Código do portão: ${mask(p.gate_code)}`);
  if (p.lock_code) lines.push(`Código da fechadura: ${mask(p.lock_code)}`);
  if (p.host_name) lines.push(`Anfitrião: ${p.host_name}`);
  if (p.host_phone) lines.push(`Telefone do anfitrião: ${maskPhone(p.host_phone)}`);

  if (kids.knowledge.length) {
    lines.push("\n## Conhecimento do anfitrião");
    for (const k of kids.knowledge) {
      lines.push(`### ${k.title}\n${k.body}`);
    }
  }
  if (kids.manual.length) {
    lines.push("\n## Manual da casa");
    for (const m of kids.manual) {
      lines.push(`- ${m.title}${m.description ? `: ${m.description}` : ""}${m.body ? `\n  ${m.body}` : ""}`);
    }
  }
  if (kids.faqs.length) {
    lines.push("\n## Perguntas frequentes");
    for (const f of kids.faqs) {
      lines.push(`- ${f.question}\n  R: ${f.answer}`);
    }
  }
  if (kids.emergency.length) {
    lines.push("\n## Emergências");
    for (const e of kids.emergency) {
      lines.push(`- ${e.label}: ${e.number}`);
    }
  }
  if (kids.checkout.length) {
    lines.push("\n## Antes de sair (checkout)");
    for (const c of kids.checkout) {
      lines.push(`- ${c.label}`);
    }
  }
  if (kids.behavior.length) {
    lines.push("\n## Comportamento / Atuação da IA (siga estritamente)");
    for (const b of kids.behavior) {
      lines.push(`### ${b.title}\n${b.body}`);
    }
  }
  if (kids.recommendations.length) {
    lines.push("\n## Recomendações próximas");
    for (const r of kids.recommendations.slice(0, 30)) {
      const parts = [r.name];
      if (r.category || r.type) parts.push(`(${[r.category, r.type].filter(Boolean).join(" / ")})`);
      if (r.distance_text) parts.push(`— ${r.distance_text}`);
      if (r.note) parts.push(`: ${r.note}`);
      lines.push(`- ${parts.join(" ")}`);
    }
  }
  if (kids.cityReferences.length) {
    lines.push("\n## Referências da cidade (pontos turísticos e estabelecimentos curados pelo anfitrião)");
    for (const r of kids.cityReferences.slice(0, 50)) {
      const parts = [r.name];
      if (r.category || r.type) parts.push(`(${[r.category, r.type].filter(Boolean).join(" / ")})`);
      if (r.note) parts.push(`: ${r.note}`);
      lines.push(`- ${parts.join(" ")}`);
    }
  }
  return lines.join("\n");
}

export const Route = createFileRoute("/api/public/guide-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch (err) {
          return new Response(JSON.stringify({ error: "Entrada inválida." }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        // Rate limit checks
        const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
        const rl = checkRateLimit(body.sessionId, clientIp, body.slug);
        if (!rl.ok) {
          return new Response(
            JSON.stringify({ error: "Muitas mensagens em pouco tempo. Aguarde um momento." }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "IA não configurada." }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: prop } = await supabaseAdmin
          .from("properties")
          .select("*")
          .eq("slug", body.slug)
          .eq("published", true)
          .maybeSingle<PropertyRow>();

        if (!prop) {
          return new Response(JSON.stringify({ error: "Guia não encontrado." }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        if (prop.access_mode === "pin") {
          const cookie = getCookie(`sg-pin-${prop.id}`);
          if (cookie !== "ok") {
            return new Response(JSON.stringify({ error: "Acesso bloqueado." }), { status: 403, headers: { "Content-Type": "application/json" } });
          }
        }

        // Gate: AI chat is only available to Business / Enterprise plan owners.
        const { resolveOwnerPlanAdmin } = await import("@/lib/plan-guard.server");
        const ownerPlan = await resolveOwnerPlanAdmin(supabaseAdmin as SupabaseClient, prop.owner_id);
        if (!ownerPlan.features.ai) {
          return new Response(
            JSON.stringify({ error: "A assistente IA não está disponível neste guia." }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }

        // Resolve city key for city_references lookup
        const { cityKey } = await import("@/lib/city-key");
        const ck = cityKey(prop.city);
        const propCountry = prop.country ?? "BR";

        const [manualR, faqsR, emergR, checkoutR, recsR, knowledgeR, behaviorR, cityRefsR] = await Promise.all([
          supabaseAdmin.from("property_manual_items").select("title, description, body").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("property_faqs").select("question, answer").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("property_emergency_contacts").select("label, number").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("property_checkout_items").select("label").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("property_recommendations").select("name, category, type, scope, distance_text, note").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("host_knowledge").select("title, body").eq("owner_id", prop.owner_id).eq("enabled", true).or(`scope_property_id.is.null,scope_property_id.eq.${prop.id}`).order("position"),
          supabaseAdmin.from("host_behavior").select("title, body").eq("owner_id", prop.owner_id).eq("enabled", true).or(`scope_property_id.is.null,scope_property_id.eq.${prop.id}`).order("position"),

          ck
            ? supabaseAdmin
                .from("city_references")
                .select("name, category, type, note")
                .eq("city_key", ck)
                .eq("country", propCountry)
                .eq("is_hidden", false)
                .order("type")
                .order("user_ratings_total", { ascending: false })
            : Promise.resolve({ data: [] }),
        ]);

        const systemContext = buildContext(prop, {
          manual: (manualR.data as Array<Record<string, unknown>>) ?? [],
          faqs: (faqsR.data as Array<Record<string, unknown>>) ?? [],
          emergency: (emergR.data as Array<Record<string, unknown>>) ?? [],
          checkout: (checkoutR.data as Array<Record<string, unknown>>) ?? [],
          recommendations: (recsR.data as Recommendation[]) ?? [],
          cityReferences: (cityRefsR.data as CityReference[]) ?? [],
          knowledge: (knowledgeR.data as Array<Record<string, unknown>>) ?? [],
          behavior: (behaviorR.data as Array<Record<string, unknown>>) ?? [],
        });

        // Get or create conversation
        let conversationId = body.conversationId;
        if (conversationId) {
          const { data: conv } = await supabaseAdmin
            .from("property_chat_conversations")
            .select("id, property_id, guest_session_id")
            .eq("id", conversationId)
            .maybeSingle();
          if (!conv || conv.property_id !== prop.id || conv.guest_session_id !== body.sessionId) {
            conversationId = undefined;
          }
        }
        if (!conversationId) {
          const { data: created, error: cErr } = await supabaseAdmin
            .from("property_chat_conversations")
            .insert({
              property_id: prop.id,
              guest_session_id: body.sessionId,
              guest_name: body.guestName ?? null,
            })
            .select("id")
            .single();
          if (cErr || !created) {
            return new Response(JSON.stringify({ error: "Não consegui iniciar a conversa." }), { status: 500, headers: { "Content-Type": "application/json" } });
          }
          conversationId = created.id;
        }

        // If the conversation is currently handled by a human (ai_paused), just
        // persist the guest message and let the agent reply — the guide chat
        // will surface new agent messages via polling / realtime.
        const { data: convState } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("ai_paused, status")
          .eq("id", conversationId)
          .maybeSingle();

        // Se a conversa está "resolvida" e o hóspede envia nova mensagem, reabrir com a IA.
        if (convState?.status === "resolved") {
          await supabaseAdmin
            .from("property_chat_conversations")
            .update({ status: "ai", ai_paused: false, resolved_at: null, assigned_to: null })
            .eq("id", conversationId);
        }

        // Se um humano assumiu a conversa (ai_paused), NUNCA devolvemos para a IA
        // — mesmo que o hóspede clique em uma dica com forceAi. A mensagem é
        // apenas persistida para o atendente responder.
        if (convState?.ai_paused) {
          await supabaseAdmin.from("property_chat_messages").insert({
            conversation_id: conversationId,
            role: "user",
            content: body.message,
            sender_type: "guest",
          });
          await supabaseAdmin
            .from("property_chat_conversations")
            .update({ last_message_at: new Date().toISOString(), guest_name: body.guestName ?? undefined })
            .eq("id", conversationId);
          return new Response(
            JSON.stringify({ conversationId, reply: "", handoff: true, humanMode: true }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        // Load prior messages (latest 20)
        const { data: priorRaw } = await supabaseAdmin
          .from("property_chat_messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(20);
        const prior = (priorRaw ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .reverse();

        await supabaseAdmin.from("property_chat_messages").insert({
          conversation_id: conversationId,
          role: "user",
          content: body.message,
          sender_type: "guest",
        });

        // Nota: quando ai_paused=true, já retornamos acima. Aqui ai_paused é
        // false, então não há handoff ativo para limpar.


        // Sticky exploration mode: se qualquer resposta anterior da IA já foi no
        // formato de exploração de dica, mantemos o mesmo comportamento nos
        // turnos seguintes (sem handoff automático, tom de amigo local).
        const explorationSignature = /Destaques|Melhor horário|Como chegar|Dica de quem conhece/i;
        const inExplorationFlow = body.forceAi || prior.some(
          (m) => m.role === "assistant" && explorationSignature.test(m.content ?? ""),
        );

        const EXPLORATION_MODE = `\n\nModo EXPLORAÇÃO — conversa sobre a cidade / dicas / lugares (ativo agora):
Você é um amigo local empolgado contando sobre lugares da cidade. Use livremente todo o seu conhecimento sobre Foz do Iguaçu e a região (atrações, restaurantes, bares, passeios, história, dicas práticas) — o Gemini tem conhecimento amplo, use-o com confiança, sem inventar detalhes específicos (preços exatos, horários do dia, se está aberto agora).

Tom e leitura:
- Escreva como quem conversa: texto fluido, respirável, 2 a 4 parágrafos curtos. Nada de "formulário" com muitos campos em negrito.
- Use **negrito** com moderação — só em 1 ou 2 palavras-chave da resposta inteira (nome do lugar, uma dica-chave). Não crie seções fixas tipo "Quanto custa / Melhor horário / Como chegar" — só mencione esses tópicos quando forem naturais na resposta.
- Bullets só se ajudarem (ex.: 2-3 destaques rápidos). Nunca obrigatório.
- Alvo: 100–180 palavras. Prefira menos a mais.
- NUNCA comece com "Essa dica...", "Trata-se de...", "Isso se refere a...". Comece pelo que é mais interessante.

O que você NÃO faz (seja transparente, sem prometer):
- Não busca ao vivo, não confirma horários de hoje, não checa disponibilidade de ingresso, não liga para lugares. Se o hóspede precisa desse tipo de dado, diga "os horários e preços podem variar — confirme no site/Instagram oficial antes de ir" e siga oferecendo o que VOCÊ consegue.
- NÃO transfere para humano nesse modo. Resolva você mesmo com base no seu conhecimento. Se realmente não souber algo específico, admita naturalmente e ofereça um caminho útil.

Encerramento:
- Termine com no MÁXIMO uma pergunta curta e natural, só quando fizer sentido — e apenas sobre algo que VOCÊ consegue responder (comparar com outro lugar, sugerir onde comer perto, contar sobre outro passeio). Não force pergunta em toda resposta.
- Nunca ofereça "quer que eu verifique / confirme / busque em tempo real".`;

        const NORMAL_MODE = `\n\nHandoff humano: chame a ferramenta request_human_handoff APENAS quando o hóspede pedir explicitamente falar com humano/anfitrião, OU quando houver emergência real (segurança, saúde, problema grave na hospedagem). Nunca chame por incerteza sua, nunca chame quando o hóspede só respondeu "sim", "ok", "pode ser" a uma pergunta sua. Após chamar, responda apenas: "Estou chamando um atendente humano, aguarde só um instante." Não invente contatos.`;

        const MODE_INSTRUCTIONS = inExplorationFlow ? EXPLORATION_MODE : NORMAL_MODE;

        const tools = inExplorationFlow
          ? undefined
          : [
              {
                type: "function",
                function: {
                  name: "request_human_handoff",
                  description: "Solicita atendimento humano. USE APENAS quando o hóspede PEDIR EXPLICITAMENTE falar com humano/anfitrião (ex.: 'quero falar com uma pessoa', 'chama o anfitrião', 'preciso de ajuda humana') ou quando houver emergência real (segurança, saúde, problema grave na hospedagem). NUNCA chame por incerteza sua. NUNCA chame quando o hóspede só respondeu 'sim', 'ok', 'pode ser', 'legal' a uma pergunta sua — isso é continuar a conversa, não pedir humano. Antes de chamar, escreva um RESUMO curto (1-2 frases, máx 220 caracteres) do que o hóspede precisa, no formato: 'Hóspede está perguntando sobre X — contexto e o que ele quer saber'.",
                  parameters: {
                    type: "object",
                    properties: {
                      reason: { type: "string", description: "Resumo curto do pedido do hóspede em 3ª pessoa (máx 220 caracteres)." },
                      urgency: { type: "string", enum: ["low", "normal", "high"] },
                    },
                    required: ["reason"],
                  },
                },
              },
            ];

        const OVERRIDE_LENGTH = inExplorationFlow
          ? `\n\n[OVERRIDE]: ignore o limite de "máx 3 frases" do prompt base. Neste modo exploração, alvo 100–180 palavras, tom conversacional, sem formulário.`
          : "";
        const messages = [
          { role: "system" as const, content: `${SYSTEM_PROMPT}${MODE_INSTRUCTIONS}${OVERRIDE_LENGTH}\n\n${systemContext}` },
          ...prior.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user" as const, content: body.message },
        ];


        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
          body: JSON.stringify({
            model: inExplorationFlow ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash",
            messages,
            ...(tools ? { tools } : {}),
          }),
        });


        if (aiRes.status === 429) {
          return new Response(JSON.stringify({ error: "Muitas perguntas em pouco tempo. Tente novamente em instantes.", conversationId }), { status: 429, headers: { "Content-Type": "application/json" } });
        }
        if (aiRes.status === 402) {
          return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Avise o anfitrião.", conversationId }), { status: 402, headers: { "Content-Type": "application/json" } });
        }
        if (!aiRes.ok) {
          const errText = await aiRes.text().catch(() => "");
          console.error("AI Gateway error", aiRes.status, errText);
          return new Response(JSON.stringify({ error: "Não consegui responder agora. Tente de novo.", conversationId }), { status: 502, headers: { "Content-Type": "application/json" } });
        }

        const json = (await aiRes.json()) as {
          choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
        };
        const choice = json.choices?.[0]?.message;
        const toolCalls = choice?.tool_calls ?? [];
        let handoffTriggered = false;
        for (const tc of toolCalls) {
          if (tc.function?.name === "request_human_handoff") {
            let args: { reason?: string; urgency?: string } = {};
            try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* ignore */ }
            const reason = (args.reason ?? "Hóspede pediu atendimento humano.").slice(0, 300);
            const urgency = args.urgency === "high" || args.urgency === "low" ? args.urgency : "normal";
            await supabaseAdmin
              .from("property_chat_conversations")
              .update({ status: "needs_human", ai_paused: true, handoff_reason: reason, handoff_urgency: urgency, handoff_at: new Date().toISOString() })
              .eq("id", conversationId);
            handoffTriggered = true;
            try {
              const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
              const userIds = await getPropertyNotifiableUsers(supabaseAdmin, prop.id);
              // Busca o access log mais recente do hóspede (por nome + propriedade) para pegar checkin_date
              const guestNameForLookup = (body.guestName ?? "").trim();
              const { data: accessLog } = guestNameForLookup
                ? await supabaseAdmin
                    .from("guide_access_logs")
                    .select("guest_name, checkin_date")
                    .eq("property_id", prop.id)
                    .eq("guest_name", guestNameForLookup)
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle()
                : { data: null as { guest_name: string; checkin_date: string } | null };
              await sendHandoffPush(supabaseAdmin, {
                userIds,
                conversationId,
                propertyName: prop.name,
                guestName: body.guestName ?? accessLog?.guest_name ?? null,
                guestMessage: body.message,
                checkinDate: accessLog?.checkin_date ?? null,
                reason,
                urgency,
              });
            } catch (e) {
              console.error("Handoff push failed", e);
            }
          }
        }

        const reply = (choice?.content ?? "").trim();
        const finalReply = handoffTriggered && !reply
          ? "Estou chamando um atendente humano, aguarde só um instante."
          : reply;

        if (finalReply) {
          await supabaseAdmin.from("property_chat_messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: finalReply,
            sender_type: handoffTriggered ? "ai" : "ai",
          });
        }
        await supabaseAdmin
          .from("property_chat_conversations")
          .update({ last_message_at: new Date().toISOString(), guest_name: body.guestName ?? undefined })
          .eq("id", conversationId);

        return new Response(JSON.stringify({ conversationId, reply: finalReply, handoff: handoffTriggered }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      // Poll for new messages in a conversation (used after human handoff so the
      // guest widget can surface agent replies without a page reload).
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const conversationId = url.searchParams.get("conversationId") ?? "";
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const since = url.searchParams.get("since");
        if (!/^[0-9a-f-]{36}$/i.test(conversationId) || sessionId.length < 8) {
          return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: conv } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("id, guest_session_id, ai_paused, status")
          .eq("id", conversationId)
          .maybeSingle();
        if (!conv || conv.guest_session_id !== sessionId) {
          return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        let q = supabaseAdmin
          .from("property_chat_messages")
          .select(
            "id, role, content, sender_type, created_at, attachment_path, attachment_type, attachment_mime, attachment_duration_ms, attachment_size_bytes, attachment_name",
          )
          .eq("conversation_id", conversationId)
          .eq("is_internal_note", false)
          .order("created_at", { ascending: true })
          .limit(50);
        if (since) q = q.gt("created_at", since);
        const { data: msgs } = await q;

        // Sign URLs for any attachment so the guest can preview them.
        const withAttachments = (msgs ?? []).filter((m) => m.attachment_path);
        const signedMap = new Map<string, string>();
        if (withAttachments.length) {
          const paths = withAttachments.map((m) => m.attachment_path as string);
          const { data: signed } = await supabaseAdmin.storage
            .from("chat-attachments")
            .createSignedUrls(paths, 60 * 60);
          for (const s of signed ?? []) {
            if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
          }
        }

        return new Response(
          JSON.stringify({
            humanMode: !!conv.ai_paused,
            status: conv.status,
            messages: (msgs ?? []).map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              senderType: m.sender_type,
              createdAt: m.created_at,
              attachment: m.attachment_path
                ? {
                    type: m.attachment_type,
                    mime: m.attachment_mime,
                    durationMs: m.attachment_duration_ms,
                    sizeBytes: m.attachment_size_bytes,
                    name: m.attachment_name,
                    url: signedMap.get(m.attachment_path as string) ?? null,
                  }
                : null,
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
