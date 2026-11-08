/**
 * VISÃO DE INCIDENTES — diagnóstico visual estruturado (Etapa 2 da IA Guest, 07/11/2026). Puro.
 *
 * Arquitetura (decisão do titular, 07/11/2026): as fotos do hóspede já vão ANEXADAS à mesma chamada
 * multimodal do Copiloto (`copilot/generator.server.ts`, `attachVision`). O diagnóstico é preenchido pelo
 * próprio modelo nessa chamada, no campo `visualDiagnosis` da decisão (contrato v6): nenhuma chamada
 * extra, nenhum custo ou espera a mais. Este módulo define o schema, o parse estrito e as redes de
 * segurança de comportamento:
 *  - `parseVisualDiagnosis`: valida o objeto (enums fechados, tetos de tamanho); inválido ⇒ recusa;
 *  - `reconcileVisualDiagnosis`: diagnóstico sem foto no turno é descartado (o modelo não pode
 *    "ver" o que não recebeu);
 *  - `stripRoboticAck`: remove do início da resposta a frase de recibo ("recebi sua foto"…), se o
 *    modelo escorregar, sem tocar no resto do texto;
 *  - `diagnosisNeedsTeam` / `diagnosisUrgency`: incidente que exige a equipe sempre vira
 *    encaminhamento, com urgência coerente com a gravidade.
 *
 * Privacidade: nada daqui é persistido nem registrado em log. O texto do diagnóstico não é exibido ao
 * hóspede (a resposta é o `reply`) e não chega ao armazenamento da sugestão; só sinais fechados
 * (encaminhamento e urgência) seguem adiante. Fotos nunca liberam credenciais: a política D9 é aplicada
 * pelo sistema, independentemente do que a imagem mostre.
 */

export const VISUAL_CATEGORIES = [
  "plumbing",
  "electrical",
  "appliance",
  "lock",
  "cleanliness",
  "other",
] as const;
export type VisualCategory = (typeof VISUAL_CATEGORIES)[number];
export const VISUAL_SEVERITIES = ["low", "medium", "high"] as const;
export type VisualSeverity = (typeof VISUAL_SEVERITIES)[number];

export interface VisualDiagnosis {
  hasIncident: boolean;
  category: VisualCategory;
  severity: VisualSeverity;
  detectedApplianceOrFixture: string | null;
  userFriendlyDiagnosis: string;
  suggestedAction: string;
  requiresStaffIntervention: boolean;
}

export const VISUAL_DIAGNOSIS_KEYS = [
  "hasIncident",
  "category",
  "severity",
  "detectedApplianceOrFixture",
  "userFriendlyDiagnosis",
  "suggestedAction",
  "requiresStaffIntervention",
] as const;

export const VISUAL_LIMITS = {
  fixtureMaxChars: 120,
  diagnosisMaxChars: 500,
  actionMaxChars: 500,
} as const;

/** Prazo da leitura das fotos do turno (carregar e preparar): passou disso, o turno segue só com texto. */
export const VISION_LOAD_TIMEOUT_MS = 8_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const inEnum = <T extends string>(v: unknown, values: readonly T[]): v is T =>
  typeof v === "string" && (values as readonly string[]).includes(v);
const text = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null;

/**
 * Parse ESTRITO do diagnóstico: `null` (sem foto) é válido; objeto precisa das chaves exatas, enums
 * fechados e textos dentro dos tetos. `undefined` ⇒ inválido (o chamador recusa a decisão).
 */
export function parseVisualDiagnosis(raw: unknown): VisualDiagnosis | null | undefined {
  if (raw === null) return null;
  if (!isObj(raw)) return undefined;
  const keys = Object.keys(raw);
  if (
    keys.length !== VISUAL_DIAGNOSIS_KEYS.length ||
    !VISUAL_DIAGNOSIS_KEYS.every((k) => keys.includes(k))
  )
    return undefined;
  if (
    typeof raw["hasIncident"] !== "boolean" ||
    typeof raw["requiresStaffIntervention"] !== "boolean"
  )
    return undefined;
  if (!inEnum(raw["category"], VISUAL_CATEGORIES) || !inEnum(raw["severity"], VISUAL_SEVERITIES))
    return undefined;
  const fixtureRaw = raw["detectedApplianceOrFixture"];
  const fixture = fixtureRaw === null ? null : text(fixtureRaw, VISUAL_LIMITS.fixtureMaxChars);
  if (fixtureRaw !== null && fixture === null) return undefined;
  const diagnosis = text(raw["userFriendlyDiagnosis"], VISUAL_LIMITS.diagnosisMaxChars);
  const action = text(raw["suggestedAction"], VISUAL_LIMITS.actionMaxChars);
  if (!diagnosis || !action) return undefined;
  return {
    hasIncident: raw["hasIncident"],
    category: raw["category"],
    severity: raw["severity"],
    detectedApplianceOrFixture: fixture,
    userFriendlyDiagnosis: diagnosis,
    suggestedAction: action,
    requiresStaffIntervention: raw["requiresStaffIntervention"],
  };
}

/** Diagnóstico só vale com foto do hóspede no turno; sem foto, é descartado. */
export function reconcileVisualDiagnosis(
  d: VisualDiagnosis | null | undefined,
  imagesSent: number,
): VisualDiagnosis | null {
  if (!d || imagesSent <= 0) return null;
  return d;
}

/** O incidente visto exige a equipe? (exigência declarada ou gravidade alta com incidente). */
export function diagnosisNeedsTeam(d: VisualDiagnosis | null | undefined): boolean {
  return !!d && (d.requiresStaffIntervention || (d.hasIncident && d.severity === "high"));
}

/** Urgência coerente com a gravidade (alta ⇒ high; média ⇒ normal; baixa ⇒ low). */
export function diagnosisUrgency(d: VisualDiagnosis): "low" | "normal" | "high" {
  return d.severity === "high" ? "high" : d.severity === "medium" ? "normal" : "low";
}

/**
 * Frases de RECIBO de anexo (recebi a foto, obrigado pela imagem, vi que você enviou um anexo…), em
 * português, inglês e espanhol. Rede de segurança: o prompt já proíbe; aqui só se remove a frase
 * inteira quando ela abre a resposta, e só se sobrar conteúdo.
 */
const ACK_SENTENCE = new RegExp(
  [
    String.raw`^(\s*(?:(?:ol[áa]|oi|hello|hi|hola)[^.!?\n]{0,40}[,!.]\s*)?)`,
    "(?:",
    String.raw`(?:recebi|recebemos|acabei de receber|j[áa] recebi)\s+(?:a\s+|sua\s+|as\s+|suas\s+)?(?:foto|fotos|imagem|imagens|anexo|anexos|v[íi]deo|arquivo)`,
    String.raw`|(?:obrigad[oa]|agrade[çc]o)\s+(?:pela|pelas|pelo|por)\s+(?:enviar\s+)?(?:a\s+|sua\s+)?(?:foto|fotos|imagem|imagens|anexo|v[íi]deo)`,
    String.raw`|(?:identifiquei|vi|notei)\s+que\s+(?:voc[êe]\s+)?(?:enviou|mandou)\s+(?:uma?\s+)?(?:foto|imagem|anexo|arquivo)`,
    String.raw`|(?:thanks?|thank you)\s+for\s+(?:sending\s+)?(?:the\s+|your\s+)?(?:photo|picture|image|pic)s?`,
    String.raw`|i\s+(?:have\s+)?(?:received|got)\s+(?:the\s+|your\s+)?(?:photo|picture|image)s?`,
    String.raw`|(?:recib[íi]|gracias por (?:la|tu|enviar la))\s+(?:la\s+|tu\s+)?(?:foto|imagen)`,
    ")",
    String.raw`[^.!?\n]*[.!?]*\s*`,
  ].join(""),
  "i",
);

export function containsRoboticAck(reply: string): boolean {
  return ACK_SENTENCE.test(reply);
}

export function stripRoboticAck(reply: string): string {
  const m = ACK_SENTENCE.exec(reply);
  if (!m) return reply;
  const rest = reply.slice(m[0].length).replace(/^\s+/, "");
  if (!rest) return reply; // sem conteúdo além do recibo: não mexe (o validador decide o resto)
  // a saudação que abria a frase (se houver) é preservada; só o recibo sai
  const greeting = (m[1] ?? "").trim();
  const body = rest.charAt(0).toUpperCase() + rest.slice(1);
  return greeting ? `${greeting} ${body}` : body;
}

/** Texto do formato, para o contrato da decisão (gerado das mesmas constantes do parser). */
const q = (xs: readonly string[]) => xs.map((x) => `"${x}"`).join("|");
export const VISUAL_DIAGNOSIS_SPEC = `"visualDiagnosis": null | {"hasIncident": boolean, "category": ${q(VISUAL_CATEGORIES)}, "severity": ${q(VISUAL_SEVERITIES)}, "detectedApplianceOrFixture": string|null (aparelho, peça ou instalação que aparece na foto, até ${VISUAL_LIMITS.fixtureMaxChars} caracteres), "userFriendlyDiagnosis": string (o que a foto mostra e a hipótese mais provável, até ${VISUAL_LIMITS.diagnosisMaxChars} caracteres), "suggestedAction": string (o que o hóspede pode fazer com segurança, até ${VISUAL_LIMITS.actionMaxChars} caracteres), "requiresStaffIntervention": boolean} (preencha só quando houver foto do hóspede anexada neste turno; sem foto, null)`;
