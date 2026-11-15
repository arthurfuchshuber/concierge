/**
 * CHAMADO DE OCORRÊNCIA — contratos puros (15/11/2026). Sem banco, rede ou relógio.
 *
 * Uma ocorrência é uma situação NEGATIVA apontada pelo hóspede que pede acompanhamento humano. Ela não silencia a
 * conversa: a IA segue atendendo os demais assuntos e só não promete nem resolve o assunto do chamado. Quem decide
 * abrir, reabrir ou fechar é o modelo, lendo a conversa central (WhatsApp + plataforma + guia); o código só valida a
 * forma da decisão e aplica as travas (grave só fecha por palavra da equipe, limite de chamados, sem duplicar).
 */
import type { LlmMessage } from "@/lib/guest-ai/llm/contracts";

export const INCIDENT_SEVERITIES = ["normal", "grave"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export const INCIDENT_MAX_OPEN_PER_CONVERSATION = 5;
export const INCIDENT_RECENT_RESOLVED_HOURS = 24;

export interface IncidentView {
  id: string;
  summary: string;
  severity: IncidentSeverity;
  category: string | null;
  status: "open" | "resolved";
}

export interface CentralMessage {
  speaker: "guest" | "team" | "ai";
  channel: string;
  at: string;
  text: string;
}

export type DetectorTrigger = "guest" | "team";

export type DetectorAction =
  | { action: "none" }
  | { action: "open"; summary: string; severity: IncidentSeverity; category: string | null }
  | { action: "resolve"; incidentId: string; reason: string }
  | { action: "reopen"; incidentId: string; reason: string };

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Lê a saída do modelo com forma fechada; qualquer desvio ⇒ `none` (nunca abre nem fecha por engano). */
export function parseDetectorOutput(
  text: string,
  known: { open: readonly string[]; resolved: readonly string[] },
): DetectorAction {
  const NONE: DetectorAction = { action: "none" };
  let o: unknown;
  try {
    const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    o = JSON.parse(raw);
  } catch {
    return NONE;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return NONE;
  const r = o as Record<string, unknown>;
  switch (r["action"]) {
    case "open": {
      const summary = clip(r["summary"], 300);
      if (!summary) return NONE;
      const severity = (INCIDENT_SEVERITIES as readonly string[]).includes(String(r["severity"]))
        ? (r["severity"] as IncidentSeverity)
        : "normal";
      const category = clip(r["category"], 40).toLowerCase() || null;
      return { action: "open", summary, severity, category };
    }
    case "resolve": {
      const incidentId = clip(r["incidentId"], 80);
      return known.open.includes(incidentId) ? { action: "resolve", incidentId, reason: clip(r["reason"], 300) } : NONE;
    }
    case "reopen": {
      const incidentId = clip(r["incidentId"], 80);
      return known.resolved.includes(incidentId) ? { action: "reopen", incidentId, reason: clip(r["reason"], 300) } : NONE;
    }
    default:
      return NONE;
  }
}

const SYSTEM = [
  "Você acompanha a conversa central de um hóspede com a equipe de uma hospedagem (WhatsApp, plataforma e guia digital juntos, em ordem cronológica) e decide, com bom senso, se há um chamado de ocorrência a abrir, reabrir ou fechar.",
  "",
  "Ocorrência é uma situação NEGATIVA apontada pelo hóspede que exige acompanhamento de uma pessoa: defeito ou falta de algo, sujeira, barulho, problema de acesso, cobrança, atendimento ruim, insatisfação com a estadia. Não são ocorrência: dúvida, pedido de informação, elogio, agradecimento, conversa social, e pedido de exceção como saída tardia ou entrada antecipada (esses têm fluxo próprio).",
  "Gravidade grave: risco à segurança ou à saúde (vazamento, gás, choque, incêndio, fumaça), hóspede sem conseguir entrar na chegada, cobrança indevida, discriminação, ameaça de avaliação negativa, de cancelamento ou de acionar a plataforma. As demais são normal.",
  "",
  "Ações possíveis, UMA por vez:",
  "open: o hóspede acabou de apontar uma ocorrência que ainda não tem chamado aberto sobre o mesmo assunto. Se já existe chamado aberto sobre o mesmo assunto, responda none.",
  "resolve: a conversa mostra que o assunto de um chamado aberto foi resolvido: a equipe disse que resolveu ou consertou, ou o hóspede confirmou que está resolvido ou ok. Promessa de providência futura, silêncio ou mudança de assunto NÃO resolvem.",
  "reopen: o hóspede voltou a reclamar do mesmo assunto de um chamado resolvido recentemente.",
  "none: em qualquer outro caso (é o caso mais comum).",
  "",
  'Responda SOMENTE com JSON: {"action":"none|open|resolve|reopen","incidentId":"id do chamado (resolve e reopen)","summary":"o assunto em uma frase objetiva e sem dados pessoais (open)","severity":"normal|grave (open)","category":"uma ou duas palavras, ex.: limpeza, ar-condicionado, acesso (open)","reason":"a fala da conversa que justifica (resolve e reopen)"}',
].join("\n");

const fmt = (m: CentralMessage) =>
  `[${m.at.slice(0, 16).replace("T", " ")} · ${m.channel} · ${m.speaker === "guest" ? "HÓSPEDE" : m.speaker === "team" ? "EQUIPE" : "IA"}] ${m.text.replace(/\s+/g, " ").slice(0, 600)}`;

export function buildDetectorMessages(i: {
  trigger: DetectorTrigger;
  messages: readonly CentralMessage[];
  open: readonly IncidentView[];
  recentlyResolved: readonly IncidentView[];
}): LlmMessage[] {
  const list = (xs: readonly IncidentView[]) =>
    xs.length ? xs.map((x) => `- id ${x.id} · ${x.severity} · ${x.summary}`).join("\n") : "(nenhum)";
  const user = [
    `Quem acabou de falar: ${i.trigger === "guest" ? "o HÓSPEDE" : "a EQUIPE"}.`,
    "",
    "Chamados abertos:",
    list(i.open),
    "",
    "Chamados resolvidos nas últimas 24 h:",
    list(i.recentlyResolved),
    "",
    "Conversa (mais antiga primeiro):",
    ...i.messages.map(fmt),
  ].join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

/** Regras do código sobre a decisão do modelo (o modelo não as pode contornar). */
export function incidentGate(
  a: DetectorAction,
  ctx: { trigger: DetectorTrigger; open: readonly IncidentView[] },
): { allowed: boolean; resolvedBy?: "ai" | "human"; reason?: string } {
  if (a.action === "none") return { allowed: false, reason: "none" };
  if (a.action === "open") {
    if (ctx.open.length >= INCIDENT_MAX_OPEN_PER_CONVERSATION) return { allowed: false, reason: "limit" };
    return { allowed: true };
  }
  if (a.action === "reopen") return ctx.trigger === "guest" ? { allowed: true } : { allowed: false, reason: "reopen_needs_guest" };
  const inc = ctx.open.find((x) => x.id === a.incidentId);
  if (!inc) return { allowed: false, reason: "unknown_incident" };
  // grave: só se encerra por palavra da EQUIPE (uma pessoa); a IA sozinha, pela fala do hóspede, não fecha.
  if (inc.severity === "grave") return ctx.trigger === "team" ? { allowed: true, resolvedBy: "human" } : { allowed: false, reason: "grave_needs_human" };
  return { allowed: true, resolvedBy: ctx.trigger === "team" ? "human" : "ai" };
}
