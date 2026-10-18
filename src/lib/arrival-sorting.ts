import type { ArrivalRow } from "@/lib/dashboard.functions";
import { compareLateThenDay, compareTimesNullLast, sortingTimeOf } from "@/lib/arrival-order";

/**
 * ORDENAÇÃO DOS CARDS DE CHEGADA E SAÍDA (extraída do painel em 17/10/2026 para
 * poder ser testada). Comentários e regras são os de sempre; a novidade é o
 * relógio de cada lista (`arrival-order.ts`) e o "atrasado + dia" na frente.
 */

/** Distância em metros entre duas coordenadas (fórmula de haversine). */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * Mapa `propriedade|data` → horário previsto do check-in daquele dia (ou
 * `null` se houver check-in sem horário definido) — usado só pra decidir se
 * um checkout "cruza" com uma chegada no mesmo imóvel no mesmo dia (giro).
 * Quando há mais de um check-in no mesmo imóvel/dia (raro), fica o mais cedo.
 */
export function buildSameDayCheckinLookup(checkinRowSources: ArrivalRow[][]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const rows of checkinRowSources) {
    for (const r of rows) {
      const key = `${r.propertyId}|${r.date}`;
      const t = sortingTimeOf(r, "checkin");
      if (!map.has(key)) {
        map.set(key, t);
      } else {
        const cur = map.get(key) ?? null;
        if (t && (!cur || t < cur)) map.set(key, t);
      }
    }
  }
  return map;
}

/**
 * Encadeia os itens de um grupo empatado pelo vizinho mais próximo (rota
 * curta): parte do primeiro item do grupo e, a cada passo, escolhe entre os
 * restantes aquele que está mais perto do ÚLTIMO item já encadeado — não do
 * primeiro. Pedido explícito, com exemplo real: "casa da Patrícia" → o
 * próximo deve ser quem está mais perto DELA (ex.: "casa do Arthur"), e o
 * seguinte, mais perto do Arthur (ex.: "studio da Eliete") — não uma
 * propriedade distante só porque pertence a um grupo com mais unidades
 * (ex.: vários "studios do Clayton" longe dali). Isso também garante que
 * imóveis no mesmo endereço apareçam juntos (distância ~0 = sempre o
 * próximo escolhido). Imóveis sem coordenada cadastrada não competem nesse
 * critério; ficam ao final do grupo, na ordem que já tinham.
 */
export function clusterByProximity(group: ArrivalRow[]): ArrivalRow[] {
  if (group.length <= 2) return group;
  const withCoords = group.filter((r) => r.lat != null && r.lng != null);
  const withoutCoords = group.filter((r) => r.lat == null || r.lng == null);
  if (withCoords.length <= 1) return group;

  const remaining = [...withCoords];
  const chain: ArrivalRow[] = [remaining.shift() as ArrivalRow];
  while (remaining.length > 0) {
    const last = chain[chain.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const cand = remaining[k];
      const d = haversineMeters(
        { lat: last.lat as number, lng: last.lng as number },
        { lat: cand.lat as number, lng: cand.lng as number },
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = k;
      }
    }
    chain.push(remaining.splice(bestIdx, 1)[0]);
  }
  return [...chain, ...withoutCoords];
}

/**
 * Ordenação dos checkouts (pedido explícito), em ordem de prioridade:
 * 0) atrasado no topo e dia mais próximo primeiro (`compareLateThenDay`);
 * 1) imóvel com check-in previsto no MESMO dia (giro) sobe pro topo;
 * 2) dentro do giro, pelo horário previsto do check-in que está chegando
 *    (mais cedo primeiro);
 * 3) o que sobrar (inclusive quem não tem giro) pelo horário previsto do
 *    próprio checkout (mais cedo primeiro);
 * 4) o que ainda estiver empatado, por proximidade de endereço — encadeado
 *    pelo vizinho mais próximo do ÚLTIMO imóvel já ordenado (rota curta),
 *    não pelo tamanho do grupo de imóveis vizinhos.
 * `checkinRowSources` recebe TODAS as fontes de check-in relevantes pro
 * mesmo período das linhas de checkout (não só as pendentes: um giro conta
 * mesmo que o check-in já tenha sido marcado feito).
 */
export function sortCheckoutRows(rows: ArrivalRow[], checkinRowSources: ArrivalRow[][], today: string): ArrivalRow[] {
  const sameDayCheckin = buildSameDayCheckinLookup(checkinRowSources);
  const ownTime = (r: ArrivalRow) => sortingTimeOf(r, "checkout");
  const turnoverKey = (r: ArrivalRow) => `${r.propertyId}|${r.date}`;
  const hasTurnover = (r: ArrivalRow) => sameDayCheckin.has(turnoverKey(r));
  const turnoverTime = (r: ArrivalRow) => sameDayCheckin.get(turnoverKey(r)) ?? null;
  const compareTimes = compareTimesNullLast;
  const cmp = (a: ArrivalRow, b: ArrivalRow) => {
    // 0) ATRASADO no topo (o mais antigo primeiro) e, depois, o dia mais próximo:
    //    vale antes de tudo — uma lista que cobre vários dias nunca mistura os dias.
    const day = compareLateThenDay(a, b, today);
    if (day !== 0) return day;
    const ga = hasTurnover(a) ? 0 : 1;
    const gb = hasTurnover(b) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      const c = compareTimes(turnoverTime(a), turnoverTime(b));
      if (c !== 0) return c;
    }
    return compareTimes(ownTime(a), ownTime(b));
  };
  const sorted = [...rows].sort(cmp);
  const result: ArrivalRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
    result.push(...clusterByProximity(sorted.slice(i, j)));
    i = j;
  }
  return result;
}


/**
 * Ordenação dos cards de chegada:
 * 1) imóveis já liberados acima dos que ainda têm checkout/limpeza pendente
 *    (`blockedPropertyIds`) — bloqueado nunca compete por horário;
 * 2) atrasado no topo (o mais antigo primeiro) e dia mais próximo primeiro;
 * 3) horário previsto de chegada → sem previsão, o horário inicial do imóvel
 *    (só para ordenar, nunca gravado como previsão);
 * 4) empate: proximidade de endereço (rota curta) → proprietário/anúncio A→Z.
 */
export function sortCheckinRowsCore(rows: ArrivalRow[], blockedPropertyIds: { has(id: string): boolean }, today: string): ArrivalRow[] {
  const txt = (a?: string | null, b?: string | null) => (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
  const time = (r: ArrivalRow) => sortingTimeOf(r, "checkin");
  const blockedRank = (r: ArrivalRow) => (blockedPropertyIds.has(r.propertyId) ? 1 : 0);
  const cmp = (a: ArrivalRow, b: ArrivalRow) => {
    const rankDiff = blockedRank(a) - blockedRank(b);
    if (rankDiff !== 0) return rankDiff;
    const day = compareLateThenDay(a, b, today);
    if (day !== 0) return day;
    return compareTimesNullLast(time(a), time(b));
  };
  const alpha = (a: ArrivalRow, b: ArrivalRow) => txt(a.ownerName, b.ownerName) || txt(a.propertyName, b.propertyName);
  const sorted = [...rows].sort((a, b) => cmp(a, b) || alpha(a, b));
  const result: ArrivalRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
    result.push(...clusterByProximity(sorted.slice(i, j)));
    i = j;
  }
  return result;
}
