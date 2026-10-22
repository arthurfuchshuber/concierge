import { describe, it, expect } from "vitest";
import { missingMessagesProperties } from "../channex-messages-app.server";

describe("missingMessagesProperties", () => {
  it("aponta só a unidade ativa sem o app Messages", () => {
    expect(missingMessagesProperties(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
  });
  it("não repete nem considera vazios", () => {
    expect(missingMessagesProperties(["b", "b", ""], [])).toEqual(["b"]);
  });
});
