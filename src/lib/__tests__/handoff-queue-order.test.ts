import { describe, expect, it } from "vitest";
import {
  agoLabel,
  brDate,
  checkinPhrase,
  daysUntilCheckin,
  ordinalLabel,
  sortByNearestCheckin,
} from "@/lib/handoff-queue-order";

// 27/10/2026, 12:00 em São Paulo.
const NOW = new Date("2026-10-27T15:00:00Z");

const item = (id: string, checkinDate: string | null, checkoutDate: string | null = null, at: string | null = null) => ({
  id,
  checkinDate,
  checkoutDate,
  at,
});

describe("fila de avisos do hóspede — ordem pelo check-in mais próximo", () => {
  it("o mockup: Alexane (03/11), Júlia (10/11), Pedro (18/11) e mais um (25/11)", () => {
    const sorted = sortByNearestCheckin(
      [
        item("outro", "2026-11-25", "2026-11-28"),
        item("pedro", "2026-11-18", "2026-11-20"),
        item("alexane", "2026-11-03", "2026-11-06"),
        item("julia", "2026-11-10", "2026-11-12"),
      ],
      NOW,
    );
    expect(sorted.map((i) => i.id)).toEqual(["alexane", "julia", "pedro", "outro"]);
  });

  it("estadia em andamento vem antes de qualquer check-in futuro; sem data vai para o fim", () => {
    const sorted = sortByNearestCheckin(
      [item("sem-data", null), item("futuro", "2026-10-29", "2026-11-01"), item("hospedado", "2026-10-25", "2026-10-30")],
      NOW,
    );
    expect(sorted.map((i) => i.id)).toEqual(["hospedado", "futuro", "sem-data"]);
  });

  it("estadia que já terminou perde para qualquer check-in futuro", () => {
    const sorted = sortByNearestCheckin(
      [item("terminou", "2026-10-10", "2026-10-15"), item("futuro", "2026-12-01", "2026-12-05")],
      NOW,
    );
    expect(sorted.map((i) => i.id)).toEqual(["futuro", "terminou"]);
  });

  it("empate: quem entrou na fila primeiro vem primeiro; sem horário, mantém a ordem recebida", () => {
    const sorted = sortByNearestCheckin(
      [
        item("b", "2026-11-03", null, "2026-10-27T14:00:00Z"),
        item("a", "2026-11-03", null, "2026-10-27T13:00:00Z"),
      ],
      NOW,
    );
    expect(sorted.map((i) => i.id)).toEqual(["a", "b"]);
    expect(sortByNearestCheckin([item("x", null), item("y", null)], NOW).map((i) => i.id)).toEqual(["x", "y"]);
  });

  it("não altera a lista de entrada", () => {
    const input = [item("b", "2026-11-18"), item("a", "2026-11-03")];
    sortByNearestCheckin(input, NOW);
    expect(input.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("textos do aviso", () => {
  it("dias até o check-in (fuso de São Paulo)", () => {
    expect(daysUntilCheckin("2026-11-03", NOW)).toBe(7);
    expect(daysUntilCheckin("2026-10-27", NOW)).toBe(0);
    expect(daysUntilCheckin("2026-10-26", NOW)).toBe(-1);
    expect(daysUntilCheckin(null, NOW)).toBeNull();
    expect(daysUntilCheckin("lixo", NOW)).toBeNull();
  });

  it("a virada do dia usa São Paulo, não UTC", () => {
    // 28/10 01:30 UTC ainda é 27/10 22:30 em São Paulo.
    expect(daysUntilCheckin("2026-10-28", new Date("2026-10-28T01:30:00Z"))).toBe(1);
  });

  it("frase do check-in", () => {
    expect(checkinPhrase("2026-11-03", "2026-11-06", NOW)).toBe("check-in em 7 dias");
    expect(checkinPhrase("2026-10-28", null, NOW)).toBe("check-in amanhã");
    expect(checkinPhrase("2026-10-27", null, NOW)).toBe("check-in hoje");
    expect(checkinPhrase("2026-10-25", "2026-10-30", NOW)).toBe("em estadia");
    expect(checkinPhrase("2026-10-10", "2026-10-15", NOW)).toBe("");
    expect(checkinPhrase(null, null, NOW)).toBe("");
  });

  it("datas, posição e tempo", () => {
    expect(brDate("2026-11-03")).toBe("03/11/2026");
    expect(brDate(null)).toBe("");
    expect(ordinalLabel(1)).toBe("1º");
    expect(agoLabel(null, NOW)).toBe("agora");
    expect(agoLabel("2026-10-27T14:59:40Z", NOW)).toBe("agora");
    expect(agoLabel("2026-10-27T14:55:00Z", NOW)).toBe("há 5 min");
    expect(agoLabel("2026-10-27T13:00:00Z", NOW)).toBe("há 2 h");
    expect(agoLabel("2026-10-24T15:00:00Z", NOW)).toBe("há 3 d");
  });
});
