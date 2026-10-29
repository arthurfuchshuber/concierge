import { describe, expect, it } from "vitest";
import {
  canPickBlockFrom,
  canPickBlockTo,
  canPickReleaseFrom,
  canPickReleaseTo,
  maxBlockEnd,
  normalizeBlockRange,
  occupiedNightSet,
  releaseFirstNight,
  releaseRemainders,
} from "../manual-block-conflict";

const TODAY = "2026-10-29";
// reservas em 03–07/11 (noites 3..6), 14–18/11 (noites 14..17) e 24–27/11 (noites 24..26)
const occ = occupiedNightSet([
  { checkin: "2026-11-03", checkout: "2026-11-07" },
  { checkin: "2026-11-14", checkout: "2026-11-18" },
  { checkin: "2026-11-24", checkout: "2026-11-27" },
]);

describe("calendário do bloqueio: Entrada", () => {
  it("passado e noites ocupadas não podem ser escolhidos", () => {
    expect(canPickBlockFrom(occ, TODAY, "2026-10-28")).toBe(false);
    expect(canPickBlockFrom(occ, TODAY, "2026-11-04")).toBe(false);
    expect(canPickBlockFrom(occ, TODAY, "2026-11-09")).toBe(true);
    expect(canPickBlockFrom(occ, TODAY, TODAY)).toBe(true);
  });
});

describe("calendário do bloqueio: Libera em", () => {
  it("vai até o dia em que a próxima reserva entra, sem atravessá-la", () => {
    expect(maxBlockEnd(occ, "2026-11-09")).toBe("2026-11-14");
    expect(canPickBlockTo(occ, "2026-11-09", "2026-11-14")).toBe(true);
    expect(canPickBlockTo(occ, "2026-11-09", "2026-11-15")).toBe(false);
    expect(canPickBlockTo(occ, "2026-11-09", "2026-11-09")).toBe(false);
    expect(canPickBlockTo(occ, "2026-11-09", "2026-11-10")).toBe(true);
  });

  it("limita a 366 noites quando não há reserva pela frente", () => {
    expect(maxBlockEnd(new Set<string>(), "2026-11-09")).toBe("2027-11-10");
  });

  it("trocar a entrada ajusta o fim: mantém, empurra 1 noite ou corta na reserva", () => {
    expect(normalizeBlockRange(occ, "2026-11-09", "2026-11-12")).toEqual({ from: "2026-11-09", to: "2026-11-12" });
    expect(normalizeBlockRange(occ, "2026-11-12", "2026-11-10")).toEqual({ from: "2026-11-12", to: "2026-11-13" });
    expect(normalizeBlockRange(occ, "2026-11-12", "2026-11-20")).toEqual({ from: "2026-11-12", to: "2026-11-14" });
  });
});

describe("calendário do liberar: só bloqueio manual", () => {
  const blk = { from: "2026-11-09", to: "2026-11-12" };
  it("só as noites do bloqueio entram como Entrada; o fim vai até o último dia dele", () => {
    expect(canPickReleaseFrom(blk, TODAY, "2026-11-08")).toBe(false);
    expect(canPickReleaseFrom(blk, TODAY, "2026-11-09")).toBe(true);
    expect(canPickReleaseFrom(blk, TODAY, "2026-11-11")).toBe(true);
    expect(canPickReleaseFrom(blk, TODAY, "2026-11-12")).toBe(false);
    expect(canPickReleaseTo(blk, "2026-11-09", "2026-11-12")).toBe(true);
    expect(canPickReleaseTo(blk, "2026-11-09", "2026-11-13")).toBe(false);
  });

  it("bloqueio que já começou: noites passadas não se liberam", () => {
    const started = { from: "2026-10-27", to: "2026-11-02" };
    expect(releaseFirstNight(started, TODAY)).toBe(TODAY);
    expect(canPickReleaseFrom(started, TODAY, "2026-10-28")).toBe(false);
    expect(canPickReleaseFrom(started, TODAY, TODAY)).toBe(true);
  });

  it("liberar um pedaço devolve o que sobra do bloqueio", () => {
    expect(releaseRemainders(blk, "2026-11-09", "2026-11-12")).toEqual([]);
    expect(releaseRemainders(blk, "2026-11-10", "2026-11-12")).toEqual([{ from: "2026-11-09", to: "2026-11-10" }]);
    expect(releaseRemainders(blk, "2026-11-10", "2026-11-11")).toEqual([
      { from: "2026-11-09", to: "2026-11-10" },
      { from: "2026-11-11", to: "2026-11-12" },
    ]);
  });
});
