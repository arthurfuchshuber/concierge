import { describe, it, expect } from "vitest";
import { needsHistory } from "../history-need";
import { dedupeStays } from "../../arrival-board.server";

describe("needsHistory", () => {
  it("pergunta objetiva do Wi-Fi não lê histórico", () => {
    expect(needsHistory("Qual a senha do wifi?")).toBe(false);
  });
  it("dúvida contínua lê histórico", () => {
    expect(needsHistory("E se a gente chegar mais tarde então?")).toBe(true);
  });
  it("referência ao combinado lê histórico", () => {
    expect(needsHistory("Sobre o horário que combinamos, ainda vale?")).toBe(true);
  });
});

describe("dedupeStays", () => {
  const base = { property_id: "p", checkin_date: "2026-10-08", checkout_date: "2026-10-12" };
  it("mesma estadia em duas fontes vira um card", () => {
    const out = dedupeStays(
      [
        { ...base, id: "ical", created_at: "2026-09-28" },
        { ...base, id: "channex", created_at: "2026-10-11" },
      ],
      () => false,
    );
    expect(out.map((r) => r.id)).toEqual(["channex"]);
  });
  it("mantém o registro que já tem status da equipe", () => {
    const out = dedupeStays(
      [
        { ...base, id: "ical", created_at: "2026-09-28" },
        { ...base, id: "channex", created_at: "2026-10-11" },
      ],
      (id) => id === "ical",
    );
    expect(out.map((r) => r.id)).toEqual(["ical"]);
  });

  it("Channex sempre manda no conteúdo; status do iCal só empresta o id", () => {
    const out = dedupeStays(
      [
        { ...base, id: "ical", source: "airbnb", amount: null, created_at: "2026-09-28" },
        { ...base, id: "channex", source: "channex", amount: 580.69, created_at: "2026-10-11" },
      ],
      (id) => id === "ical",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "ical", source: "channex", amount: 580.69 });
  });
  it("sem status, a linha da Channex vence mesmo sendo a mais antiga", () => {
    const out = dedupeStays(
      [
        { ...base, id: "channex", source: "channex", created_at: "2026-09-01" },
        { ...base, id: "ical", source: "airbnb", created_at: "2026-10-11" },
      ],
      () => false,
    );
    expect(out.map((r) => r.id)).toEqual(["channex"]);
  });
});
