/**
 * Caso Karen (10/11/2026): silêncio garantido em confirmação sem contexto, espera pela reserva, vínculo na
 * chegada da reserva, nova tentativa com raciocínio curto após saída truncada e travas do roteiro.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isAccommodationCheck, isAffirmativeStatement, isBareAcknowledgment, isSatisfiedCheckReply, shouldSilenceBareAck } from "@/lib/guest-ai/ack-silence";
import type { HistoryEntry } from "@/lib/guest-ai/history";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { waitForReservationCode } from "@/lib/chat/reservation-wait";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";

const SRC = path.resolve(__dirname, "../../..");
const e = (speaker: string, text: string, media: unknown = null): HistoryEntry =>
  ({ ref: "r", messageId: "m", speaker, channel: "airbnb", at: "", text, media, delivery: "recorded", current: false }) as unknown as HistoryEntry;

describe("Silêncio em confirmação/cortesia sem contexto", () => {
  it("reconhece só confirmação/cortesia (pt/en/es, emoji); pergunta, saudação ou conteúdo não", () => {
    for (const t of ["Sim", "sim!", "Ok", "Obrigada 🙏", "Tá bom", "Combinado.", "👍", "Perfeito, obrigado", "thanks", "Gracias"])
      expect(isBareAcknowledgment(t), t).toBe(true);
    for (const t of ["Sim?", "Boa noite", "Sim, qual o horário do check-in", "Ok, chego às 15h", "Tem estacionamento", "", "13h"])
      expect(isBareAcknowledgment(t), t).toBe(false);
  });

  it("\"Sim\" como primeira mensagem (caso Karen) ⇒ silêncio; após afirmação nossa ⇒ silêncio", () => {
    expect(shouldSilenceBareAck([e("guest", "Sim")])).toBe(true);
    expect(shouldSilenceBareAck([e("system", "Código da Reserva: HMX"), e("guest", "Ok"), e("guest", "Obrigada")])).toBe(true);
    expect(shouldSilenceBareAck([e("ai", "O check-in é às 15h."), e("guest", "Obrigado!")])).toBe(true);
  });

  it("\"Sim\" respondendo a uma pergunta nossa ⇒ a conversa segue", () => {
    expect(shouldSilenceBareAck([e("ai", "Quer que eu envie o passo a passo da chegada?"), e("guest", "Sim")])).toBe(false);
    expect(shouldSilenceBareAck([e("team", "Vocês chegam de carro?"), e("guest", "sim")])).toBe(false);
  });

  it("conteúdo real, pergunta ou foto nunca são calados", () => {
    expect(shouldSilenceBareAck([e("guest", "Ok"), e("guest", "Tem contato de WhatsApp?")])).toBe(false);
    expect(shouldSilenceBareAck([e("guest", "", { kind: "image" })])).toBe(false);
    expect(shouldSilenceBareAck([])).toBe(false);
  });
});

const ON = { GUEST_AI_AUTONOMOUS: "on" };
const REQ = { surface: "airbnb" as const, conversationId: "c1", messageId: "m1" };
const deps = (result: Record<string, unknown>) => ({
  env: ON,
  validate: async () => ({ propertyId: "p1" }),
  humanActive: async () => false,
  pendingDecision: async () => false,
  openDecision: async () => ({ opened: false, code: "not_an_exception" }),
  generate: async () => ({ status: "stored", state: "available", result: { text: "Olá! Que ótimo.", handoffNeeded: false, handoffUrgency: null, internalQuestion: null, formalChangeRequests: [], ...result } }),
});

describe("Slot · trava em código acima do modelo", () => {
  it("modelo escreveu resposta para um \"Sim\" sem contexto ⇒ NADA vai ao hóspede", async () => {
    expect(await requestGuestAiReply(REQ, deps({ bareAckWithoutQuestion: true }) as never)).toEqual({ reply: "", handoff: false });
  });
  it("sem a marca, a resposta segue; com encaminhamento ou alteração formal, nunca é calada", async () => {
    expect(await requestGuestAiReply(REQ, deps({ bareAckWithoutQuestion: false }) as never)).toEqual({ reply: "Olá! Que ótimo.", handoff: false });
    expect((await requestGuestAiReply(REQ, deps({ bareAckWithoutQuestion: true, handoffNeeded: true }) as never))?.handoff).toBe(true);
    expect((await requestGuestAiReply(REQ, deps({ bareAckWithoutQuestion: true, formalChangeRequests: ["cancellation"] }) as never))?.handoff).toBe(true);
  });
});

describe("Reserva que chega depois da mensagem", () => {
  it("espera a reserva chegar (relê o banco) e devolve o código; desiste no limite", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    expect(await waitForReservationCode(async () => (++n >= 3 ? "HMMAXCFSYA" : null), { sleep })).toBe("HMMAXCFSYA");
    expect(sleep).toHaveBeenCalledTimes(3);
    const never = vi.fn(async () => null);
    expect(await waitForReservationCode(never, { sleep, maxMs: 10_000, stepMs: 2_500 })).toBeNull();
    expect(never).toHaveBeenCalledTimes(4);
    expect(await waitForReservationCode(async () => { throw new Error("x"); }, { sleep, maxMs: 5_000 })).toBeNull();
  });

  it("canal espera a reserva pendente ANTES da IA e a chegada da reserva vincula a conversa existente", () => {
    const msg = readFileSync(path.join(SRC, "lib/channex-messages.server.ts"), "utf8");
    expect(msg.indexOf("waitForReservationCode(")).toBeGreaterThan(0);
    expect(msg.indexOf("waitForReservationCode(")).toBeLessThan(msg.indexOf("requestGuestAiReply({"));
    expect(msg).toMatch(/export async function linkAirbnbConversationsForBooking/);
    expect(msg).toMatch(/\.is\("reservation_id", null\)/);
    const hook = readFileSync(path.join(SRC, "lib/channex-webhook.server.ts"), "utf8");
    expect(hook).toMatch(/linkAirbnbConversationsForBooking\(admin, \{/);
    expect(hook).toMatch(/a\.status !== "cancelled" && contacts\.code/);
  });
});

describe("Roteiro e raciocínio", () => {
  it("travas: nunca \"formalizar a reserva\" em resposta curta ou a quem já reservou; sem contexto, não presumir", () => {
    const p = JSON.stringify(buildSystemPrompt("airbnb" as never));
    expect(p).toMatch(/nunca sugira formalizar ou concluir a reserva em resposta a uma mensagem curta/);
    expect(p).toMatch(/Sem contexto, não presuma/);
  });
  it("saída truncada pelo raciocínio ⇒ UMA nova tentativa com raciocínio low (padrão segue auto)", () => {
    const g = readFileSync(path.join(SRC, "lib/guest-ai/copilot/generate.server.ts"), "utf8");
    expect(g).toMatch(/error === "truncated_response" \|\| generator\.telemetry\(\)\.error === "timeout"/);
    expect(g).toMatch(/COPILOT_AUTO_CALL_MAX_MS = 20_000/); // 12/11/2026 (caso Gilmar): era 12 s
    expect(g).toMatch(/effort \? \{\} : \{ callTimeoutMs: COPILOT_AUTO_CALL_MAX_MS \}/);
    expect(g).toMatch(/generator = makeGenerator\("low"\)/);
    expect(g).toMatch(/reasoningEffort: effort \?\? COPILOT_REASONING_EFFORT/);
  });
});

describe("Resposta afirmativa sem a nossa pergunta (caso Karen, 11/11/2026)", () => {
  it("\"Sim! Estou reservado para o meu marido e 2 amigos…\" como primeira mensagem ⇒ silêncio", () => {
    const t = "Sim! Estou reservado para o meu marido e 2 amigos que estão viajando a trabalho.";
    expect(isAffirmativeStatement(t)).toBe(true);
    expect(shouldSilenceBareAck([e("guest", t)])).toBe(true);
  });

  it("pergunta, pedido ou horário nunca são silenciados; pergunta nossa pendente segue a conversa", () => {
    for (const t of ["Sim, qual o horário do check-in", "Sim, gostaria de saber do Wi-Fi", "Ok, chego às 15h", "Sim, chegamos as 14:30", "Sim? Pode ser?", "Boa noite, tudo bem"])
      expect(isAffirmativeStatement(t), t).toBe(false);
    expect(shouldSilenceBareAck([e("ai", "Vão ser quantas pessoas?"), e("guest", "Sim! Somos o casal e 2 amigos.")])).toBe(false);
  });
});

describe("Checagem do imóvel respondida com satisfação ⇒ sem tréplica (caso Jenifer, 11/11/2026)", () => {
  const check = "Boa noite, Jenifer! Não se preocupe, muito obrigada por avisar. Vocês encontraram tudo certinho no apartamento?";

  it("\"Encontramos sim. Um apartamento muito bonito.\" ⇒ silêncio", () => {
    expect(isAccommodationCheck(check)).toBe(true);
    expect(isSatisfiedCheckReply("Encontramos sim. Um apartamento muito bonito.")).toBe(true);
    expect(shouldSilenceBareAck([e("ai", check), e("guest", "Encontramos sim. Um apartamento muito bonito.")])).toBe(true);
  });

  it("outras confirmações de satisfação também encerram (inclusive em rajada)", () => {
    for (const t of ["Tudo certo por aqui", "Tudo perfeito!", "Sim", "Sim, tudo ótimo 😊", "Amamos, muito aconchegante"])
      expect(shouldSilenceBareAck([e("ai", check), e("guest", t)]), t).toBe(true);
    expect(shouldSilenceBareAck([e("ai", check), e("guest", "Encontramos sim"), e("guest", "Lindo o apartamento")])).toBe(true);
  });

  it("ressalva, problema, pergunta ou pedido ⇒ o modelo responde", () => {
    for (const t of [
      "Encontramos sim, mas faltou toalha",
      "Tudo certo, só que o ar não liga",
      "Sim! Qual a senha do Wi-Fi?",
      "Lindo, mas está um pouco sujo",
      "Não encontramos o controle",
      "Tudo certo, pode me mandar o endereço do mercado",
      "Encontramos sim, chegamos às 22h",
    ])
      expect(shouldSilenceBareAck([e("ai", check), e("guest", t)]), t).toBe(false);
  });

  it("nossa mensagem com outra pergunta (ou duas perguntas) não é checagem pura ⇒ a conversa segue", () => {
    expect(isAccommodationCheck("Que horas vocês chegam?")).toBe(false);
    expect(isAccommodationCheck("Encontraram tudo certinho? Precisam de mais toalhas?")).toBe(false);
    expect(shouldSilenceBareAck([e("ai", "Que horas vocês chegam?"), e("guest", "Tudo certo")])).toBe(false);
  });

  it("elogio espontâneo, sem checagem nossa, continua indo ao modelo", () => {
    expect(shouldSilenceBareAck([e("ai", "As toalhas extras estão no armário."), e("guest", "Apartamento muito bonito")])).toBe(false);
  });
});
