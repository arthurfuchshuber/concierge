/**
 * Projeção do Dossiê por audiência (PURA). Recebe as linhas já montadas pelo
 * construtor do Playbook (`buildPlaybook`, a mesma regra de audiência do Dossiê
 * aprovado) e devolve só o que o interlocutor pode ver.
 *
 * Nunca entram: linhas secretas, chaves de credencial (`CREDENTIAL_ROW_KEYS`),
 * linhas vazias, audiência `I` e qualquer audiência não concedida. A NOTA do
 * anfitrião herda a audiência da linha.
 */
import type { DossierItem, DossierKnowledge, GuestAudience } from "@/lib/guest-ai/types";
import { CREDENTIAL_ROW_KEYS } from "./projections";

/** Subconjunto estrutural de `PlaybookRow` (evita acoplar o teste ao módulo da UI). */
export interface DossierRowLike {
  id: string;
  label: string;
  value: string;
  raw: string;
  empty: boolean;
  secret: boolean;
  au: GuestAudience;
  note: string;
}

function isCredentialRow(id: string): boolean {
  return id.startsWith("f:") && CREDENTIAL_ROW_KEYS.has(id.slice(2));
}

export function projectDossier(
  rows: DossierRowLike[],
  audiences: ReadonlySet<GuestAudience>,
  manuals: Array<{ title: string; body: string }> = [],
): DossierKnowledge {
  const items: DossierItem[] = [];
  let withheld = 0;
  for (const r of rows) {
    if (r.empty) continue;
    if (r.secret || isCredentialRow(r.id) || r.au === "I" || !audiences.has(r.au)) {
      withheld += 1;
      continue;
    }
    items.push({
      id: r.id,
      label: r.label,
      // `raw` é o texto sem máscara; linhas secretas nunca chegam aqui.
      value: r.raw,
      audience: r.au,
      note: r.note.trim() ? r.note.trim() : null,
    });
  }
  // Manuais de equipamentos pertencem à audiência G (catálogo do Dossiê: "manuais_de_equipamentos" = G).
  const manualsOut = audiences.has("G") ? manuals.filter((m) => m.title.trim() || m.body.trim()) : [];
  if (!audiences.has("G") && manuals.length > 0) withheld += manuals.length;
  return { items, manuals: manualsOut, withheldByPolicy: withheld };
}
