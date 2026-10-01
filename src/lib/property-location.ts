/**
 * LOCAL DENTRO DO PRÉDIO — o complemento do endereço (mockup "Local dentro do
 * prédio", aprovado 01/10/2026).
 *
 * Quatro dados (apartamento, andar, vagas de garagem e elevador) que só
 * existem quando a chave "Condomínio?" do editor está LIGADA. Desligada, eles
 * somem de todo lugar (editor, tooltip de acesso, copiar endereço, mensagem de
 * WhatsApp, guia do hóspede) — mas os valores ficam guardados no banco e
 * voltam se a chave for religada (decisão do cliente: "sim, guardados").
 *
 * Mora num arquivo PURO (sem servidor, sem rede) para ser testado de verdade e
 * para que toda tela escreva o complemento do MESMO jeito.
 */

export type LocationComplementInput = {
  in_condominium?: boolean | null;
  apartment_number?: string | null;
  apartment_floor?: string | null;
  parking_spots?: string[] | null;
  has_elevator?: boolean | null;
};

export type ComplementKind = "apartment" | "floor" | "spots" | "elevator";
export type ComplementItem = { kind: ComplementKind; text: string };

/** Quantas vagas cabem na lista do editor. */
export const PARKING_SPOTS_MAX = 10;
const FIELD_MAX = 40;

/** Texto livre → texto limpo, ou `null` quando vazio. */
export function cleanLocationText(v: string | null | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim().slice(0, FIELD_MAX);
  return s ? s : null;
}

/** Lista de vagas → sem vazios, sem repetidas, no limite. */
export function normalizeParkingSpots(list: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const s = cleanLocationText(raw);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= PARKING_SPOTS_MAX) break;
  }
  return out;
}

/** "3" → "3º andar"; "Térreo"/"Cobertura" ficam como escritos. */
export function floorLabel(floor: string | null | undefined): string | null {
  const f = cleanLocationText(floor);
  if (!f) return null;
  return /^\d{1,3}$/.test(f) ? `${Number(f)}º andar` : f;
}

/** "Vaga 14" · "Vagas 14 e 15" · "Vagas 14, 15 e 16". */
export function spotsLabel(spots: readonly string[] | null | undefined): string | null {
  const list = normalizeParkingSpots(spots);
  if (list.length === 0) return null;
  if (list.length === 1) return `Vaga ${list[0]}`;
  return `Vagas ${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

/** Os itens preenchidos, na ordem de leitura. Vazio quando o condomínio está desligado. */
export function complementItems(p: LocationComplementInput | null | undefined): ComplementItem[] {
  if (!p?.in_condominium) return [];
  const items: ComplementItem[] = [];
  const apt = cleanLocationText(p.apartment_number);
  if (apt) items.push({ kind: "apartment", text: `Apto ${apt}` });
  const floor = floorLabel(p.apartment_floor);
  if (floor) items.push({ kind: "floor", text: floor });
  const spots = spotsLabel(p.parking_spots);
  if (spots) items.push({ kind: "spots", text: spots });
  if (p.has_elevator === true) items.push({ kind: "elevator", text: "Com elevador" });
  else if (p.has_elevator === false) items.push({ kind: "elevator", text: "Sem elevador" });
  return items;
}

/** "Apto 302 · 3º andar · Vagas 14 e 15 · Com elevador", ou `null`. */
export function complementLine(p: LocationComplementInput | null | undefined): string | null {
  const items = complementItems(p);
  return items.length ? items.map((i) => i.text).join(" · ") : null;
}

/** Linhas para a mensagem de WhatsApp: prédio numa, vaga na outra. */
export function complementMessageLines(p: LocationComplementInput | null | undefined): string[] {
  const items = complementItems(p);
  const building = items.filter((i) => i.kind !== "spots").map((i) => i.text);
  const spots = items.find((i) => i.kind === "spots");
  const lines: string[] = [];
  if (building.length) lines.push(`🏢 ${building.join(" · ")}`);
  if (spots) lines.push(`🚗 ${spots.text}`);
  return lines;
}

/** Para "Copiar Endereço": o endereço e, na linha de baixo, o complemento. */
export function addressWithComplement(
  address: string | null | undefined,
  p: LocationComplementInput | null | undefined,
): string {
  const base = (address ?? "").trim();
  const line = complementLine(p);
  return [base, line].filter(Boolean).join("\n");
}
