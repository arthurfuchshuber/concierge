/**
 * A EQUIPE JÁ RESPONDEU ESTE ASSUNTO? (25/11/2026, regras da faixa de decisão)
 *  - Ao clicar num botão da decisão, a IA NÃO envia nada antes de conferir se alguém da equipe (painel ou direto
 *    no Airbnb) já respondeu ao hóspede sobre aquele pedido depois que ele foi feito; se respondeu, ela não envia.
 *  - Uma resposta direta da equipe SOBRE O MESMO TEMA encerra a faixa (vira a linha de registro); resposta sobre
 *    outro assunto não mexe nela.
 * Leitura pelo modelo de baixo custo (sem lista de frases). Sem mensagem da equipe ⇒ "not_answered" sem modelo.
 * Falha do modelo ⇒ "unknown" (quem chama decide o lado seguro). Nunca lança.
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmMessage } from "@/lib/guest-ai/llm/contracts";
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";

export type TopicVerdict = "answered" | "not_answered" | "unknown";

export interface TopicInput {
  /** Texto da faixa (o pedido em questão). */
  decisionText: string;
  /** O que o hóspede pediu. */
  guestMessage: string;
  /** Falas da equipe depois do pedido, da mais antiga à mais nova. */
  teamMessages: readonly string[];
}

export function buildTopicPrompt(i: TopicInput): LlmMessage[] {
  const system = [
    "Você confere uma conversa de hospedagem. Responda só em JSON: {\"answered\": true|false}.",
    "answered = true quando alguma fala da equipe já respondeu ao hóspede sobre o MESMO pedido (aceitando, recusando, cobrando, pedindo detalhe ou dizendo que vai verificar esse pedido).",
    "answered = false quando as falas da equipe tratam de outro assunto.",
  ].join("\n");
  const user = [
    `Pedido em questão: ${i.decisionText.replace(/\*\*/g, "")}`,
    `Mensagem do hóspede: """${i.guestMessage.slice(0, 800)}"""`,
    `Falas da equipe depois do pedido:\n${i.teamMessages.map((t, n) => `${n + 1}. """${t.slice(0, 500)}"""`).join("\n")}`,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export async function teamAnsweredTopic(
  i: TopicInput,
  deps: { llm?: (m: LlmMessage[]) => Promise<{ ok: boolean; json?: unknown }> } = {},
): Promise<TopicVerdict> {
  const team = i.teamMessages.map((t) => t.trim()).filter(Boolean);
  if (team.length === 0) return "not_answered";
  try {
    const messages = buildTopicPrompt({ ...i, teamMessages: team.slice(-6) });
    const r = deps.llm
      ? await deps.llm(messages)
      : await generateGuestLlm({
          purpose: "evaluation",
          model: GUEST_AI_RESERVE_MODEL,
          messages,
          maxOutputTokens: 60,
          reasoningEffort: "low",
          responseFormat: "json",
          timeoutMs: 8_000,
          traceId: "decision-topic",
        });
    if (!r.ok) return "unknown";
    const v = (r as { json?: { answered?: unknown } }).json?.answered;
    return v === true ? "answered" : v === false ? "not_answered" : "unknown";
  } catch {
    return "unknown";
  }
}
