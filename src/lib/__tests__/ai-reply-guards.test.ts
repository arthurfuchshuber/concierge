import { describe, expect, it } from "vitest";
import { nextAiReplyDueAt, parseChannexMessage } from "../channex-messages.server";
import { withDbDeadline } from "../ai/rag.server";

describe("janela de resposta da IA", () => {
  it("espera 15 s após a última mensagem", () => {
    expect(nextAiReplyDueAt(1_000_000, 1_000_000)).toBe(new Date(1_015_000).toISOString());
  });
  it("nunca passa de 30 s após a primeira mensagem", () => {
    expect(nextAiReplyDueAt(1_025_000, 1_000_000)).toBe(new Date(1_030_000).toISOString());
  });
});

describe("parseChannexMessage", () => {
  it("lê booking_id da raiz do webhook", () => {
    const m = parseChannexMessage({ booking_id: "b1", payload: { message: "oi", message_thread_id: "t1", ota_message_id: "o1" } });
    expect(m?.bookingId).toBe("b1");
    expect(m?.otaMessageId).toBe("o1");
  });
});

describe("prazo das consultas ao banco", () => {
  it("devolve null quando a consulta passa do prazo", async () => {
    expect(await withDbDeadline(new Promise(() => {}), 20)).toBeNull();
  });
});
