/**
 * MEMÓRIA DO HÓSPEDE · processo pós-checkout — contratos e validação PURA da saída do modelo.
 *
 * Duas partes que NUNCA se misturam:
 *  - HOSPITALIDADE (`behavioral_notes`): fatos de hospitalidade e orientações operacionais neutras e cordiais.
 *    É a única parte que a IA de atendimento recebe.
 *  - AVALIAÇÃO INTERNA (`internal_assessment`): comunicação, regras e horários, cuidado com o imóvel e
 *    incidentes. Estritamente privada da equipe humana; a IA de atendimento jamais a recebe.
 * Regras de evidência: na estadia, todo item de hospitalidade e toda dimensão avaliada (≠ `sem_dados`)
 * precisa citar ids que EXISTEM no material enviado (`msg:N`, `fato:...`); sem evidência, sai.
 * Todo texto devolvido passa pelo guard de segredos; texto que não puder ser saneado com segurança sai.
 */
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";

export const GUEST_MEMORY_VERSION = "guest-memory.2026-11-06.1";

export const HOSPITALITY_CATEGORIES = [
  "preferencia",
  "rotina",
  "cuidado",
  "pedido_recorrente",
  "orientacao_operacional",
  "outro",
] as const;
export type HospitalityCategory = (typeof HOSPITALITY_CATEGORIES)[number];

export const ASSESSMENT_DIMENSIONS = [
  "comunicacao",
  "regras_e_horarios",
  "cuidado_com_o_imovel",
  "incidentes",
] as const;
export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];

export const ASSESSMENT_LEVELS = ["positivo", "neutro", "atencao", "sem_dados"] as const;
export type AssessmentLevel = (typeof ASSESSMENT_LEVELS)[number];

export interface HospitalityNote {
  categoria: HospitalityCategory;
  texto: string;
}
export interface StayHospitalityItem extends HospitalityNote {
  evidencias: string[];
}
export interface StayDimension {
  nivel: AssessmentLevel;
  resumo: string;
  evidencias: string[];
}
export interface ConsolidatedDimension {
  nivel: AssessmentLevel;
  resumo: string;
}

/** Resumo de UMA estadia (vai para `stay_summaries`, com as duas partes separadas). */
export interface StaySummary {
  versao: string;
  hospitalidade: StayHospitalityItem[];
  avaliacao: Record<AssessmentDimension, StayDimension>;
  fonte: "modelo" | "sem_conversa";
}

export interface StayMemoryResult {
  summary: StaySummary;
  /** Consolidado de hospitalidade (≤ 20) — o que a IA de atendimento recebe. */
  behavioralNotes: HospitalityNote[];
  /** Consolidado da avaliação — só equipe. */
  internalAssessment: Record<AssessmentDimension, ConsolidatedDimension> & { versao: string };
}

export const LIMITS = Object.freeze({
  notes: 20,
  noteChars: 280,
  stayItems: 20,
  dimensionChars: 400,
  consolidatedDimensionChars: 600,
  evidencePerItem: 10,
});

/**
 * Rede de segurança do ISOLAMENTO (conservadora). A hospitalidade não pode carregar julgamento, incidente,
 * dano, problema operacional, acusação, conflito, dado financeiro, credencial ou contato. O texto é
 * normalizado (sem acento, minúsculas) e comparado por FAMÍLIAS de radicais em português, inglês e espanhol
 * (paráfrases e flexões), além de números longos e valores. Qualquer acerto ⇒ a nota NÃO entra em
 * `behavioral_notes` (na dúvida, não registra).
 */
const RISK_FAMILIES: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "dano",
    /\b(dan[oi]\w*|danific\w*|estrag\w*|quebr\w*|rachad\w*|trinc\w*|amass\w*|risc(ou|ado|ada|aram)\b|manch\w*|rasg\w*|avari\w*|conserto\w*|reparo\w*|repar(ar|ou)\b|ressarc\w*|indeniz\w*|prejuiz\w*|perd(eu|ido|ida)\b|sumi(u|ram|do|da)\b|extravi\w*|damag\w*|broke\w*|broken|stain\w*|ruin\w*|da[nñ]ad\w*|romp\w*|rot[oa]s?\b)/,
  ],
  [
    "incidente",
    /\b(incident\w*|ocorrenci\w*|problem\w*|confus\w*|transtorn\w*|imprevist\w*|festa\w*|barulh\w*|ruido\w*|vizinh\w*|policia\w*|seguranca do condominio|sindic\w*|portaria reclam\w*|noise|party|complain\w*|issue\w*|trouble\w*|incidencia\w*)/,
  ],
  [
    "operacional",
    /\b(vazament\w*|infiltra\w*|goteira\w*|entupi\w*|sem (agua|luz|energia|internet)|falta de (agua|luz|energia)|queda de (energia|internet)|nao funcion\w*|parou de funcionar|defeit\w*|pane\w*|chuveiro frio|leak\w*|outage)/,
  ],
  [
    "acusacao",
    /\b(acus\w*|culp\w*|suspeit\w*|roub\w*|furt\w*|levou (o|a|os|as)\b|mentiu|mentira\w*|fraud\w*|golpe\w*|desonest\w*|steal\w*|stole\w*|thief|accus\w*|blame\w*)/,
  ],
  [
    "conflito",
    /\b(conflit\w*|desentend\w*|discuss(ao|oes|iu|ao)\b|brig\w*|hostil\w*|agressiv\w*|grosse\w*|rude\w*|mal[- ]?educad\w*|ofens\w*|ameac\w*|xing\w*|desrespeit\w*|insistent\w*|insistiu|exigent\w*|dificil|chat[oa]s?\b|reclamao|reclam\w*|irritad\w*|nervos[oa]\w*|abusiv\w*|argument\w*|angry|rude|hostile|threat\w*)/,
  ],
  [
    "avaliacao",
    /\b(avalia\w*|nota\b|recomend\w*|bloque\w*|evitar|cuidado com (ele|ela|este|esta|o hospede|a hospede)|nao aceitar|nao hospedar|lista negra|problemati\w*|advert\w*|penalid\w*|infrac\w*|infrin\w*|violou|descumpri\w*|sem avis\w*|nao avis\w*|atras(o|ou|ada|ado)\b|fora do horario|antes do horario|depois do horario|review\w*|rating\w*|blacklist\w*|warning\w*)/,
  ],
  [
    "financeiro",
    /(r\$|us\$|u\$s|€|\$\s?\d|\b\d+[.,]?\d*\s?(reais|real|dolares|dolar|euros?|usd|brl)\b|\b(pag(ou|ar|amento|o)\w*|cobr\w*|multa\w*|taxa\w*|tarifa\w*|caucao|deposito\w*|reembols\w*|estorn\w*|divida\w*|devendo|inadimpl\w*|desconto\w*|preco\w*|valor(es)?\b|cartao\w*|pix\b|boleto\w*|fatura\w*|gorjeta\w*|dinheiro|refund\w*|charge\w*|fee\b|fees\b|paid|payment\w*|discount\w*|price\w*))/,
  ],
  [
    "credencial",
    /\b(senha\w*|codigo\w*|pin\b|password\w*|passcode\w*|chave(s)? (da|do|de) (porta|portao|cofre|caixa)|cofre\w*|lockbox|token\w*|contrasena\w*|clave\w*)/,
  ],
  [
    "contato",
    /(@|https?:\/\/|www\.|\b(telefone|celular|whats\s?app|e-?mail|cpf|rg|passaporte|documento|endereco)\b)/,
  ],
  ["numero_longo", /\d[\d\s.-]{3,}\d/],
];

function normalizeForRisk(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Família de risco encontrada no texto (ou `null`). Usada para barrar a hospitalidade. */
export function hospitalityRisk(text: string): string | null {
  const t = normalizeForRisk(text);
  for (const [name, re] of RISK_FAMILIES) if (re.test(t)) return name;
  return null;
}

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Texto saneado pelo guard; `null` quando não dá para sanear com segurança. */
export function scrubText(text: string): string | null {
  if (!text) return null;
  try {
    const r = SECRET_SCRUBBER.scan(text);
    if (r.status === "safe") return text;
    if (r.status === "sanitized") return r.text;
    return null;
  } catch {
    return null;
  }
}

const evidence = (v: unknown, refs: ReadonlySet<string>): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && refs.has(x)))].slice(
        0,
        LIMITS.evidencePerItem,
      )
    : [];

const category = (v: unknown): HospitalityCategory =>
  (HOSPITALITY_CATEGORIES as readonly unknown[]).includes(v) ? (v as HospitalityCategory) : "outro";
const level = (v: unknown): AssessmentLevel =>
  (ASSESSMENT_LEVELS as readonly unknown[]).includes(v) ? (v as AssessmentLevel) : "sem_dados";

export const emptyStayAssessment = (): Record<AssessmentDimension, StayDimension> =>
  Object.fromEntries(
    ASSESSMENT_DIMENSIONS.map((d) => [
      d,
      { nivel: "sem_dados", resumo: "", evidencias: [] as string[] },
    ]),
  ) as unknown as Record<AssessmentDimension, StayDimension>;
export const emptyConsolidated = (): Record<AssessmentDimension, ConsolidatedDimension> =>
  Object.fromEntries(
    ASSESSMENT_DIMENSIONS.map((d) => [d, { nivel: "sem_dados", resumo: "" }]),
  ) as unknown as Record<AssessmentDimension, ConsolidatedDimension>;

/** Notas de hospitalidade seguras: categoria válida, tamanho, guard de segredos e SEM conteúdo de avaliação. */
export function sanitizeHospitalityNotes(raw: unknown): HospitalityNote[] {
  if (!Array.isArray(raw)) return [];
  const out: HospitalityNote[] = [];
  for (const n of raw) {
    if (out.length >= LIMITS.notes) break;
    const o = n && typeof n === "object" ? (n as Record<string, unknown>) : null;
    const text = scrubText(str(o?.["texto"], LIMITS.noteChars));
    if (!text || hospitalityRisk(text)) continue;
    out.push({ categoria: category(o?.["categoria"]), texto: text });
  }
  return out;
}

export class StayMemoryOutputError extends Error {
  constructor(readonly code: "not_object" | "missing_sections") {
    super(code);
    this.name = "StayMemoryOutputError";
  }
}

/**
 * Valida a saída do modelo contra os ids realmente enviados. Lança `StayMemoryOutputError` se a estrutura
 * principal não existir; itens inválidos são descartados (nunca "corrigidos" com invenção).
 */
export function validateStayMemoryOutput(
  raw: unknown,
  refs: ReadonlySet<string>,
): StayMemoryResult {
  const root =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!root) throw new StayMemoryOutputError("not_object");
  const stay =
    root["estadia"] && typeof root["estadia"] === "object"
      ? (root["estadia"] as Record<string, unknown>)
      : null;
  const cons =
    root["consolidado"] && typeof root["consolidado"] === "object"
      ? (root["consolidado"] as Record<string, unknown>)
      : null;
  if (!stay || !cons) throw new StayMemoryOutputError("missing_sections");

  // estadia: hospitalidade com evidência
  const hospitalidade: StayHospitalityItem[] = [];
  for (const item of Array.isArray(stay["hospitalidade"]) ? stay["hospitalidade"] : []) {
    if (hospitalidade.length >= LIMITS.stayItems) break;
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const ev = evidence(o?.["evidencias"], refs);
    const text = scrubText(str(o?.["texto"], LIMITS.noteChars));
    if (!text || ev.length === 0 || hospitalityRisk(text)) continue;
    hospitalidade.push({ categoria: category(o?.["categoria"]), texto: text, evidencias: ev });
  }

  // estadia: avaliação por dimensão, com evidência obrigatória
  const avaliacao = emptyStayAssessment();
  const av =
    stay["avaliacao"] && typeof stay["avaliacao"] === "object"
      ? (stay["avaliacao"] as Record<string, unknown>)
      : {};
  for (const d of ASSESSMENT_DIMENSIONS) {
    const o = av[d] && typeof av[d] === "object" ? (av[d] as Record<string, unknown>) : null;
    const nivel = level(o?.["nivel"]);
    const ev = evidence(o?.["evidencias"], refs);
    const resumo = scrubText(str(o?.["resumo"], LIMITS.dimensionChars)) ?? "";
    avaliacao[d] =
      nivel === "sem_dados" || ev.length === 0 || !resumo
        ? { nivel: "sem_dados", resumo: "", evidencias: [] }
        : { nivel, resumo, evidencias: ev };
  }

  // consolidado
  const behavioralNotes = sanitizeHospitalityNotes(cons["notas_de_hospitalidade"]);
  const internal = emptyConsolidated();
  const ca =
    cons["avaliacao_interna"] && typeof cons["avaliacao_interna"] === "object"
      ? (cons["avaliacao_interna"] as Record<string, unknown>)
      : {};
  for (const d of ASSESSMENT_DIMENSIONS) {
    const o = ca[d] && typeof ca[d] === "object" ? (ca[d] as Record<string, unknown>) : null;
    const nivel = level(o?.["nivel"]);
    const resumo = scrubText(str(o?.["resumo"], LIMITS.consolidatedDimensionChars)) ?? "";
    internal[d] =
      nivel === "sem_dados" || !resumo ? { nivel: "sem_dados", resumo: "" } : { nivel, resumo };
  }

  return {
    summary: { versao: GUEST_MEMORY_VERSION, hospitalidade, avaliacao, fonte: "modelo" },
    behavioralNotes,
    internalAssessment: { ...internal, versao: GUEST_MEMORY_VERSION },
  };
}
