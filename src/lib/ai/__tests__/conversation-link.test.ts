import { describe, expect, it } from "vitest";
import { normalizeReservationCode } from "../conversation-link.server";
import { detectStayCompletion } from "../stay-completion-detect";

describe("código de reserva soberano", () => {
  it("normaliza o código do Airbnb com prefixo ABB-", () => {
    expect(normalizeReservationCode("abb-hmwc48dd3n")).toBe("HMWC48DD3N");
  });
  it("recusa nome no lugar de código", () => {
    expect(normalizeReservationCode("Wilton N Tormena")).toBeNull();
  });
  it("'Deu tudo certo!' conta como entrada sem depender da resposta da IA", () => {
    expect(detectStayCompletion("Deu tudo certo!", "")).toBe("checkin");
  });
});
