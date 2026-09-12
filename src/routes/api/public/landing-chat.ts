import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai/models";

// In-process rate limiter (reset on deploy).
const ipMessageTimes = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const min = 60_000;
  const times = (ipMessageTimes.get(ip) ?? []).filter((t) => now - t < min);
  if (times.length >= 20) return false;
  times.push(now);
  ipMessageTimes.set(ip, times);
  return true;
}

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
});

// Base de conhecimento da plataforma — usada pela IA da landing page.
const PLATFORM_KNOWLEDGE = `
# O que é o ConciergeIA
SaaS de guia digital com IA para anfitriões de temporada (Airbnb, Booking, aluguel direto).
Substitui o "manual da casa" em PDF/WhatsApp por um guia web multilíngue, com IA 24/7 e analytics de comportamento.
Ativação em ~15 minutos. Sem app: o hóspede acessa por link/QR Code enviado no check-in.

# Como funciona (fluxo do anfitrião)
1. Cria a hospedagem (nome, endereço, cidade) — pode importar direto do link do Airbnb.
2. Preenche Wi-Fi, horários de check-in/out, instruções, regras da casa, checkout, contatos de emergência, manual, FAQs.
3. Adiciona recomendações locais (restaurantes, mercados, farmácias, atrações). O sistema sugere automaticamente com base no Google Maps + curadoria da cidade feita pela equipe Sigma.
4. Publica o guia e compartilha o QR Code / link com o hóspede.
5. Acompanha no painel "Engajamento" o que os hóspedes acessaram, tempo de sessão, conversas com a IA, feedbacks.

# Funcionalidades principais
- **Guia digital bilíngue** (PT / EN / ES) com identidade personalizada (foto, tagline, cores da capa).
- **QR Code impressão-pronto** por imóvel.
- **Wi-Fi com bloqueio por senha** — hóspede libera Wi-Fi/códigos com PIN enviado pelo anfitrião no dia do check-in (evita vazamento pré/pós estadia).
- **Instruções de check-in e check-out** com horários e passos.
- **Regras da casa e manual** (como usar TV, ar-condicionado, piscina etc).
- **FAQs personalizadas**.
- **Contatos de emergência** (bombeiro, polícia, hospital, anfitrião via plataforma).
- **Recomendações locais automáticas + curadoria manual** (categoria, distância, notas). Deep links para Uber / 99 / Waze / Google Maps.
- **Cidade + Aqui pertinho**: pontos turísticos e "referências da cidade" curados pela equipe Sigma (base compartilhada, não precisa cada anfitrião cadastrar).
- **Marketplace de parceiros** (planos superiores) — parceiros comerciais recomendados na região.
- **Importação Airbnb** (Pro/Business): puxa nome, fotos, descrição e regras direto do anúncio.
- **IA Concierge 24/7 no guia** (Business): hóspede pergunta na hora e a IA responde usando os dados do imóvel + cidade. Base treinável (conhecimento próprio do anfitrião) + comportamento configurável.
- **Analytics de engajamento**: painel "Engajamento" com KPIs, jornada por seção, funil, matriz de impacto de conteúdo, hóspedes individuais e as próprias conversas com a IA.
- **Feedbacks "não útil"**: hóspede marca respostas ruins da IA; anfitrião vê no painel e ensina a IA.
- **Melhorias contínuas priorizadas** (Business): pedidos de melhoria são atendidos primeiro.
- **Multi-imóveis** com edição em massa (Bulk Edit) e etiquetas.

# Planos e preços (BRL, cobrança recorrente)
- **Starter — R$ 99/mês**: guia bilíngue, QR Code, seções básicas (Wi-Fi, check-in, regras, manual, FAQs, emergência), recomendações manuais, analytics básico. **Não inclui IA.**
- **Pro (Professional) — R$ 199/mês**: tudo do Starter + importação Airbnb, recomendações automáticas Google Maps, curadoria local (cidades), deep links Uber/99/Waze, marketplace de parceiros, analytics completo.
- **Business — R$ 399/mês**: tudo do Pro + **IA Concierge 24/7** no guia com base treinável e comportamento configurável, insights avançados de engajamento, feedbacks "não útil" acionáveis, **melhorias contínuas priorizadas**.
- **Teste grátis: 7 dias em qualquer plano.** Sem fidelidade, cancela quando quiser.
- Cobrança processada via Paddle. Cartão internacional ou nacional.

# WhatsApp
Hoje o guia é web (link + QR). Integração nativa com WhatsApp Business API está no roadmap 2026 — quando disponível, será ativada automaticamente a partir do plano Professional.

# Suporte e time
Time humano no WhatsApp (47) 99675-9381 para dúvidas comerciais e onboarding.
A plataforma é feita pela Anfitrião Sigma (www.anfitriaosigma.com.br) — empresa especializada em hospedagem de temporada.

# Segurança
- Dados sensíveis (senha do Wi-Fi, códigos de portão/fechadura, telefone do anfitrião) são bloqueados por PIN dinâmico enviado pelo anfitrião.
- A IA nunca revela dados bloqueados, mesmo se o hóspede insistir.
- Telefone do anfitrião é sempre mascarado — o hóspede é direcionado à plataforma de reserva (Airbnb/Booking).
`.trim();

const SYSTEM_PROMPT = `Você é a IA de atendimento comercial do ConciergeIA na landing page (site institucional).

Seu papel: tirar dúvidas de leads que estão considerando contratar a plataforma. Responda com precisão sobre planos, funcionalidades, integrações, preços, funcionamento e onboarding.

Tom: PT-BR, direto, caloroso, objetivo. Máximo 4 frases curtas. Use **negrito** com asteriscos para destacar. Sem encerramentos genéricos ("estou à disposição"). Sem repetir a pergunta.

Regras:
- Use SOMENTE as informações abaixo (Base de conhecimento). Não invente funcionalidades, preços ou prazos.
- Se a pessoa perguntar algo que **não está** na base OU que exija negociação (desconto, plano customizado, integração específica não listada, prazo de nova feature, questão contratual), responda o que puder e finalize a resposta com a tag [HANDOFF] — o app vai oferecer WhatsApp humano em seguida.
- Se a pessoa demonstrar intenção clara de falar com um humano ("quero falar com alguém", "vendedor", "atendente"), finalize com [HANDOFF].
- Se perguntarem "qual plano é melhor pra mim?", faça no máximo UMA pergunta curta de qualificação (quantos imóveis? quer IA?) antes de sugerir.
- Nunca prometa features fora da lista. WhatsApp nativo é **roadmap 2026**, não disponível hoje.

# Base de conhecimento
${PLATFORM_KNOWLEDGE}`;

export const Route = createFileRoute("/api/public/landing-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Entrada inválida." }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
        if (!checkRateLimit(clientIp)) {
          return new Response(JSON.stringify({ error: "Muitas mensagens em pouco tempo. Aguarde um instante." }), { status: 429, headers: { "Content-Type": "application/json" } });
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "IA indisponível no momento." }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        // Descarta qualquer system que o cliente tenha mandado — nosso prompt é fixo.
        const userMessages = body.messages.filter((m) => m.role !== "system");

        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
          body: JSON.stringify({
            model: AI_MODELS.content,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...userMessages,
            ],
          }),
        });

        if (aiRes.status === 429) {
          return new Response(JSON.stringify({ error: "Muitas perguntas. Tente de novo em instantes." }), { status: 429, headers: { "Content-Type": "application/json" } });
        }
        if (aiRes.status === 402) {
          return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), { status: 402, headers: { "Content-Type": "application/json" } });
        }
        if (!aiRes.ok) {
          const errText = await aiRes.text().catch(() => "");
          console.error("Landing AI Gateway error", aiRes.status, errText);
          return new Response(JSON.stringify({ error: "Não consegui responder agora." }), { status: 502, headers: { "Content-Type": "application/json" } });
        }

        const json = (await aiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const reply = json.choices?.[0]?.message?.content?.trim() ?? "";
        return new Response(JSON.stringify({ reply }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
