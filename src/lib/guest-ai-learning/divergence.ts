/**
 * DIVERGÊNCIAS COM O DOSSIÊ (10/11/2026) — PURO.
 *
 * Para cada aprendizado ATIVO do Documento Vivo, procura no dossiê do mesmo imóvel (playbook, manual, FAQ) um
 * trecho que fale do MESMO objeto (os termos do tema: "ferro passar", "wi-fi varanda"). Achou ⇒ possível
 * divergência: o painel mostra lado a lado o que o cadastro diz e o que a IA está respondendo agora. É
 * sobreposição de assunto, não prova de contradição: a equipe decide (manter ou reverter ao dossiê).
 * Trechos passam pelo varredor de segredos antes de qualquer exibição; campos de credencial nunca entram.
 */
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { learningThemeKey } from "@/lib/guest-ai/learning/learning";

export interface DossierPassage {
  propertyId: string;
  /** de onde veio (ex.: "Manual · Lavanderia", "FAQ", "Playbook · Wi-Fi") */
  label: string;
  text: string;
}

export interface LivingEntryLite {
  id: string;
  propertyId: string;
  category: string;
  statement: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface Divergence {
  entryId: string;
  propertyId: string;
  dossierLabel: string;
  dossierExcerpt: string;
  livingStatement: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

/** Campos do playbook que guardam credenciais ou acesso: nunca entram na comparação nem no painel. */
export const CREDENTIAL_FIELD = /(senha|password|wifi_pass|pin|codigo|code|cofre|safe|lockbox|fechadura|lock|portao|gate|chave|key)/i;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const EXCERPT_MAX = 220;

function excerpt(text: string, term: string): string {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?;])\s+/);
  const hit = sentences.find((s) => fold(s).includes(term)) ?? sentences[0] ?? "";
  const clean = SECRET_SCRUBBER.scan(hit.trim()).text;
  return clean.length > EXCERPT_MAX ? `${clean.slice(0, EXCERPT_MAX - 1)}…` : clean;
}

export function findDossierDivergences(
  entries: readonly LivingEntryLite[],
  passages: readonly DossierPassage[],
  max = 50,
): Divergence[] {
  const out: Divergence[] = [];
  for (const e of entries) {
    const terms = learningThemeKey(e.category, e.statement).split("::")[1]?.split(" ").filter(Boolean) ?? [];
    if (terms.length === 0) continue;
    const p = passages.find((x) => {
      if (x.propertyId !== e.propertyId) return false;
      const t = fold(x.text);
      return terms.every((w) => t.includes(w));
    });
    if (!p) continue;
    // o próprio fato já está no dossiê com as mesmas palavras ⇒ não é divergência
    if (fold(p.text).includes(fold(e.statement).replace(/[.!?]+$/, ""))) continue;
    out.push({
      entryId: e.id,
      propertyId: e.propertyId,
      dossierLabel: p.label,
      dossierExcerpt: excerpt(p.text, terms[0]!),
      livingStatement: e.statement,
      decidedAt: e.decidedAt,
      decidedBy: e.decidedBy,
    });
    if (out.length >= max) break;
  }
  return out;
}
