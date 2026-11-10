/**
 * DECISÃO HUMANA COM 1 CLIQUE — a resposta ÚNICA da IA ao hóspede depois do clique da equipe (10/11/2026).
 *
 * O texto parte SÓ do que a equipe decidiu (fato fechado, montado pelo sistema) + a mensagem do hóspede (para o
 * idioma e o tom). Modelo de baixo custo (Gemini Flash), saída curta, sem ferramentas. Proteções da D9: as
 * credenciais do imóvel vão como `forbiddenValues` (se aparecerem, o Gateway recusa antes da rede) e a saída é
 * conferida de novo; qualquer falha ⇒ texto padrão do sistema, que também não contém dado de acesso. Nunca lança.
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmMessage, LlmResult } from "@/lib/guest-ai/llm/contracts";
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { formatHour, type DecisionIntent, type DecisionKind } from "@/lib/guest-ai-decision";

export const DECISION_REPLY_MAX_OUTPUT_TOKENS = 220;
export const DECISION_REPLY_TIMEOUT_MS = 8_000;

export interface DecisionReplyInput {
  kind: DecisionKind;
  intent: Exclude<DecisionIntent, "assume">;
  /** Horário concedido (HH:MM), quando houver. */
  time: string | null;
  officialCheckout: string | null;
  officialCheckin: string | null;
  guestName: string | null;
  guestMessage: string;
  propertyName: string;
  /** Valores que JAMAIS podem sair (senhas/códigos do imóvel). */
  forbiddenValues: readonly string[];
}

export interface DecisionReplyDeps {
  llm?: (messages: LlmMessage[], forbidden: readonly string[]) => Promise<LlmResult>;
}

/** O fato decidido, em frase fechada (é a ÚNICA fonte do conteúdo da resposta). */
export function decidedFact(i: DecisionReplyInput): string {
  const h = i.time ? formatHour(i.time) : null;
  if (i.kind === "late_checkout") {
    const off = i.officialCheckout ? formatHour(i.officialCheckout) : "o horário oficial";
    if (i.intent === "approve")
      return h
        ? `Saída tardia APROVADA como cortesia: o hóspede pode sair até as ${h} (horário oficial ${off}).`
        : `Saída tardia APROVADA como cortesia; peça ao hóspede que confirme o horário em que pretende sair.`;
    if (i.intent === "charge")
      return `Saída tardia é POSSÍVEL mediante taxa de meia diária; pergunte se o hóspede deseja seguir (sem informar valor).`;
    return `Saída tardia NÃO é possível desta vez; a saída segue às ${off}.`;
  }
  if (i.kind === "early_checkin") {
    const off = i.officialCheckin ? formatHour(i.officialCheckin) : "o horário oficial";
    if (i.intent === "approve")
      return h
        ? `Entrada antecipada APROVADA como cortesia: o hóspede pode chegar a partir das ${h} (horário oficial ${off}).`
        : `Entrada antecipada APROVADA como cortesia; peça ao hóspede que confirme o horário de chegada.`;
    if (i.intent === "charge")
      return `Entrada antecipada é POSSÍVEL mediante taxa de meia diária; pergunte se o hóspede deseja seguir (sem informar valor).`;
    return `Entrada antecipada NÃO é possível desta vez; a entrada segue a partir das ${off}.`;
  }
  if (i.intent === "approve") return `O pedido do hóspede foi APROVADO.`;
  if (i.intent === "charge") return `O pedido é possível mediante cobrança; pergunte se o hóspede deseja seguir (sem informar valor).`;
  return `O pedido do hóspede NÃO pode ser atendido desta vez.`;
}

export function buildDecisionReplyPrompt(i: DecisionReplyInput): LlmMessage[] {
  const system = [
    `Você é o concierge do imóvel "${i.propertyName}" e vai responder UMA mensagem ao hóspede.`,
    "Use APENAS o fato decidido abaixo. Não invente horários, valores, alternativas nem promessas.",
    "Escreva no MESMO idioma da mensagem do hóspede, em tom acolhedor e consultivo, com no máximo 60 palavras.",
    "Não diga que consultou a equipe, não use frase de espera, não use Markdown nem links.",
    "Nunca inclua senhas, códigos de acesso, Wi-Fi ou instruções de entrada.",
    "Responda só com o texto da mensagem.",
  ].join("\n");
  const user = [
    `Nome do hóspede: ${(i.guestName ?? "").trim() || "(não informado)"}`,
    `Mensagem do hóspede: """${i.guestMessage.slice(0, 600)}"""`,
    `Fato decidido: ${decidedFact(i)}`,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Texto padrão do sistema (sem modelo), em português. */
export function fallbackDecisionReply(i: DecisionReplyInput): string {
  const first = (i.guestName ?? "").trim().split(/\s+/)[0];
  const hi = first ? `Oi, ${first}! ` : "Oi! ";
  const h = i.time ? formatHour(i.time) : null;
  if (i.kind === "late_checkout") {
    const off = i.officialCheckout ? formatHour(i.officialCheckout) : "o horário combinado";
    if (i.intent === "approve")
      return h
        ? `${hi}Tudo certo: você pode fazer o check-out até as ${h}, como cortesia. Aproveite a manhã com calma!`
        : `${hi}Conseguimos estender seu check-out como cortesia. Me conta a que horas você pretende sair?`;
    if (i.intent === "charge")
      return `${hi}Conseguimos estender seu check-out mediante a taxa de meia diária. Quer seguir com essa opção?`;
    return `${hi}Infelizmente não conseguimos estender o check-out desta vez; a saída segue às ${off}. Qualquer coisa, estou por aqui!`;
  }
  if (i.kind === "early_checkin") {
    const off = i.officialCheckin ? formatHour(i.officialCheckin) : "o horário combinado";
    if (i.intent === "approve")
      return h
        ? `${hi}Tudo certo: você pode chegar a partir das ${h}, como cortesia. Te esperamos!`
        : `${hi}Conseguimos antecipar sua entrada como cortesia. Me conta a que horas você pretende chegar?`;
    if (i.intent === "charge")
      return `${hi}Conseguimos antecipar sua entrada mediante a taxa de meia diária. Quer seguir com essa opção?`;
    return `${hi}Infelizmente não conseguimos antecipar a entrada desta vez; ela segue a partir das ${off}. Qualquer coisa, estou por aqui!`;
  }
  if (i.intent === "approve") return `${hi}Tudo certo, conseguimos atender o seu pedido!`;
  if (i.intent === "charge") return `${hi}Conseguimos atender o seu pedido mediante uma taxa. Quer seguir com essa opção?`;
  return `${hi}Infelizmente não conseguimos atender esse pedido desta vez. Qualquer outra coisa, estou por aqui!`;
}

const leaks = (text: string, forbidden: readonly string[]) =>
  forbidden.some((v) => v.trim().length >= 3 && text.includes(v.trim()));

/** Gera a resposta única (modelo; senão o texto padrão). Nunca lança e nunca devolve vazio. */
export async function generateDecisionReply(
  i: DecisionReplyInput,
  deps: DecisionReplyDeps = {},
): Promise<{ text: string; source: "model" | "fallback" }> {
  const fallback = { text: fallbackDecisionReply(i), source: "fallback" as const };
  const forbidden = i.forbiddenValues.filter((v) => typeof v === "string" && v.trim().length >= 3);
  try {
    const messages = buildDecisionReplyPrompt(i);
    const r = deps.llm
      ? await deps.llm(messages, forbidden)
      : await generateGuestLlm({
          purpose: "guest_reply",
          model: GUEST_AI_RESERVE_MODEL,
          messages,
          maxOutputTokens: DECISION_REPLY_MAX_OUTPUT_TOKENS,
          reasoningEffort: "low",
          responseFormat: "text",
          timeoutMs: DECISION_REPLY_TIMEOUT_MS,
          forbiddenValues: forbidden,
          traceId: "guest-decision-reply",
        });
    if (!r.ok || r.finishReason !== "stop") return fallback;
    const text = r.text.replace(/\*\*|__|`/g, "").trim();
    if (!text || text.length > 700 || leaks(text, forbidden) || /https?:\/\//i.test(text)) return fallback;
    return { text, source: "model" };
  } catch {
    return fallback;
  }
}
