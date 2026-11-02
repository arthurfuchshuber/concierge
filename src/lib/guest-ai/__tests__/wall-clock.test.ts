import { describe, expect, it } from "vitest";
import { addDaysIso, isValidIanaTimezone, parseHm, parseInstant, parseIsoDate, wallClockToInstant } from "@/lib/guest-ai/policy/wall-clock";

describe("wall-clock · validação", () => {
  it("IANA válido; offsets fixos e lixo recusados", () => {
    for (const tz of ["America/Sao_Paulo", "America/Argentina/Buenos_Aires", "Europe/Lisbon", "UTC"]) expect(isValidIanaTimezone(tz)).toBe(true);
    for (const tz of ["+03:00", "GMT-3", "BRT", "", null, undefined, 3, "Mars/Phobos", "America/"]) expect(isValidIanaTimezone(tz)).toBe(false);
  });
  it("HH:MM", () => {
    expect(parseHm("15:00")).toEqual([15, 0]);
    expect(parseHm("9:05")).toEqual([9, 5]);
    expect(parseHm("15:00:00")).toEqual([15, 0]);
    for (const v of ["24:00", "12:60", "abc", "", null, 15]) expect(parseHm(v)).toBeNull();
  });
  it("data real de calendário", () => {
    expect(parseIsoDate("2026-02-28")).toEqual([2026, 2, 28]);
    for (const v of ["2026-02-30", "2026-13-01", "10/11/2026", "", null]) expect(parseIsoDate(v)).toBeNull();
  });
  it("instante exige designador de fuso", () => {
    expect(parseInstant("2026-11-10T12:00:00Z")?.toISOString()).toBe("2026-11-10T12:00:00.000Z");
    expect(parseInstant("2026-11-10T09:00:00-03:00")?.toISOString()).toBe("2026-11-10T12:00:00.000Z");
    for (const v of ["2026-11-10", "2026-11-10T12:00", "x", "", null]) expect(parseInstant(v)).toBeNull();
  });
  it("addDaysIso no calendário", () => {
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysIso("lixo", 1)).toBeNull();
  });
});

describe("wall-clock · conversão para instante absoluto", () => {
  it("fusos sem horário de verão", () => {
    expect(wallClockToInstant("2026-11-10", "15:00", "America/Sao_Paulo", "later")?.toISOString()).toBe("2026-11-10T18:00:00.000Z");
    expect(wallClockToInstant("2026-11-10", "15:00", "America/Manaus", "later")?.toISOString()).toBe("2026-11-10T19:00:00.000Z");
    expect(wallClockToInstant("2026-11-10", "15:00", "America/Noronha", "later")?.toISOString()).toBe("2026-11-10T17:00:00.000Z");
  });
  it("entradas inválidas ⇒ null", () => {
    expect(wallClockToInstant("2026-02-30", "15:00", "America/Sao_Paulo", "later")).toBeNull();
    expect(wallClockToInstant("2026-11-10", "99:00", "America/Sao_Paulo", "later")).toBeNull();
    expect(wallClockToInstant("2026-11-10", "15:00", "+03:00", "later")).toBeNull();
  });
  it("horário local AMBÍGUO (Europe/Lisbon, 25/10/2026 01:30 ocorre duas vezes): earlier=00:30Z, later=01:30Z", () => {
    expect(wallClockToInstant("2026-10-25", "01:30", "Europe/Lisbon", "earlier")?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(wallClockToInstant("2026-10-25", "01:30", "Europe/Lisbon", "later")?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });
  it("horário local INEXISTENTE (Europe/Lisbon, 29/03/2026 01:30 pula): earlier=00:30Z, later=01:30Z", () => {
    expect(wallClockToInstant("2026-03-29", "01:30", "Europe/Lisbon", "earlier")?.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(wallClockToInstant("2026-03-29", "01:30", "Europe/Lisbon", "later")?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
  it("dia comum de horário de verão não é ambíguo: earlier == later", () => {
    const a = wallClockToInstant("2026-07-10", "15:00", "Europe/Lisbon", "earlier");
    const b = wallClockToInstant("2026-07-10", "15:00", "Europe/Lisbon", "later");
    expect(a?.toISOString()).toBe("2026-07-10T14:00:00.000Z");
    expect(b?.toISOString()).toBe(a?.toISOString());
  });
});
