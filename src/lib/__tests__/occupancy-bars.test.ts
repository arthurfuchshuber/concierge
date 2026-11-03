import { describe, expect, it } from "vitest";
import { computePropertyCells, type OccStay } from "@/lib/occupancy-cells";
import { barBox, computeBarSegments, edgeBox } from "@/lib/occupancy-bars";

const days = (n: number, start = "2026-11-01") => {
  const out: string[] = [];
  const t = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
};
const opts = { todayISO: "2026-11-02", checkedInToday: false };
type S = OccStay & { id: string };
const stay = (id: string, checkin: string, checkout: string | null): S => ({ id, checkin, checkout });

describe("barras contínuas do calendário", () => {
  it("uma estadia de 3 noites vira UMA barra do meio do check-in ao meio do checkout", () => {
    const dl = days(10);
    const c = computePropertyCells([stay("a", "2026-11-03", "2026-11-06")], [], dl, opts);
    const segs = computeBarSegments(c);
    expect(segs).toHaveLength(1);
    const s = segs[0]!;
    // dia 2 (03/11) tarde = metade 5 … dia 5 (06/11) manhã = metade 10
    expect([s.h0, s.h1]).toEqual([5, 10]);
    expect(barBox(s, 40)).toEqual({ left: 5 * 20, width: 6 * 20 });
    expect(s.roundL && s.roundR).toBe(true);
    expect(s.edges.map((e) => e.part)).toEqual(["in", "out"]);
  });

  it("checkout + check-in no mesmo dia: duas barras com corte de 4 px entre elas", () => {
    const dl = days(10);
    const c = computePropertyCells([stay("a", "2026-11-02", "2026-11-04"), stay("b", "2026-11-04", "2026-11-06")], [], dl, opts);
    const [a, b] = computeBarSegments(c);
    expect(a!.stay!.id).toBe("a");
    expect(b!.stay!.id).toBe("b");
    expect(a!.endCut).toBe(true);
    expect(b!.startCut).toBe(true);
    const ba = barBox(a!, 40);
    const bb = barBox(b!, 40);
    expect(bb.left - (ba.left + ba.width)).toBe(4);
    // as pontas do corte são arredondadas
    expect(a!.roundR).toBe(true);
    expect(b!.roundL).toBe(true);
  });

  it("bloqueio manual encostado em reserva: barra cinza própria, corte na junção", () => {
    const dl = days(10);
    const c = computePropertyCells([stay("a", "2026-11-05", "2026-11-07")], [{ from: "2026-11-02", to: "2026-11-05" }], dl, opts);
    const segs = computeBarSegments(c);
    expect(segs.map((s) => s.blocked)).toEqual([true, false]);
    expect(segs[0]!.endCut).toBe(true);
    expect(segs[1]!.startCut).toBe(true);
  });

  it("cobre exatamente as metades ocupadas, sem sobrepor", () => {
    const dl = days(40);
    const stays = [
      stay("a", "2026-11-03", "2026-11-08"),
      stay("b", "2026-11-08", "2026-11-09"),
      stay("c", "2026-11-12", "2026-11-20"),
      stay("d", "2026-11-20", null),
      stay("e", "2026-10-28", "2026-11-02"),
    ];
    const blocks = [{ from: "2026-11-09", to: "2026-11-12" }, { from: "2026-11-25", to: "2026-12-02" }];
    const c = computePropertyCells(stays, blocks, dl, opts);
    const segs = computeBarSegments(c);
    const seen = new Array(c.halves.length).fill(0);
    for (const s of segs) for (let h = s.h0; h <= s.h1; h++) seen[h]++;
    c.halves.forEach((p, h) => expect(seen[h]).toBe(p === "free" ? 0 : 1));
    // pontas arredondadas = mesma conta de antes (`occL`/`occR`)
    const occ = c.halves.map((p) => p !== "free");
    for (const s of segs) {
      const j = (h: number) => !!c.junction[h >> 1];
      expect(s.roundL).toBe((s.h0 % 2 === 1 && j(s.h0)) || !occ[s.h0 - 1]);
      expect(s.roundR).toBe((s.h1 % 2 === 0 && j(s.h1)) || !occ[s.h1 + 1]);
    }
  });

  it("fios de status ficam rentes às pontas, com no máximo a largura da metade", () => {
    const dl = days(10);
    const c = computePropertyCells([stay("a", "2026-11-03", "2026-11-04")], [], dl, opts);
    const s = computeBarSegments(c)[0]!;
    const box = barBox(s, 22);
    const [inn, out] = s.edges.map((e) => edgeBox(s, e, 22));
    expect(inn).toEqual({ left: 0, width: 11 });
    expect(out!.left + out!.width).toBe(box.width);
  });

  it("dois bloqueios manuais seguidos: duas barras cinza, 4 px entre elas e pontas arredondadas no corte", () => {
    const dl = days(10);
    const c = computePropertyCells([], [{ from: "2026-11-02", to: "2026-11-05" }, { from: "2026-11-05", to: "2026-11-08" }], dl, opts);
    expect(c.junction[4]).toBe(true); // 05/11
    const segs = computeBarSegments(c);
    expect(segs).toHaveLength(2);
    const [a, b] = segs;
    expect(a!.blocked && b!.blocked).toBe(true);
    expect(a!.endCut).toBe(true);
    expect(b!.startCut).toBe(true);
    expect(a!.roundR).toBe(true);
    expect(b!.roundL).toBe(true);
    const ba = barBox(a!, 40);
    const bb = barBox(b!, 40);
    expect(bb.left - (ba.left + ba.width)).toBe(4);
  });

  it("um bloqueio contínuo continua sendo UMA barra, sem corte", () => {
    const dl = days(10);
    const segs = computeBarSegments(computePropertyCells([], [{ from: "2026-11-02", to: "2026-11-08" }], dl, opts));
    expect(segs).toHaveLength(1);
    expect(segs[0]!.startCut || segs[0]!.endCut).toBe(false);
  });

  it("reserva confirmada que sai e bloqueio manual que entra no mesmo dia: junção e duas barras", () => {
    const dl = days(10);
    const c = computePropertyCells([stay("a", "2026-11-02", "2026-11-04")], [{ from: "2026-11-04", to: "2026-11-07" }], dl, opts);
    expect(c.junction[3]).toBe(true); // 04/11
    const segs = computeBarSegments(c);
    expect(segs.map((s) => s.blocked)).toEqual([false, true]);
    const ba = barBox(segs[0]!, 40);
    const bb = barBox(segs[1]!, 40);
    expect(bb.left - (ba.left + ba.width)).toBe(4);
  });
});
