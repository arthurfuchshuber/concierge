import { describe, it, expect } from "vitest";
import { shouldRetryDelivery, DELIVERY_RETRY_AFTER_MS } from "./deliver-answer.server";

const now = Date.parse("2026-10-28T23:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("reenvio da resposta da equipe", () => {
  it("reenvia após 5 min sem confirmação", () => {
    expect(shouldRetryDelivery({ attempts: 1, last_try_at: ago(DELIVERY_RETRY_AFTER_MS) }, now)).toBe(true);
  });
  it("não reenvia enquanto a tentativa ainda pode estar rodando", () => {
    expect(shouldRetryDelivery({ attempts: 1, last_try_at: ago(60_000) }, now)).toBe(false);
  });
  it("para depois de 3 tentativas", () => {
    expect(shouldRetryDelivery({ attempts: 3, last_try_at: ago(3_600_000) }, now)).toBe(false);
  });
});
