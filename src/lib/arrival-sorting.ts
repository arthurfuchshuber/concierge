import type { ArrivalRow } from "@/lib/dashboard.functions";
import { compareLateRows, compareLateThenDay, compareTimesNullLast, hasExplicitForecast, sortingTimeOf } from "@/lib/arrival-order";

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
export function clusterByProximity(group: ArrivalRow[], anchor?: ArrivalRow | null): ArrivalRow[] {
  const hasAnchor = !!anchor && anchor.lat != null && anchor.lng != null;
  if (group.length <= 1 || (group.length === 2 && !hasAnchor)) return group;
  const withCoords = group.filter((r) => r.lat != null && r.lng != null);
  const withoutCoords = group.filter((r) => r.lat == null || r.lng == null);
  if (withCoords.length <= 1) return group;

  const dist = (x: ArrivalRow, y: { lat?: number | null; lng?: number | null }) =>
    haversineMeters({ lat: x.lat as number, lng: x.lng as number }, { lat: y.lat as number, lng: y.lng as number });
  const remaining = [...withCoords];
  // Começa pelo que está mais perto do ÚLTIMO imóvel já ordenado (o anterior da lista), não pelo 1º do grupo.
  let startIdx = 0;
  if (hasAnchor) {
    let best = Infinity;
    remaining.forEach((cand, k) => {
      const d = dist(cand, anchor as ArrivalRow);
      if (d < best) {
        best = d;
        startIdx = k;
      }
    });
  }
  const chain: ArrivalRow[] = [remaining.splice(startIdx, 1)[0]];
  while (remaining.length > 0) {
    const last = chain[chain.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const d = dist(remaining[k], last);
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
 * 1) horário PREVISTO de saída (mais cedo primeiro) — sem previsão, o
 *    horário LIMITE de checkout do imóvel, só pra ordenar (nunca gravado);
 *    sem nenhum dos dois, vai por último;
 * 2) EMPATE de horário: quem tem previsão INFORMADA vem antes de quem só tem o
 *    horário limite do imóvel (mesmo que o horário seja igual); depois, imóvel
 *    com check-in no MESMO dia (giro) sobe, e entre
 *    giros vale o horário do check-in que está chegando (17/10/2026: antes o
 *    giro passava na frente do horário e um checkout das 11:00 ficava acima
 *    de um das 02:00 — o horário manda, o giro só desempata);
 * 3) o que ainda estiver empatado, por proximidade de endereço: o primeiro do
 *    grupo é o mais perto do ÚLTIMO imóvel já ordenado na lista e os demais
 *    seguem encadeados pelo vizinho mais próximo (rota curta).
 *    Proximidade vale só para checkouts/limpeza — nos check-ins não existe.
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
    const late = compareLateRows(a, b, "checkout", today);
    if (late !== 0) return late;
    const day = compareLateThenDay(a, b, today);
    if (day !== 0) return day;
    const own = compareTimes(ownTime(a), ownTime(b));
    if (own !== 0) return own;
    const ea = hasExplicitForecast(a, "checkout") ? 0 : 1;
    const eb = hasExplicitForecast(b, "checkout") ? 0 : 1;
    if (ea !== eb) return ea - eb;
    const ga = hasTurnover(a) ? 0 : 1;
    const gb = hasTurnover(b) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    if (ga === 0) return compareTimes(turnoverTime(a), turnoverTime(b));
    return 0;
  };
  const sorted = [...rows].sort(cmp);
  const result: ArrivalRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
    result.push(...clusterByProximity(sorted.slice(i, j), result[result.length - 1]));
    i = j;
  }
  return result;
}

/**
 * Ordenação da FILA DE LIMPEZA (18/10/2026, caso Lívia × Patrícia): imóvel com
 * check-in no MESMO dia (giro) tem prioridade máxima — precisa estar limpo antes
 * da próxima chegada — e entre giros manda a chegada mais cedo. Depois, os
 * demais pela ordem normal dos checkouts (horário de saída → proximidade).
 * Atrasado e dia continuam na frente de tudo.
 */
export function sortCleaningRows(rows: ArrivalRow[], checkinRowSources: ArrivalRow[][], today: string): ArrivalRow[] {
  const sameDayCheckin = buildSameDayCheckinLookup(checkinRowSources);
  const key = (r: ArrivalRow) => `${r.propertyId}|${r.date}`;
  const giro = rows.filter((r) => sameDayCheckin.has(key(r)));
  const rest = rows.filter((r) => !sameDayCheckin.has(key(r)));
  const cmpGiro = (a: ArrivalRow, b: ArrivalRow) =>
    compareLateRows(a, b, "checkout", today) ||
    compareLateThenDay(a, b, today) ||
    compareTimesNullLast(sameDayCheckin.get(key(a)) ?? null, sameDayCheckin.get(key(b)) ?? null) ||
    compareTimesNullLast(sortingTimeOf(a, "checkout"), sortingTimeOf(b, "checkout"));
  const restSorted = sortCheckoutRows(rest, checkinRowSources, today);
  // Atrasados/dias anteriores sem giro ainda vêm antes dos giros de hoje.
  const isEarlier = (r: ArrivalRow) => r.date < today;
  return [
    ...restSorted.filter(isEarlier),
    ...[...giro].sort(cmpGiro),
    ...restSorted.filter((r) => !isEarlier(r)),
  ];
}




/**
 * Ordenação dos cards de chegada (check-in):
 * 0) ATRASADOS no topo: tempo de atraso (mais antigo primeiro) → proprietário
 *    A→Z → imóvel A→Z (`compareLateRows`);
 * 1) imóveis já liberados acima dos que ainda têm checkout/limpeza pendente
 *    (`blockedPropertyIds`) — bloqueado nunca compete por horário;
 * 2) dia mais próximo primeiro (só faz diferença em listas de vários dias);
 * 3) horário PREVISTO de chegada → sem previsão, o horário INICIAL de check-in
 *    do imóvel (só para ordenar, nunca gravado como previsão);
 * 4) nome do PROPRIETÁRIO A→Z;
 * 5) nome do IMÓVEL A→Z.
 * Proximidade de endereço NÃO entra nos check-ins (pedido de 17/10/2026).
 */
export function sortCheckinRowsCore(rows: ArrivalRow[], blockedPropertyIds: { has(id: string): boolean }, today: string): ArrivalRow[] {
  const txt = (a?: string | null, b?: string | null) => (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
  const time = (r: ArrivalRow) => sortingTimeOf(r, "checkin");
  const blockedRank = (r: ArrivalRow) => (blockedPropertyIds.has(r.propertyId) ? 1 : 0);
  return [...rows].sort((a, b) => {
    const late = compareLateRows(a, b, "checkin", today);
    if (late !== 0) return late;
    const rankDiff = blockedRank(a) - blockedRank(b);
    if (rankDiff !== 0) return rankDiff;
    const day = compareLateThenDay(a, b, today);
    if (day !== 0) return day;
    const t = compareTimesNullLast(time(a), time(b));
    if (t !== 0) return t;
    return txt(a.ownerName, b.ownerName) || txt(a.propertyName, b.propertyName);
  });
}
