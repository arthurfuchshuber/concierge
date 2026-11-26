/**
 * IA DO ATENDIMENTO — leituras e redações pedidas pela equipe na tela (mockups ATD-D12/D13/D14, REG-D01,
 * aprovados em 24–26/11/2026). Modelo de baixo custo (Gemini Flash), JSON curto, sem ferramentas. Nenhum texto
 * pronto ao hóspede: as instruções descrevem comportamento e limites; quem redige é o modelo (16/11/2026).
 *
 *  - `composeInstructedReply`: a equipe escreve a instrução do seu jeito ("Instruir a IA"); a IA lê a conversa e
 *    decide se AINDA é preciso responder ao hóspede (se a equipe já respondeu o ponto, não manda nada; só o que
 *    ficou em aberto, sem repetir nem contradizer a equipe), redige a resposta no idioma do canal e, se pedido,
 *    resume a instrução como aprendizado duradouro do imóvel (categoria fechada).
 *  - `instructionScopeWarning`: instrução sobre algo FÍSICO marcada para vários imóveis ⇒ aviso ESPECÍFICO do que
 *    difere em cada imóvel (25/11/2026: nunca genérico como "essa instrução fala do portão").
 *  - `classifyRegional`: a fala da equipe descreve uma situação da REGIÃO (energia, água, internet, temporal) e
 *    não um defeito do imóvel? Só gera a SUGESTÃO de marcar; quem confirma é a equipe.
 * Falha do modelo ⇒ resultado seguro (sem envio / sem aviso / sem sugestão). Nunca lança.
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmMessage } from "@/lib/guest-ai/llm/contracts";
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { LEARNING_CATEGORIES, type LearningCategory } from "@/lib/guest-ai/learning/learning";

type Llm = (messages: LlmMessage[], opts: { maxOutputTokens: number; forbidden?: readonly string[] }) => Promise<{ ok: boolean; json?: unknown }>;

const defaultLlm: Llm = async (messages, opts) => {
  const r = await generateGuestLlm({
    purpose: "evaluation",
    model: GUEST_AI_RESERVE_MODEL,
    messages,
    maxOutputTokens: opts.maxOutputTokens,
    reasoningEffort: "low",
    responseFormat: "json",
    timeoutMs: 20_000,
    forbiddenValues: opts.forbidden ?? [],
    traceId: "atendimento-ai",
  });
  return r.ok ? { ok: true, json: (r as { json?: unknown }).json } : { ok: false };
};

export interface HistoryLine {
  who: "hóspede" | "equipe" | "ia" | "automática";
  text: string;
  at: string;
}

export interface InstructInput {
  propertyName: string;
  guestName: string | null;
  history: readonly HistoryLine[];
  /** Pergunta que a IA fez à equipe ao encaminhar (quando houver). */
  aiQuestion: string | null;
  instruction: string;
  /** Pedir também o aprendizado duradouro. */
  teach: boolean;
  /** Senhas/códigos que não podem sair (exceto os que a própria equipe escreveu na instrução). */
  forbidden: readonly string[];
}

export interface InstructResult {
  needsReply: boolean;
  reply: string | null;
  learning: { statement: string; category: LearningCategory } | null;
}

export function buildInstructPrompt(i: InstructInput): LlmMessage[] {
  const system = [
    `Você é o concierge do imóvel "${i.propertyName}". A equipe deu uma instrução para você levar ao hóspede.`,
    "1) Leia a conversa. Se, depois da última mensagem do hóspede, a equipe já respondeu o ponto que a instrução trata, não envie nada (needs_reply=false). Envie só o que ainda está em aberto, sem repetir nem contradizer a equipe.",
    "2) Se for preciso responder, redija UMA mensagem com as suas palavras, a partir da instrução da equipe, no idioma da conversa, curta, acolhedora e objetiva, sem Markdown, sem links, sem dizer que consultou a equipe e sem prometer o que a instrução não diz.",
    i.teach
      ? `3) Resuma a instrução como um fato DURADOURO do imóvel (vale para próximos hóspedes), em terceira pessoa, sem nomes, datas, horários de uma estadia nem dados desta reserva; escolha a categoria entre: ${LEARNING_CATEGORIES.join(", ")}. Se não houver fato duradouro, use learning=null.`
      : "3) learning = null.",
    'Responda só em JSON: {"needs_reply": true|false, "reply": "texto ou vazio", "learning": {"statement": "...", "category": "..."} ou null}.',
  ].join("\n");
  const convo = i.history
    .slice(-30)
    .map((h) => `[${h.at}] ${h.who}: ${h.text.slice(0, 700)}`)
    .join("\n");
  const user = [
    `Hóspede: ${(i.guestName ?? "").trim() || "(sem nome)"}`,
    i.aiQuestion ? `Pergunta que a IA fez à equipe: ${i.aiQuestion}` : null,
    `Conversa (da mais antiga à mais nova):\n${convo || "(sem mensagens)"}`,
    `Instrução da equipe: """${i.instruction.slice(0, 1500)}"""`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export async function composeInstructedReply(i: InstructInput, deps: { llm?: Llm } = {}): Promise<InstructResult | null> {
  try {
    const forbidden = i.forbidden.filter((v) => v.trim().length >= 3 && !i.instruction.includes(v.trim()));
    const r = await (deps.llm ?? defaultLlm)(buildInstructPrompt(i), { maxOutputTokens: 700, forbidden });
    if (!r.ok || !r.json || typeof r.json !== "object") return null;
    const j = r.json as { needs_reply?: unknown; reply?: unknown; learning?: unknown };
    const reply = typeof j.reply === "string" ? j.reply.replace(/\*\*|__|`/g, "").trim() : "";
    const needsReply = j.needs_reply === true && reply.length > 0 && reply.length <= 1200 && !/https?:\/\//i.test(reply);
    if (needsReply && forbidden.some((v) => reply.includes(v.trim()))) return null;
    let learning: InstructResult["learning"] = null;
    const l = j.learning as { statement?: unknown; category?: unknown } | null;
    if (i.teach && l && typeof l.statement === "string" && (LEARNING_CATEGORIES as readonly string[]).includes(String(l.category))) {
      const statement = l.statement.replace(/\s+/g, " ").trim();
      if (statement.length >= 15 && statement.length <= 400) learning = { statement, category: l.category as LearningCategory };
    }
    return { needsReply, reply: needsReply ? reply : null, learning };
  } catch {
    return null;
  }
}

export interface ScopeProperty {
  name: string;
  info: string;
}

export async function instructionScopeWarning(
  i: { instruction: string; properties: readonly ScopeProperty[] },
  deps: { llm?: Llm } = {},
): Promise<string | null> {
  if (i.properties.length < 2 || i.instruction.trim().length < 8) return null;
  try {
    const system = [
      "Você confere se uma instrução da equipe vale igualmente para vários imóveis.",
      "Se a instrução fala de algo FÍSICO ou de um procedimento (portão, fechadura, cofre, aparelho, registro, chave, acesso) e as informações de algum imóvel mostram que lá é diferente, escreva um aviso CURTO e ESPECÍFICO: diga o que a instrução afirma, sobre qual item, e o que é diferente em cada imóvel citado pelo nome. Nunca um aviso genérico.",
      "Se não há diferença conhecida ou a instrução não é sobre algo físico, warning = null.",
      'Responda só em JSON: {"warning": "texto" ou null}.',
    ].join("\n");
    const user = [
      `Instrução: """${i.instruction.slice(0, 1200)}"""`,
      ...i.properties.slice(0, 12).map((p, n) => `Imóvel ${n + 1} — ${p.name}:\n${p.info.slice(0, 1400) || "(sem informações)"}`),
    ].join("\n\n");
    const r = await (deps.llm ?? defaultLlm)(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxOutputTokens: 300 },
    );
    if (!r.ok || !r.json || typeof r.json !== "object") return null;
    const w = (r.json as { warning?: unknown }).warning;
    return typeof w === "string" && w.trim().length >= 10 ? w.trim().slice(0, 400) : null;
  } catch {
    return null;
  }
}

export interface RegionalGuess {
  kind: string;
  aiText: string;
}

export async function classifyRegional(
  i: { teamText: string; guestContext: string; city: string },
  deps: { llm?: Llm } = {},
): Promise<RegionalGuess | null> {
  if (i.teamText.trim().length < 12) return null;
  try {
    const system = [
      "Você lê a fala da equipe de uma hospedagem a um hóspede.",
      "regional = true só quando a fala afirma que o problema é da REGIÃO/CIDADE/BAIRRO e não do imóvel: falta de energia, água ou internet na região, temporal, enchente, via bloqueada, órgão público restabelecendo serviço. Defeito ou falha dentro do imóvel nunca é regional.",
      "Quando regional, dê o tipo curto (ex.: Falta de energia) e um texto para a IA reaproveitar com outros hóspedes da mesma cidade, sem nomes de hóspedes nem do imóvel.",
      'Responda só em JSON: {"regional": true|false, "kind": "…", "ai_text": "…"}.',
    ].join("\n");
    const user = [`Cidade do imóvel: ${i.city}`, `O que o hóspede relatou: """${i.guestContext.slice(0, 800)}"""`, `Fala da equipe: """${i.teamText.slice(0, 800)}"""`].join("\n");
    const r = await (deps.llm ?? defaultLlm)(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxOutputTokens: 260 },
    );
    if (!r.ok || !r.json || typeof r.json !== "object") return null;
    const j = r.json as { regional?: unknown; kind?: unknown; ai_text?: unknown };
    if (j.regional !== true) return null;
    const kind = typeof j.kind === "string" ? j.kind.trim().slice(0, 80) : "";
    const aiText = typeof j.ai_text === "string" ? j.ai_text.trim().slice(0, 600) : "";
    if (!kind || !aiText) return null;
    return { kind: kind.charAt(0).toUpperCase() + kind.slice(1), aiText };
  } catch {
    return null;
  }
}
