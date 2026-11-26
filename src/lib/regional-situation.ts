/**
 * SITUAÇÃO REGIONAL (mockups REG-D/M 01–03, ATD-D14/D15, aprovados em 23–26/11/2026) — parte PURA.
 *
 * A equipe confirma que um problema é da REGIÃO (falta de energia, de água, de internet, temporal) e não do
 * imóvel; a IA nunca decide isso sozinha. Enquanto a situação está ativa, a IA usa o texto da equipe com os
 * hóspedes da mesma cidade da conta que relatarem o mesmo problema. Defeito dentro do imóvel nunca entra.
 */

export const REGIONAL_VALIDITY_HOURS = [3, 6, 12, 24] as const;
export type RegionalValidity = (typeof REGIONAL_VALIDITY_HOURS)[number];

export const REGIONAL_DEFAULT_NEIGHBORHOODS = "Toda a cidade";

/** A frase que vai para a IA no Documento Vivo (com as travas de comportamento, sem texto pronto ao hóspede). */
export function regionalLivingStatement(s: { kind: string; city: string; neighborhoods: string; aiText: string }): string {
  const where = s.neighborhoods && s.neighborhoods.trim() && s.neighborhoods.trim() !== REGIONAL_DEFAULT_NEIGHBORHOODS
    ? `${s.city.trim()} (${s.neighborhoods.trim()})`
    : s.city.trim();
  const out =
    `Situação regional confirmada pela equipe em ${where}: ${s.kind.trim()}. O que a equipe informou: ${s.aiText.trim()} ` +
    "Use isso só com hóspede que relatar esse mesmo problema; nunca cite outros hóspedes ou imóveis; se o hóspede disser que o problema é só no imóvel dele, trate como problema do imóvel e encaminhe à equipe.";
  return out.replace(/\s+/g, " ").slice(0, 600);
}

/** "Falta de energia · Foz do Iguaçu". */
export const regionalTitle = (s: { kind: string; city: string }) => `${s.kind.trim()} · ${s.city.trim()}`;

/** Expiração a partir de agora e da validade escolhida. */
export function regionalExpiresAt(now: Date, hours: RegionalValidity): string {
  return new Date(now.getTime() + hours * 3_600_000).toISOString();
}

/** Validade escolhida mais próxima de uma situação já existente (para editar). */
export function regionalValidityOf(startsAt: string, expiresAt: string | null): RegionalValidity {
  if (!expiresAt) return 6;
  const h = (Date.parse(expiresAt) - Date.parse(startsAt)) / 3_600_000;
  let best: RegionalValidity = 6;
  for (const v of REGIONAL_VALIDITY_HOURS) if (Math.abs(v - h) < Math.abs(best - h)) best = v;
  return best;
}

/** "N conversa(s)" com a concordância certa. */
export const conversationsLabel = (n: number) => `${n} ${n === 1 ? "conversa" : "conversas"}`;

/** Nomes curtos ("Roberto, Paulo e Larissa"). */
export function joinNames(names: readonly string[]): string {
  const first = names.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);
  if (first.length <= 1) return first[0] ?? "";
  return `${first.slice(0, -1).join(", ")} e ${first[first.length - 1]}`;
}
