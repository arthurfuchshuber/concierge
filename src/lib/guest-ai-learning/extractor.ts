/**
 * APRENDIZADO CONTÍNUO · EXTRATOR de candidatos (Etapa 3 da tranche final, 10/11/2026) — núcleo PURO.
 *
 * Lê a conversa de uma situação ENCERRADA (checkout confirmado ou atendimento resolvido pela equipe) e
 * monta o pedido ao modelo; depois valida a resposta. Nada aqui grava: os candidatos válidos seguem para
 * `proposeLearningCandidate` (travas de `evaluateCandidate` + RPC `guest_ai_learning_propose`) e nascem
 * `pending`, à espera de revisão humana. Nunca viram fato aprovado sozinhos.
 *
 * Travas próprias do extrator (somam-se às de `evaluateCandidate`):
 *  - SEGREDO NUNCA SAI: cada mensagem passa pelo `SECRET_SCRUBBER` ANTES de ir ao modelo (senha, código,
 *    Wi-Fi viram marcador); o modelo não vê o valor e não tem como "aprender" o segredo;
 *  - IDS OPACOS: o modelo vê apelidos (`m1`, `m2`…), nunca ids reais; evidência com apelido desconhecido
 *    descarta o candidato;
 *  - CONFIRMAÇÃO DO HÓSPEDE só vale se ao menos uma evidência for mensagem do HÓSPEDE;
 *  - O IMÓVEL nunca vem do modelo: quem chama informa (derivado do banco), e é o mesmo para tudo.
 */
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { LEARNING_CATEGORIES, type LearningCategory, type LearningSource } from "@/lib/guest-ai/learning/learning";
import type { LlmMessage } from "@/lib/guest-ai/llm/contracts";

export type LearningTrigger = Extract<LearningSource, "checkout_done" | "incident_resolved">;
export type TranscriptSpeaker = "guest" | "team" | "internal_note" | "ai" | "system" | "other";

export interface TranscriptMessage {
  id: string;
  speaker: TranscriptSpeaker;
  text: string;
}

/** Até 5 candidatos por situação; o resto é ruído para a revisão humana. */
export const LEARNING_EXTRACT_MAX_CANDIDATES = 5;
/** Janela de conversa enviada (as mais recentes) e teto de bytes do transcrito. */
export const LEARNING_EXTRACT_MAX_MESSAGES = 200;
export const LEARNING_EXTRACT_MAX_TRANSCRIPT_BYTES = 24_000;
export const LEARNING_EXTRACT_MAX_MESSAGE_CHARS = 1_200;
export const LEARNING_EXTRACT_MAX_OUTPUT_TOKENS = 1_024;

const SPEAKER_LABEL: Record<TranscriptSpeaker, string> = {
  guest: "hospede",
  team: "equipe",
  internal_note: "nota_interna_equipe",
  ai: "ia",
  system: "sistema",
  other: "outro",
};

const TRIGGER_LABEL: Record<LearningTrigger, string> = {
  checkout_done: "estadia encerrada com checkout confirmado",
  incident_resolved: "atendimento encerrado pela equipe como resolvido",
};

export interface LearningPrompt {
  messages: LlmMessage[];
  /** apelido → id real */
  aliases: ReadonlyMap<string, string>;
  /** apelidos de mensagens do HÓSPEDE */
  guestAliases: ReadonlySet<string>;
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

const SYSTEM = `Você revisa conversas ENCERRADAS de um imóvel de temporada e sugere aprendizados DURADOUROS sobre o IMÓVEL para a equipe aprovar.

Regras:
- Só fatos sobre o imóvel que continuam verdadeiros para os PRÓXIMOS hóspedes (como algo funciona, onde fica, como resolver um problema recorrente). Ex.: o Wi-Fi da varanda depende do repetidor da sala.
- Só o que a conversa COMPROVA: a equipe resolveu, ou o hóspede confirmou que funcionou. Nada de suposição, promessa, pedido em aberto ou pergunta sem resposta.
- NUNCA: datas, horários de uma estadia, valores, nomes de pessoas, telefones, códigos de reserva, preferências ou pedidos de um hóspede específico, elogios, reclamações pontuais.
- NUNCA senhas, códigos de porta, portão, fechadura, cofre ou Wi-Fi. Trechos marcados como removidos ou retidos são segredos: ignore.
- Escreva cada fato numa frase objetiva, impessoal, em português, entre 15 e 300 caracteres.
- Categoria (exatamente uma): ${LEARNING_CATEGORIES.join(", ")}.
- evidencias: os identificadores (m1, m2…) das mensagens que comprovam o fato.
- confirmacao_hospede: true SOMENTE se o próprio hóspede confirmou explicitamente que a solução funcionou.
- No máximo ${LEARNING_EXTRACT_MAX_CANDIDATES} fatos. Se nada servir, devolva a lista vazia (é o caso mais comum).

Responda estritamente em JSON: {"candidatos":[{"categoria":"...","fato":"...","evidencias":["m1"],"confirmacao_hospede":false}]}`;

/** Monta o pedido. `null` = nada a aprender (sem conversa de hóspede e equipe). */
export function buildLearningPrompt(trigger: LearningTrigger, messages: readonly TranscriptMessage[]): LearningPrompt | null {
  const usable = messages.filter((m) => typeof m.text === "string" && m.text.trim() && typeof m.id === "string" && m.id);
  if (!usable.some((m) => m.speaker === "guest")) return null;
  if (!usable.some((m) => m.speaker === "team" || m.speaker === "internal_note" || m.speaker === "ai")) return null;

  // mais recentes primeiro até o teto de bytes; depois volta à ordem cronológica
  const picked: Array<{ m: TranscriptMessage; text: string }> = [];
  let total = 0;
  for (const m of usable.slice(-LEARNING_EXTRACT_MAX_MESSAGES).reverse()) {
    const clean = SECRET_SCRUBBER.scan(m.text.replace(/\s+/g, " ").trim()).text.slice(0, LEARNING_EXTRACT_MAX_MESSAGE_CHARS);
    const size = bytes(clean) + 32;
    if (total + size > LEARNING_EXTRACT_MAX_TRANSCRIPT_BYTES) break;
    total += size;
    picked.push({ m, text: clean });
  }
  picked.reverse();
  if (!picked.some((p) => p.m.speaker === "guest")) return null;

  const aliases = new Map<string, string>();
  const guestAliases = new Set<string>();
  const lines = picked.map((p, i) => {
    const a = `m${i + 1}`;
    aliases.set(a, p.m.id);
    if (p.m.speaker === "guest") guestAliases.add(a);
    return `[${a}] (${SPEAKER_LABEL[p.m.speaker]}): ${p.text}`;
  });
  const user = `Situação: ${TRIGGER_LABEL[trigger]}.\n\n<conversa>\n${lines.join("\n")}\n</conversa>\n\nResponda estritamente em formato JSON.`;
  return {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    aliases,
    guestAliases,
  };
}

export interface ExtractedCandidate {
  category: LearningCategory;
  statement: string;
  source: LearningSource;
  refs: string[];
}

export type DropReason = "malformed" | "category_invalid" | "no_evidence" | "unknown_evidence" | "guest_confirmation_without_guest";

/** Valida a resposta do modelo. Nunca lança: item ruim é descartado com motivo fechado. */
export function parseLearningOutput(
  json: unknown,
  prompt: LearningPrompt,
  trigger: LearningTrigger,
): { candidates: ExtractedCandidate[]; dropped: DropReason[] } {
  const dropped: DropReason[] = [];
  const list = json && typeof json === "object" ? (json as Record<string, unknown>)["candidatos"] : null;
  if (!Array.isArray(list)) return { candidates: [], dropped: json === null || json === undefined ? [] : ["malformed"] };
  const candidates: ExtractedCandidate[] = [];
  for (const raw of list.slice(0, LEARNING_EXTRACT_MAX_CANDIDATES)) {
    if (!raw || typeof raw !== "object") {
      dropped.push("malformed");
      continue;
    }
    const r = raw as Record<string, unknown>;
    const category = r["categoria"];
    const statement = r["fato"];
    const evid = r["evidencias"];
    if (typeof statement !== "string" || !Array.isArray(evid)) {
      dropped.push("malformed");
      continue;
    }
    if (typeof category !== "string" || !(LEARNING_CATEGORIES as readonly string[]).includes(category)) {
      dropped.push("category_invalid");
      continue;
    }
    const tags = [...new Set(evid.filter((e): e is string => typeof e === "string"))];
    if (tags.length === 0) {
      dropped.push("no_evidence");
      continue;
    }
    if (tags.some((t) => !prompt.aliases.has(t))) {
      dropped.push("unknown_evidence");
      continue;
    }
    let source: LearningSource = trigger;
    if (r["confirmacao_hospede"] === true) {
      if (!tags.some((t) => prompt.guestAliases.has(t))) {
        dropped.push("guest_confirmation_without_guest");
        continue;
      }
      source = "guest_confirmation";
    }
    candidates.push({
      category: category as LearningCategory,
      statement,
      source,
      refs: tags.map((t) => prompt.aliases.get(t)!),
    });
  }
  return { candidates, dropped };
}
