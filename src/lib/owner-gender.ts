/**
 * Rótulo do proprietário: sempre "Pr:" (padrão global, 04/11/2026). A
 * inferência de gênero pelo primeiro nome ("Proprietário"/"Proprietária") foi
 * removida junto com os rótulos por extenso.
 */

/** Prefixo padrão da linha do proprietário: "Pr:" (null sem nome); o nome vem depois, no `OwnerLine`. */
export function ownerPropertyLabel(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  return "Pr:";
}

/** "Pr: Arthur T. Fuchshuber" — nome inteiro (usado nos pushes). */
export function ownerRoleLabel(name: string | null | undefined): string | null {
  const full = (name ?? "").trim();
  if (!full) return null;
  return `Pr: ${full}`;
}
