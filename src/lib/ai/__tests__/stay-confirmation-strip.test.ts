import { describe, it, expect } from "vitest";
import { stripStayConfirmation } from "../reply-finalize";

describe("stripStayConfirmation", () => {
  it("remove 'Sua saída está confirmada.' da primeira linha", () => {
    const out = stripStayConfirmation("Bom dia, Manoela! Sua saída está confirmada.\n\nBoa viagem!");
    expect(out).toBe("Bom dia, Manoela!\n\nBoa viagem!");
  });
  it("mantém texto sem confirmação", () => {
    expect(stripStayConfirmation("Obrigado por avisar, Ana!")).toBe("Obrigado por avisar, Ana!");
  });
});
