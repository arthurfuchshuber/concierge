import type { CellPart, PropertyCells, OccStay } from "./occupancy-cells";

/**
 * CALENDÁRIO DE OCUPAÇÃO — BARRAS CONTÍNUAS (02/11/2026).
 *
 * O quadro deixou de ser uma `<table>` fatiada por dia: cada estadia (ou bloqueio) é UMA barra, posicionada por
 * coordenadas (`left`/`width`), em vez de dezenas de células com metades de dia. Este módulo transforma o vetor de
 * metades já pré-calculado (`computePropertyCells`) nas barras — mesma regra visual de antes:
 *   · a barra vai do MEIO do dia de check-in ao MEIO do dia de checkout (as metades "in"/"busy"/"out" da estadia);
 *   · a barra se parte onde a estadia muda, onde muda de reserva para bloqueio, e dentro do dia de "junção"
 *     (checkout + check-in no mesmo dia), onde a cada ponta entra um corte limpo de 2 px (4 px entre as barras);
 *   · as pontas só são arredondadas onde não há outra barra encostada (mesma conta de `occL`/`occR` de antes).
 */
export type BarEdge = {
  /** Índice da metade (2·dia + 0 manhã / 1 tarde). */
  h: number;
  /** "out" = fio laranja rente ao fim da metade da manhã; "in" = fio verde rente ao começo da metade da tarde. */
  part: "in" | "out";
  /** Metade encolhida pelo corte da junção. */
  cut: boolean;
};

export type BarSegment<S extends OccStay> = {
  /** Primeira e última metade cobertas (inclusive). */
  h0: number;
  h1: number;
  /** Bloqueio manual (cinza) — não pertence a nenhuma reserva. */
  blocked: boolean;
  stay: S | undefined;
  /** A ponta começa na metade da tarde de um dia de junção / termina na metade da manhã de um dia de junção. */
  startCut: boolean;
  endCut: boolean;
  roundL: boolean;
  roundR: boolean;
  edges: BarEdge[];
};

export function computeBarSegments<S extends OccStay>(cells: Pick<PropertyCells<S>, "halves" | "stays" | "junction">): BarSegment<S>[] {
  const { halves, stays, junction } = cells;
  const total = halves.length;
  const occ = (h: number) => h >= 0 && h < total && halves[h] !== "free";
  const out: BarSegment<S>[] = [];
  let cur: BarSegment<S> | null = null;

  const close = () => {
    if (!cur) return;
    const first = cur.h0;
    const last = cur.h1;
    cur.startCut = first % 2 === 1 && !!junction[first >> 1];
    cur.endCut = last % 2 === 0 && !!junction[last >> 1];
    // Mesma regra de antes: a junção "corta" a ponta (arredonda) mesmo havendo vizinha encostada.
    cur.roundL = cur.startCut || !occ(first - 1);
    cur.roundR = cur.endCut || !occ(last + 1);
    out.push(cur);
    cur = null;
  };

  for (let h = 0; h < total; h++) {
    const part = halves[h] as CellPart;
    if (part === "free") {
      close();
      continue;
    }
    const blocked = part === "blocked";
    const stay = blocked ? undefined : stays[h];
    const splitHere =
      !cur || cur.blocked !== blocked || cur.stay !== stay || (h % 2 === 1 && !!junction[h >> 1]);
    if (splitHere) {
      close();
      cur = { h0: h, h1: h, blocked, stay, startCut: false, endCut: false, roundL: true, roundR: true, edges: [] };
    } else if (cur) {
      cur.h1 = h;
    }
    if (cur && (part === "in" || part === "out")) {
      cur.edges.push({ h, part, cut: !!junction[h >> 1] });
    }
  }
  close();
  return out;
}

/** Geometria em px de uma barra: `left` e `width` relativos ao início do trilho de dias. */
export function barBox(seg: Pick<BarSegment<OccStay>, "h0" | "h1" | "startCut" | "endCut">, dayW: number) {
  const hw = dayW / 2;
  const left = seg.h0 * hw + (seg.startCut ? 2 : 0);
  const right = (seg.h1 + 1) * hw - (seg.endCut ? 2 : 0);
  return { left, width: Math.max(0, right - left) };
}

/** Posição (relativa à barra) e largura do fio de status ("in"/"out"): 3 px × até 12 px rente à ponta da metade. */
export function edgeBox(
  seg: Pick<BarSegment<OccStay>, "h0" | "h1" | "startCut" | "endCut">,
  edge: BarEdge,
  dayW: number,
) {
  const hw = dayW / 2;
  const boxLeft = barBox(seg, dayW).left;
  const halfW = hw - (edge.cut ? 2 : 0);
  const w = Math.min(12, halfW);
  if (edge.part === "out") {
    const end = (edge.h + 1) * hw - (edge.cut ? 2 : 0);
    return { left: end - w - boxLeft, width: w };
  }
  const start = edge.h * hw + (edge.cut ? 2 : 0);
  return { left: start - boxLeft, width: w };
}
