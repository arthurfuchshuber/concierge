/**
 * APRENDIZADO CONTÍNUO da IA Guest (Etapa 4, 08/11/2026) — núcleo PURO, sem banco nem rede.
 *
 * Regra do titular: a IA pode SUGERIR o que aprender, mas só autorização humana explícita torna um
 * aprendizado permanente. Fluxo: CANDIDATO → REVISÃO HUMANA → DOCUMENTO VIVO (transparente e auditável).
 *
 * Este módulo define o contrato e as travas; a persistência depende das tabelas propostas ao titular no
 * chat em 08/11/2026 (`guest_ai_learning_entries`/`_events`, NÃO aplicadas). Até a aprovação do titular,
 * nada aqui é chamado pelo Copiloto, pelo slot ou por cron — e nada entra no prompt.
 *
 * Travas de candidatura (`evaluateCandidate`):
 *  - ORIGEM: só fato ENCERRADO — checkout feito, incidente resolvido ou confirmação expressa do hóspede de
 *    que algo funcionou. Conversa em aberto, previsão, pedido ou suposição nunca viram candidato;
 *  - ISOLAMENTO: um imóvel por candidato; a evidência precisa ser do mesmo imóvel (nunca de outro);
 *  - DURADOURO, NUNCA PONTUAL: recusa frases com data, horário, valor, nome de pessoa, código de reserva,
 *    telefone ou referência à estadia específica ("hoje", "ontem", "este hóspede");
 *  - SEM SEGREDO: qualquer senha/código detectado pelo varredor de segredos ⇒ recusa (D9 nunca aprende);
 *  - tamanho limitado e categoria fechada.
 * Revisão (`reviewCandidate`): só pessoa com permissão `ai_train` aprova; recusa e revogação ficam no
 * histórico. O Documento Vivo (`renderLivingDocument`) só mostra entradas APROVADAS e ativas, com autor,
 * data e evidência de origem.
 */
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";

export const LEARNING_SOURCES = ["checkout_done", "incident_resolved", "guest_confirmation"] as const;
export type LearningSource = (typeof LEARNING_SOURCES)[number];

export const LEARNING_CATEGORIES = [
  "acesso_e_chegada",
  "equipamentos",
  "manutencao",
  "regras_da_casa",
  "vizinhanca",
  "duvidas_frequentes",
] as const;
export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

export const LEARNING_STATEMENT_MAX = 400;
export const LEARNING_STATEMENT_MIN = 15;

export interface LearningEvidence {
  source: LearningSource;
  /** Imóvel do fato encerrado (derivado do turno validado, nunca do modelo). */
  propertyId: string;
  /** Mensagens/ações que comprovam o encerramento (ids opacos). */
  refs: readonly string[];
  /** O fato está encerrado? (checkout com done, incidente marcado resolvido, confirmação do hóspede). */
  closed: boolean;
}

export interface LearningCandidateInput {
  propertyId: string;
  category: string;
  /** Frase do aprendizado, como entraria no Documento Vivo. */
  statement: string;
  evidence: LearningEvidence;
}

export type CandidateRefusal =
  | "source_not_allowed"
  | "fact_not_closed"
  | "no_evidence"
  | "cross_property"
  | "category_invalid"
  | "statement_length"
  | "one_off_fact"
  | "contains_secret";

export type CandidateEvaluation =
  | { ok: true; candidate: Readonly<LearningCandidateInput & { category: LearningCategory; statement: string }> }
  | { ok: false; code: CandidateRefusal };

/** Marcas de fato PONTUAL (da estadia, não do imóvel). */
const ONE_OFF: readonly RegExp[] = [
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/, // datas 08/11, 08/11/2026
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}\s*(h|:)\s*\d{0,2}\b/i, // horários 14h, 14:30
  /r\$\s*\d|\b\d+\s*(reais|usd|d[óo]lares)\b/i, // valores
  /\+?\d[\d\s().-]{7,}\d/, // telefone
  /\b[A-Z0-9]{8,12}\b/, // código de reserva (HMXXXXXXXX)
  /\b(hoje|ontem|amanh[ãa]|agora h[áa] pouco|nesta (estadia|reserva|semana)|este h[óo]spede|esse h[óo]spede|a h[óo]spede)\b/i,
  /\b(?:[Ss]ra?|[Ss]enhora?|[Dd]ona|[Ss]eu)\.?\s+[A-ZÁÉÍÓÚ][a-zà-ú]+/, // tratamento + nome
];

export function isOneOff(statement: string): boolean {
  return ONE_OFF.some((r) => r.test(statement));
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function evaluateCandidate(input: LearningCandidateInput): CandidateEvaluation {
  const ev = input.evidence;
  if (!(LEARNING_SOURCES as readonly string[]).includes(ev.source)) return { ok: false, code: "source_not_allowed" };
  if (!ev.closed) return { ok: false, code: "fact_not_closed" };
  if (ev.refs.length === 0) return { ok: false, code: "no_evidence" };
  if (!input.propertyId || ev.propertyId !== input.propertyId) return { ok: false, code: "cross_property" };
  if (!(LEARNING_CATEGORIES as readonly string[]).includes(input.category)) return { ok: false, code: "category_invalid" };
  const statement = norm(input.statement);
  if (statement.length < LEARNING_STATEMENT_MIN || statement.length > LEARNING_STATEMENT_MAX)
    return { ok: false, code: "statement_length" };
  if (SECRET_SCRUBBER.scan(statement).status !== "safe") return { ok: false, code: "contains_secret" };
  if (isOneOff(statement)) return { ok: false, code: "one_off_fact" };
  return {
    ok: true,
    candidate: Object.freeze({ ...input, category: input.category as LearningCategory, statement }),
  };
}

// ─────────────── revisão humana ───────────────

export type LearningStatus = "pending" | "approved" | "rejected" | "revoked";

export interface LearningEntry {
  id: string;
  propertyId: string;
  category: LearningCategory;
  statement: string;
  source: LearningSource;
  evidenceRefs: readonly string[];
  status: LearningStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Histórico auditável: cada decisão com autor e instante. */
  history: ReadonlyArray<{ status: LearningStatus; by: string | null; at: string; note: string | null }>;
}

export type ReviewAction = "approve" | "reject" | "revoke";
export type ReviewRefusal = "not_authorized" | "invalid_transition" | "no_reviewer";

/** pending → approved|rejected; approved → revoked. Nada volta a pending; revogado nunca reaparece sozinho. */
const NEXT: Record<LearningStatus, Partial<Record<ReviewAction, LearningStatus>>> = {
  pending: { approve: "approved", reject: "rejected" },
  approved: { revoke: "revoked" },
  rejected: {},
  revoked: {},
};

export function reviewCandidate(
  entry: LearningEntry,
  action: ReviewAction,
  reviewer: { userId: string | null; canTrain: boolean },
  at: string,
  note: string | null = null,
): { ok: true; entry: LearningEntry } | { ok: false; code: ReviewRefusal } {
  if (!reviewer.userId) return { ok: false, code: "no_reviewer" };
  if (!reviewer.canTrain) return { ok: false, code: "not_authorized" };
  const next = NEXT[entry.status][action];
  if (!next) return { ok: false, code: "invalid_transition" };
  return {
    ok: true,
    entry: {
      ...entry,
      status: next,
      decidedBy: reviewer.userId,
      decidedAt: at,
      history: [...entry.history, { status: next, by: reviewer.userId, at, note: note ? norm(note).slice(0, 300) : null }],
    },
  };
}

// ─────────────── Documento Vivo ───────────────

const CATEGORY_TITLE: Record<LearningCategory, string> = {
  acesso_e_chegada: "Acesso e chegada",
  equipamentos: "Equipamentos",
  manutencao: "Manutenção",
  regras_da_casa: "Regras da casa",
  vizinhanca: "Vizinhança",
  duvidas_frequentes: "Dúvidas frequentes",
};
const SOURCE_LABEL: Record<LearningSource, string> = {
  checkout_done: "estadia concluída",
  incident_resolved: "incidente resolvido",
  guest_confirmation: "confirmação do hóspede",
};

/**
 * Documento Vivo de UM imóvel: só entradas aprovadas e não revogadas daquele imóvel, por categoria, cada
 * uma com origem, quem aprovou e quando (transparência). Entradas de outro imóvel são ignoradas.
 */
export function renderLivingDocument(propertyId: string, entries: readonly LearningEntry[]): string {
  const mine = entries.filter((e) => e.propertyId === propertyId && e.status === "approved");
  if (mine.length === 0) return "";
  const out: string[] = [];
  for (const cat of LEARNING_CATEGORIES) {
    const list = mine.filter((e) => e.category === cat).sort((a, b) => (a.decidedAt ?? "").localeCompare(b.decidedAt ?? ""));
    if (list.length === 0) continue;
    out.push(`## ${CATEGORY_TITLE[cat]}`);
    for (const e of list)
      out.push(`- ${e.statement} (origem: ${SOURCE_LABEL[e.source]}; aprovado em ${(e.decidedAt ?? "").slice(0, 10)})`);
  }
  return out.join("\n");
}
