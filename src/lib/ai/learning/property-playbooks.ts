/**
 * CÉREBRO CONTÍNUO — playbooks POR IMÓVEL (17/10/2026, decisão do anfitrião).
 *
 * A IA aprende com o que a equipe faz no chat de cada imóvel (respostas,
 * mensagens da IA apagadas ou editadas) e mantém, para CADA imóvel, roteiros
 * que se refinam a cada novo aprendizado. Quanto mais ela resolve sozinha,
 * menos transfere para um humano.
 *
 * Este arquivo é puro (sem banco/modelo): tipos, casamento com a conversa,
 * filtro de sensibilidade e texto injetado no prompt.
 */
export type PropertyPlaybook = {
  id: string;
  topic: string;
  title: string;
  triggers: string[];
  situation: string | null;
  steps: string[];
  avoid: string[];
  version: number;
  status: "active" | "draft" | "retired";
};

export const normPb = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export function slugTopic(s: string): string {
  return normPb(s).replace(/\s+/g, "-").slice(0, 60) || "geral";
}

/** Conteúdo que NUNCA entra automaticamente num playbook ativo (vai para rascunho). */
const SENSITIVE =
  /\b(senha|codigo de acesso|pin|cartao|cpf|rg|passaporte|pix|reembolso|estorno|desconto|cortesia gratis|r\$\s?\d|\d+\s?reais|multa|processo|advogad)/;

export function isSensitiveText(text: string): boolean {
  return SENSITIVE.test(normPb(text));
}

/** Playbooks ativos cujo gatilho aparece na mensagem atual ou nas últimas do hóspede. */
export function matchPropertyPlaybooks(
  playbooks: PropertyPlaybook[],
  message: string,
  recentGuest: string[] = [],
  max = 2,
): PropertyPlaybook[] {
  const hay = ` ${normPb([message, ...recentGuest.slice(-3)].join(" "))} `;
  const msgOnly = ` ${normPb(message)} `;
  return playbooks
    .filter((p) => p.status === "active" && p.steps.length > 0)
    .map((p) => {
      let score = 0;
      for (const t of p.triggers) {
        const n = normPb(t);
        if (n.length < 3) continue;
        if (msgOnly.includes(` ${n} `) || msgOnly.includes(n)) score += 2;
        else if (hay.includes(n)) score += 1;
      }
      return { p, score };
    })
    .filter((x) => x.score >= 2 || (x.score >= 1 && x.p.triggers.length <= 2))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.p);
}

export function propertyPlaybookText(pbs: PropertyPlaybook[]): string {
  if (!pbs.length) return "";
  const blocks = pbs.map((p) => {
    const L = [`• ${p.title}${p.situation ? ` — ${p.situation}` : ""}`];
    p.steps.forEach((s, i) => L.push(`  ${i + 1}. ${s}`));
    if (p.avoid.length) L.push(`  Evite: ${p.avoid.join("; ")}`);
    return L.join("\n");
  });
  return (
    "\n\nPLAYBOOKS APRENDIDOS DESTE IMÓVEL (a equipe já resolveu isto antes, aqui; siga o roteiro com suas palavras, " +
    "resolva você mesma e só acione a equipe se algo fugir do roteiro; as fontes oficiais do imóvel continuam prevalecendo)\n" +
    blocks.join("\n")
  );
}

/** Quanto do que o modelo devolveu é aproveitável como playbook. */
export type PlaybookDraft = {
  shouldLearn: boolean;
  /** A IA entendeu O QUE estava errado/por que a equipe agiu assim? */
  canExplain: boolean;
  topic: string;
  title: string;
  triggers: string[];
  situation: string | null;
  steps: string[];
  avoid: string[];
  whatWasWrong: string | null;
  risk: "low" | "sensitive";
  confidence: number;
};

const arr = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, len))
    : [];

export function sanitizeDraft(raw: Partial<PlaybookDraft> | null): PlaybookDraft | null {
  if (!raw || !raw.shouldLearn) return null;
  const steps = arr(raw.steps, 8, 300);
  const title = String(raw.title ?? "").trim().slice(0, 120);
  if (!title || steps.length === 0) return null;
  const conf = Math.max(0, Math.min(1, Number(raw.confidence ?? 0.6)));
  const all = [title, raw.situation ?? "", ...steps, ...arr(raw.avoid, 6, 200)].join(" ");
  return {
    shouldLearn: true,
    canExplain: raw.canExplain !== false,
    topic: slugTopic(String(raw.topic || title)),
    title,
    triggers: arr(raw.triggers, 10, 60),
    situation: raw.situation ? String(raw.situation).trim().slice(0, 240) : null,
    steps,
    avoid: arr(raw.avoid, 6, 200),
    whatWasWrong: raw.whatWasWrong ? String(raw.whatWasWrong).trim().slice(0, 400) : null,
    risk: raw.risk === "sensitive" || isSensitiveText(all) ? "sensitive" : "low",
    confidence: conf,
  };
}

/** Auto-ativa só o que é de baixo risco e com confiança suficiente. */
export function playbookStatusFor(d: PlaybookDraft): "active" | "draft" {
  return d.risk === "low" && d.confidence >= 0.6 ? "active" : "draft";
}

/** Texto da pergunta ao anfitrião quando a IA não entendeu o que errou. */
export function correctionQuestion(p: {
  kind: "deleted" | "edited";
  aiContent: string;
  replacement: string | null;
}): string {
  const verb = p.kind === "deleted" ? "apagou" : "editou";
  const rep = p.replacement
    ? ` e em seguida enviou: «${p.replacement.slice(0, 280)}»`
    : " e não enviou outra mensagem";
  return (
    `Correção da equipe: você ${verb} esta resposta minha: «${p.aiContent.slice(0, 380)}»${rep}. ` +
    "O que eu fiz de errado e como eu deveria ter respondido?"
  );
}
