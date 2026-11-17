import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOOKING_LINK_WAIT_MS, shouldAwaitBooking } from "@/lib/channex-messages.server";

// Caso Simone (17/11/2026): reserva instantânea; a mensagem chegou 21 s antes do booking e a IA a tratou como consulta
// ("você pode concluir a reserva pela plataforma") para uma hóspede já confirmada.
describe("mensagem que chega antes da reserva", () => {
  it("sem reserva ligada e sem consulta registrada ⇒ espera a reserva", () => {
    expect(shouldAwaitBooking({ reservationLinked: false, hasInquiry: false })).toBe(true);
  });
  it("com consulta registrada (é consulta de fato) ou reserva já ligada ⇒ não espera", () => {
    expect(shouldAwaitBooking({ reservationLinked: false, hasInquiry: true })).toBe(false);
    expect(shouldAwaitBooking({ reservationLinked: true, hasInquiry: false })).toBe(false);
  });
  it("a espera cobre os atrasos vistos (Karen 19 s, Simone 22 s) e só existe no turno longo", () => {
    expect(BOOKING_LINK_WAIT_MS).toBeGreaterThanOrEqual(40_000);
    const src = readFileSync("src/lib/channex-messages.server.ts", "utf8");
    expect(src).toMatch(/if \(opts\.longTurn\) await waitForBookingLink\(admin, p\.convId, p\.threadId\);/);
    // a espera vem ANTES de pedir a geração
    expect(src.indexOf("await waitForBookingLink(admin, p.convId, p.threadId)")).toBeLessThan(src.indexOf("const ai = await requestGuestAiReply({"));
  });
});

import { composeTurnPrompt } from "@/lib/guest-ai/composer";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { conversationContext, CONV, MSG, row, TEST_GUARD } from "./helpers/b21-fixtures";

describe("mensagem escrita no ato da reserva", () => {
  const compose = (bookedMinutesAgo: number | null) => {
    const base = conversationContext({ phase: "pre_stay" });
    const stay = { ...(base.guest.stay as object), bookedMinutesAgo };
    const context = { ...base, guest: { ...base.guest, stay } } as never;
    const history = normalizeHistory([row({ id: MSG, created_at: "2026-11-17T19:19:39Z", content: "Vamos ao festival com as crianças." })], { conversationId: CONV, currentMessageId: MSG });
    const r = composeTurnPrompt({ context, history }, { guard: TEST_GUARD });
    if (r.kind !== "prompt") throw new Error(r.kind);
    return r.prompt.messages[0]!.content as string;
  };
  it("reserva recém-gravada ⇒ fato com os minutos; reserva antiga ⇒ sem fato", () => {
    expect(compose(1)).toContain('"id":"ctx:reserva_feita_ha_minutos","valor":1');
    expect(compose(null)).not.toContain("ctx:reserva_feita_ha_minutos");
  });
  it("prompt: afirmação no ato da reserva sem pergunta ⇒ silêncio; inquiry que só conta a viagem ⇒ resposta curta, sem vender", () => {
    const pre = buildSystemPrompt("airbnb", undefined, { phase: "pre_stay" });
    expect(pre).toMatch(/mensagem escrita no ato da reserva \(ctx:reserva_feita_ha_minutos/);
    expect(pre).toMatch(/fique em silêncio/);
    const inq = buildSystemPrompt("airbnb", undefined, { phase: "inquiry" });
    expect(inq).toMatch(/só se apresenta ou conta o motivo da viagem não é dúvida esclarecida/);
  });
});
