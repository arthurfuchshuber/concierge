import { createFileRoute } from "@tanstack/react-router";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  sessionId: z.string().min(8).max(80),
  conversationId: z.string().uuid().optional(),
  guestName: z.string().trim().min(1).max(80).optional(),
  message: z.string().trim().min(1).max(2000),
});

const SYSTEM_PROMPT = `Você é um concierge virtual de uma hospedagem de temporada.
Estilo: direto, objetivo e caloroso. Máximo 3 frases curtas. Sem redundância, sem repetir a pergunta, sem encerramentos genéricos. Português brasileiro por padrão; responda no idioma da pergunta.

Regras:
- Dados da casa (endereço, Wi-Fi, códigos, horários, regras, contatos, comodidades): use SOMENTE o contexto fornecido. Nunca invente.
- Recomendações da região: priorize a lista "Recomendações próximas" quando a categoria/tipo bater com o pedido (ex.: lanche → hamburgueria/lanchonete/padaria; NÃO cafeteria ou pizzaria sem o hóspede aceitar).
- Se o contexto não cobrir o pedido (ex.: passeios, atrações, esportes, serviços específicos da cidade), USE a ferramenta google_search para buscar estabelecimentos/atrações reais e atuais na cidade do hóspede antes de responder. Cite o nome real encontrado.
- Comparações/opiniões: UMA recomendação clara com 1 motivo curto. Não liste prós e contras.
- Cite distância apenas se for relevante. Não dê conselhos médicos, jurídicos ou financeiros.`;

type Recommendation = {
  name: string;
  category: string | null;
  type: string | null;
  scope: string | null;
  distance_text: string | null;
  note: string | null;
};

function buildContext(p: Record<string, unknown>, kids: {
  manual: Array<Record<string, unknown>>;
  faqs: Array<Record<string, unknown>>;
  emergency: Array<Record<string, unknown>>;
  checkout: Array<Record<string, unknown>>;
  recommendations: Recommendation[];
  knowledge: Array<Record<string, unknown>>;
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
  if (p.wifi_ssid) lines.push(`Wi-Fi rede: ${p.wifi_ssid}`);
  if (p.wifi_password) lines.push(`Wi-Fi senha: ${p.wifi_password}`);
  if (p.gate_code) lines.push(`Código do portão: ${p.gate_code}`);
  if (p.lock_code) lines.push(`Código da fechadura: ${p.lock_code}`);
  if (p.host_name) lines.push(`Anfitrião: ${p.host_name}`);
  if (p.host_phone) lines.push(`Telefone do anfitrião: ${p.host_phone}`);

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
          .maybeSingle();

        if (!prop) {
          return new Response(JSON.stringify({ error: "Guia não encontrado." }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        if (prop.access_mode === "pin") {
          const cookie = getCookie(`sg-pin-${prop.id}`);
          if (cookie !== "ok") {
            return new Response(JSON.stringify({ error: "Acesso bloqueado." }), { status: 403, headers: { "Content-Type": "application/json" } });
          }
        }

        const [manualR, faqsR, emergR, checkoutR, recsR, knowledgeR] = await Promise.all([
          supabaseAdmin.from("property_manual_items").select("title, description, body").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("property_faqs").select("question, answer").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("property_emergency_contacts").select("label, number").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("property_checkout_items").select("label").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("property_recommendations").select("name, category, type, scope, distance_text, note").eq("property_id", prop.id).order("position"),
          supabaseAdmin.from("host_knowledge").select("title, body").eq("owner_id", prop.owner_id).eq("enabled", true).order("position"),
        ]);

        const systemContext = buildContext(prop as Record<string, unknown>, {
          manual: (manualR.data as Array<Record<string, unknown>>) ?? [],
          faqs: (faqsR.data as Array<Record<string, unknown>>) ?? [],
          emergency: (emergR.data as Array<Record<string, unknown>>) ?? [],
          checkout: (checkoutR.data as Array<Record<string, unknown>>) ?? [],
          recommendations: (recsR.data as Recommendation[]) ?? [],
          knowledge: (knowledgeR.data as Array<Record<string, unknown>>) ?? [],
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

        // Load prior messages (latest 20)
        const { data: priorRaw } = await supabaseAdmin
          .from("property_chat_messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(40);
        const prior = (priorRaw ?? []).filter((m) => m.role === "user" || m.role === "assistant");

        // Persist user message
        await supabaseAdmin.from("property_chat_messages").insert({
          conversation_id: conversationId,
          role: "user",
          content: body.message,
        });

        const messages = [
          { role: "system" as const, content: `${SYSTEM_PROMPT}\n\n${systemContext}` },
          ...prior.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user" as const, content: body.message },
        ];

        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages,
            tools: [{ google_search: {} }],
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

        const json = (await aiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const reply = json.choices?.[0]?.message?.content?.trim() ?? "";

        if (reply) {
          await supabaseAdmin.from("property_chat_messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: reply,
          });
        }
        await supabaseAdmin
          .from("property_chat_conversations")
          .update({ last_message_at: new Date().toISOString(), guest_name: body.guestName ?? undefined })
          .eq("id", conversationId);

        return new Response(JSON.stringify({ conversationId, reply }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
