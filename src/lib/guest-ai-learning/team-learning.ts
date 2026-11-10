/**
 * AUTO-APRENDIZADO SILENCIOSO a partir de mensagens da EQUIPE (10/11/2026, governança por exceção) — PURO.
 *
 * Quando um atendente informa ao hóspede um fato do imóvel (onde fica algo, regra da casa, como usar um
 * aparelho), a IA extrai o fato e ele entra no Documento Vivo na hora (aprovado em nome do atendente, se ele
 * tiver permissão); a equipe desfaz ou ajusta o escopo se discordar.
 *
 * O modelo também classifica:
 *  - TEMPORALIDADE: `permanente` (instalação, infraestrutura, regra geral) vira regra; `estadia` (lâmpada
 *    queimada hoje, malas extras deste hóspede) NÃO vira regra do imóvel — fica só no histórico da conversa;
 *  - ESCOPO: `imovel`, `cidade` (coleta de lixo, voltagem regional) ou `conta` (diretriz da empresa).
 * Só o fato que está NA MENSAGEM DA EQUIPE conta (a conversa anterior é contexto). Segredos são removidos
 * antes do modelo; todo candidato ainda passa por `evaluateCandidate`.
 */
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { LEARNING_CATEGORIES, type LearningCategory } from "@/lib/guest-ai/learning/learning";
import type { LlmMessage } from "@/lib/guest-ai/llm/contracts";
import type { LearningScope } from "./qualify";

export const TEAM_LEARNING_MAX_FACTS = 3;
export const TEAM_LEARNING_CONTEXT_MESSAGES = 8;
export const TEAM_LEARNING_MAX_CHARS = 1_500;
export const TEAM_LEARNING_MAX_OUTPUT_TOKENS = 600;

export interface TeamContextMessage {
  speaker: "guest" | "team" | "ai";
  text: string;
}

const LABEL = { guest: "hospede", team: "equipe", ai: "ia" } as const;
const clean = (t: string) => SECRET_SCRUBBER.scan(t.replace(/\s+/g, " ").trim()).text.slice(0, TEAM_LEARNING_MAX_CHARS);

const SYSTEM = `Você lê UMA mensagem que a equipe de um imóvel de temporada acabou de enviar ao hóspede e decide se ela ensina um FATO DURADOURO sobre o imóvel.

Regras:
- Só o que a MENSAGEM DA EQUIPE afirma conta. A conversa anterior é só contexto.
- Fato bom: onde fica algo, como usar um aparelho, regra da casa, como funciona o acesso, algo da vizinhança. Ex.: o Wi-Fi da varanda depende do repetidor da sala.
- temporalidade: "permanente" para instalação, infraestrutura ou regra geral; "estadia" para algo desta hospedagem (lâmpada queimada hoje, malas extras deste hóspede, horário combinado com ele).
- escopo: "imovel" (só este imóvel), "cidade" (vale para a cidade: coleta de lixo, voltagem, feriado local) ou "conta" (diretriz da empresa para todos os imóveis).
- NUNCA: senhas, códigos de porta, portão, cofre ou Wi-Fi (trechos marcados como removidos são segredos: ignore), datas, valores, telefones, nomes de pessoas, preferências de um hóspede.
- Frase objetiva, impessoal, em português, entre 15 e 300 caracteres. No máximo ${TEAM_LEARNING_MAX_FACTS} fatos. Saudação, agradecimento ou combinado pontual: lista vazia (é o mais comum).
- Categoria (exatamente uma): ${LEARNING_CATEGORIES.join(", ")}.

Responda estritamente em JSON: {"fatos":[{"categoria":"...","fato":"...","temporalidade":"permanente","escopo":"imovel"}]}`;

export function buildTeamLearningPrompt(teamMessage: string, context: readonly TeamContextMessage[]): LlmMessage[] | null {
  const msg = clean(teamMessage ?? "");
  if (msg.length < 15) return null;
  const ctx = context
    .slice(-TEAM_LEARNING_CONTEXT_MESSAGES)
    .filter((m) => m.text?.trim())
    .map((m) => `(${LABEL[m.speaker]}): ${clean(m.text)}`);
  const user = `${ctx.length ? `<contexto>\n${ctx.join("\n")}\n</contexto>\n\n` : ""}<mensagem_da_equipe>\n${msg}\n</mensagem_da_equipe>\n\nResponda estritamente em formato JSON.`;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

export interface TeamFact {
  category: LearningCategory;
  statement: string;
  scope: LearningScope;
}

const SCOPE: Record<string, LearningScope> = { imovel: "property", cidade: "city", conta: "account" };

/** Só fatos permanentes, categoria válida; escopo desconhecido ⇒ só o imóvel (o mais restrito). */
export function parseTeamLearningOutput(json: unknown): { facts: TeamFact[]; ephemeral: number; dropped: number } {
  const list = json && typeof json === "object" ? (json as Record<string, unknown>)["fatos"] : null;
  if (!Array.isArray(list)) return { facts: [], ephemeral: 0, dropped: json == null ? 0 : 1 };
  const facts: TeamFact[] = [];
  let ephemeral = 0;
  let dropped = 0;
  for (const raw of list.slice(0, TEAM_LEARNING_MAX_FACTS)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (typeof r["fato"] !== "string" || !(LEARNING_CATEGORIES as readonly unknown[]).includes(r["categoria"])) {
      dropped += 1;
      continue;
    }
    if (r["temporalidade"] !== "permanente") {
      ephemeral += 1; // memória da estadia: não vira regra do imóvel
      continue;
    }
    facts.push({
      category: r["categoria"] as LearningCategory,
      statement: r["fato"],
      scope: SCOPE[String(r["escopo"])] ?? "property",
    });
  }
  return { facts, ephemeral, dropped };
}
