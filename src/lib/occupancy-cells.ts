/**
 * CALENDÁRIO DE OCUPAÇÃO — estado de cada metade de dia PRÉ-CALCULADO (02/11/2026).
 *
 * Antes, cada render (rolar, passar o mouse, abrir um balão) refazia, para cada
 * imóvel e para TODOS os dias do período, várias buscas lineares nas reservas e
 * bloqueios (`cellHalves`/`stayAt`): imóveis × dias × reservas a cada quadro.
 * Aqui o mesmo resultado sai uma vez por mudança de dados, com o custo do total
 * de noites — e o render só consulta posições de um vetor.
 *
 * A regra é EXATAMENTE a de antes (o teste compara com a implementação antiga):
 *   · manhã: quem sai no dia ("out"), senão quem atravessa o dia ("busy"),
 *     senão livre — e, livre, vira "blocked" se a noite anterior está bloqueada;
 *   · tarde: quem entra no dia ("in"; vira "busy" quando hoje e o check-in já foi
 *     feito), senão quem atravessa ("busy"), senão livre/"blocked" pela noite do dia;
 *   · havendo mais de uma candidata, vale a PRIMEIRA da lista (como `find`);
 *   · junção (corte de 4 px) no dia `d` quando duas peças DISTINTAS se encontram nele: reserva que sai ↔ reserva que
 *     entra, reserva ↔ bloqueio (nos dois sentidos) e, desde 03/11/2026, bloqueio que termina em `d` ↔ outro
 *     bloqueio que começa em `d` — SÓ quando um dos dois é do anúncio gêmeo (`twin`), onde duas reservas do giro
 *     viram dois bloqueios cinza contíguos (05/11/2026: bloqueios MANUAIS diretos seguidos ficam numa barra sólida).
 *     Um mesmo bloqueio que só atravessa o dia NÃO cria junção.
 */
export type CellPart = "in" | "out" | "busy" | "blocked" | "free";

export type OccStay = { checkin: string; checkout: string | null };
export type OccBlock = {
  from: string;
  to: string;
  /** Bloqueio espelhado do anúncio gêmeo (automático). Só ele ganha divisória de 4 px ao encostar noutro bloqueio. */
  twin?: boolean;
};

export type PropertyCells<S extends OccStay> = {
  /** [manhã do dia 0, tarde do dia 0, manhã do dia 1, …] — mesmo formato do `flatMap(cellHalves)` antigo. */
  halves: CellPart[];
  /** Reserva que "mora" em cada metade (manhã = quem sai, tarde = quem entra, ou quem atravessa). */
  stays: Array<S | undefined>;
  /** O dia tem um checkout e um check-in (ou reserva↔bloqueio): corte de 4 px entre as metades. */
  junction: boolean[];
};

/** Primeiro índice com dayList[i] > v (dayList em ordem, ISO). */
function upper(dayList: string[], v: string): number {
  let lo = 0;
  let hi = dayList.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (dayList[m]! > v) hi = m;
    else lo = m + 1;
  }
  return lo;
}
/** Primeiro índice com dayList[i] >= v. */
function lower(dayList: string[], v: string): number {
  let lo = 0;
  let hi = dayList.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (dayList[m]! >= v) hi = m;
    else lo = m + 1;
  }
  return lo;
}

export function computePropertyCells<S extends OccStay>(
  stays: readonly S[],
  blocks: readonly OccBlock[],
  dayList: string[],
  opts: { todayISO: string; checkedInToday: boolean },
): PropertyCells<S> {
  const n = dayList.length;
  const outFirst: Array<S | undefined> = new Array(n);
  const inFirst: Array<S | undefined> = new Array(n);
  const throughFirst: Array<S | undefined> = new Array(n);
  const amBlocked = new Array<boolean>(n).fill(false);
  const pmBlocked = new Array<boolean>(n).fill(false);
  /** Há um bloqueio que TERMINA / que COMEÇA exatamente neste dia (para detectar bloqueio↔bloqueio). */
  const blockEndsOn = new Array<boolean>(n).fill(false);
  const blockStartsOn = new Array<boolean>(n).fill(false);
  /** O bloqueio que termina / começa neste dia é do gêmeo? (bloqueio MANUAL direto nunca tem divisória). */
  const endTwin = new Array<boolean>(n).fill(false);
  const startTwin = new Array<boolean>(n).fill(false);
  const index = new Map<string, number>();
  dayList.forEach((d, i) => index.set(d, i));

  for (const s of stays) {
    if (s.checkout != null) {
      const io = index.get(s.checkout);
      if (io !== undefined && outFirst[io] === undefined) outFirst[io] = s;
    }
    const ii = index.get(s.checkin);
    if (ii !== undefined && inFirst[ii] === undefined) inFirst[ii] = s;
    // Atravessa: checkin < dia < fim.
    const end = s.checkout ?? s.checkin;
    for (let i = upper(dayList, s.checkin), stop = lower(dayList, end); i < stop; i++) {
      if (throughFirst[i] === undefined) throughFirst[i] = s;
    }
  }
  for (const b of blocks) {
    if (!(b.to > b.from)) continue; // sem noites: não pinta nada nem cria junção
    const ie = index.get(b.to);
    if (ie !== undefined) {
      blockEndsOn[ie] = true;
      if (b.twin) endTwin[ie] = true;
    }
    const is = index.get(b.from);
    if (is !== undefined) {
      blockStartsOn[is] = true;
      if (b.twin) startTwin[is] = true;
    }
    // Manhã: from < dia <= to (a noite anterior está bloqueada).
    for (let i = upper(dayList, b.from), stop = upper(dayList, b.to); i < stop; i++) amBlocked[i] = true;
    // Tarde: from <= dia < to (a noite do dia está bloqueada).
    for (let i = lower(dayList, b.from), stop = lower(dayList, b.to); i < stop; i++) pmBlocked[i] = true;
  }

  const halves: CellPart[] = new Array(n * 2);
  const stayOf: Array<S | undefined> = new Array(n * 2);
  const junction: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const day = dayList[i]!;
    const outS = outFirst[i];
    const inS = inFirst[i];
    const thr = throughFirst[i];
    const first: CellPart = outS ? "out" : thr ? "busy" : "free";
    const second: CellPart = inS ? (day === opts.todayISO && opts.checkedInToday ? "busy" : "in") : thr ? "busy" : "free";
    const a: CellPart = first === "free" && amBlocked[i] ? "blocked" : first;
    const b: CellPart = second === "free" && pmBlocked[i] ? "blocked" : second;
    halves[i * 2] = a;
    halves[i * 2 + 1] = b;
    stayOf[i * 2] = outS ?? thr;
    stayOf[i * 2 + 1] = inS ?? thr;
    junction[i] =
      (!!outS && !!inS) ||
      (!!outS && b === "blocked") ||
      (a === "blocked" && !!inS) ||
      (blockEndsOn[i]! && blockStartsOn[i]! && (endTwin[i]! || startTwin[i]!));
  }
  return { halves, stays: stayOf, junction };
}
