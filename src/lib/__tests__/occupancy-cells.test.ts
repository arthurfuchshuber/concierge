import { describe, expect, it } from "vitest";
import { computePropertyCells, type CellPart, type OccBlock } from "@/lib/occupancy-cells";

/** Implementação ANTIGA do calendário (cópia fiel de `cellHalves`/`stayAt`/junção), usada como referência. */
type St = { id: number; checkin: string; checkout: string | null };
function oldHalves(list: St[], blocks: OccBlock[], day: string, todayISO: string, checkedIn: boolean): [CellPart, CellPart] {
  const outStay = list.find((s) => s.checkout === day);
  const inStay = list.find((s) => s.checkin === day);
  const through = list.some((s) => s.checkin < day && (s.checkout ?? s.checkin) > day);
  const first: CellPart = outStay ? "out" : through ? "busy" : "free";
  const second: CellPart = inStay ? (day === todayISO && checkedIn ? "busy" : "in") : through ? "busy" : "free";
  const amBlocked = blocks.some((b) => b.from < day && b.to >= day);
  const pmBlocked = blocks.some((b) => b.from <= day && b.to > day);
  return [first === "free" && amBlocked ? "blocked" : first, second === "free" && pmBlocked ? "blocked" : second];
}
function oldStayAt(list: St[], day: string, half: 0 | 1) {
  const through = list.find((s) => s.checkin < day && (s.checkout ?? s.checkin) > day);
  return (half === 0 ? list.find((s) => s.checkout === day) : list.find((s) => s.checkin === day)) ?? through;
}

const iso = (base: number, add: number) => new Date(Date.UTC(2026, 9, 1) + (base + add) * 86_400_000).toISOString().slice(0, 10);

function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe("calendário de ocupação — pré-cálculo idêntico ao antigo", () => {
  it("bate dia a dia, metade a metade, em 300 cenários aleatórios", () => {
    const r = rng(42);
    for (let c = 0; c < 300; c++) {
      const days = 20 + Math.floor(r() * 60);
      const dayList = Array.from({ length: days }, (_, i) => iso(0, i));
      const stays: St[] = [];
      const nStays = Math.floor(r() * 10);
      for (let k = 0; k < nStays; k++) {
        const ci = Math.floor(r() * (days + 20)) - 10; // começa antes/depois da tela também
        const nights = Math.floor(r() * 8); // 0 = sem noites
        stays.push({ id: k, checkin: iso(0, ci), checkout: r() < 0.08 ? null : iso(0, ci + nights) });
      }
      const blocks: OccBlock[] = [];
      for (let k = 0; k < Math.floor(r() * 4); k++) {
        const f = Math.floor(r() * (days + 10)) - 5;
        blocks.push({ from: iso(0, f), to: iso(0, f + Math.floor(r() * 6)), twin: r() < 0.4 });
      }
      const todayISO = dayList[Math.floor(r() * days)]!;
      const checkedIn = r() < 0.5;
      const got = computePropertyCells(stays, blocks, dayList, { todayISO, checkedInToday: checkedIn });
      dayList.forEach((d, i) => {
        const [a, b] = oldHalves(stays, blocks, d, todayISO, checkedIn);
        expect([got.halves[i * 2], got.halves[i * 2 + 1]], `cenário ${c} dia ${d}`).toEqual([a, b]);
        expect(got.stays[i * 2]?.id, `manhã ${c} ${d}`).toBe(oldStayAt(stays, d, 0)?.id);
        expect(got.stays[i * 2 + 1]?.id, `tarde ${c} ${d}`).toBe(oldStayAt(stays, d, 1)?.id);
        const outS = stays.find((x) => x.checkout === d);
        const inS = stays.find((x) => x.checkin === d);
        // Bloqueio que termina no dia ↔ OUTRO bloqueio que começa nele corta SÓ se um dos dois é do gêmeo (05/11/2026).
        const real = blocks.filter((x) => x.to > x.from);
        const blockSwap = real.some((x) => x.to === d) && real.some((x) => x.from === d) && (real.some((x) => x.to === d && x.twin) || real.some((x) => x.from === d && x.twin));
        const junction = (!!outS && !!inS) || (!!outS && b === "blocked") || (a === "blocked" && !!inS) || blockSwap;
        expect(got.junction[i], `junção ${c} ${d}`).toBe(junction);
      });
    }
  });
});

describe("calendário de ocupação — junção entre peças distintas (03/11/2026)", () => {
  const dl = Array.from({ length: 12 }, (_, i) => iso(0, i)); // 01/10 … 12/10
  const o = { todayISO: "2026-10-01", checkedInToday: false };

  it("dois bloqueios do GÊMEO seguidos: o dia do corte é junção (manhã e tarde cinza)", () => {
    const c = computePropertyCells([], [{ from: "2026-10-03", to: "2026-10-05", twin: true }, { from: "2026-10-05", to: "2026-10-08", twin: true }], dl, o);
    const i = dl.indexOf("2026-10-05");
    expect(c.junction[i]).toBe(true);
    expect([c.halves[i * 2], c.halves[i * 2 + 1]]).toEqual(["blocked", "blocked"]);
  });

  it("dois bloqueios MANUAIS diretos seguidos: sem junção (barra sólida)", () => {
    const c = computePropertyCells([], [{ from: "2026-10-03", to: "2026-10-05" }, { from: "2026-10-05", to: "2026-10-08" }], dl, o);
    const i = dl.indexOf("2026-10-05");
    expect(c.junction.some(Boolean)).toBe(false);
    expect([c.halves[i * 2], c.halves[i * 2 + 1]]).toEqual(["blocked", "blocked"]);
  });

  it("um bloqueio contínuo que só atravessa o dia NÃO cria junção", () => {
    const c = computePropertyCells([], [{ from: "2026-10-03", to: "2026-10-09" }], dl, o);
    expect(c.junction.some(Boolean)).toBe(false);
  });

  it("reserva que sai ↔ bloqueio que entra, e bloqueio que sai ↔ reserva que entra, são junção", () => {
    const a = computePropertyCells([{ checkin: "2026-10-02", checkout: "2026-10-04" }], [{ from: "2026-10-04", to: "2026-10-06" }], dl, o);
    expect(a.junction[dl.indexOf("2026-10-04")]).toBe(true);
    const b = computePropertyCells([{ checkin: "2026-10-06", checkout: "2026-10-08" }], [{ from: "2026-10-04", to: "2026-10-06" }], dl, o);
    expect(b.junction[dl.indexOf("2026-10-06")]).toBe(true);
  });

  it("bloqueio de 0 noite não cria junção", () => {
    const c = computePropertyCells([], [{ from: "2026-10-03", to: "2026-10-05" }, { from: "2026-10-05", to: "2026-10-05" }], dl, o);
    expect(c.junction[dl.indexOf("2026-10-05")]).toBe(false);
  });
});
