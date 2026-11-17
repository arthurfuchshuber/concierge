import { describe, expect, it } from "vitest";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import type { HistoryResult } from "@/lib/guest-ai/history";
import { bookingNoteSilence } from "@/lib/guest-ai/validation/booking-note";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";

const reply = (over: Partial<ModelDecision> = {}): ModelDecision =>
  ({
    reply: "Boa noite, Felipe. Sejam muito bem-vindos.",
    strategy: "answer",
    shouldReply: true,
    intents: ["acknowledgment", "other"],
    formalChangeRequests: [],
    hospitalityMilestone: null,
    handoff: { needed: false, question: null, urgency: null },
    commitments: [],
    commitmentKinds: [],
    credentialIntent: "none",
    groundedOn: [],
    ...over,
  }) as unknown as ModelDecision;

const hist = (...guest: Array<string | { text: string; media: true }>): HistoryResult =>
  ({
    status: "available",
    conversationId: "c",
    currentMessageId: "m" + guest.length,
    counts: {},
    entries: [
      { ref: "hist:system:h1", messageId: "s1", speaker: "system", channel: "airbnb", at: "", text: "Reserva confirmada", media: null, delivery: "delivered", current: false },
      ...guest.map((g, i) => ({
        ref: `hist:guest:h${i + 2}`,
        messageId: "m" + (i + 1),
        speaker: "guest",
        channel: "airbnb",
        at: "",
        text: typeof g === "string" ? g : g.text,
        media: typeof g === "string" ? null : { kind: "image", durationMs: null, derivedText: { status: "missing" } },
        delivery: "delivered",
        current: i === guest.length - 1,
      })),
    ],
  }) as unknown as HistoryResult;

const FELIPE = "Boa noite. Tudo bem? Somos três funcionários públicos que estamos indo para a cidade a trabalho. Pode ficar tranquilo com relação à todas as regras. Obrigado.";
const NOTA = "Boa noite. Somos três funcionários públicos indo a trabalho. Pode ficar tranquilo com as regras. Obrigado.";

describe("nota no ato da reserva vira silêncio (casos Simone e Felipe, 17/11/2026)", () => {
  it("afirmação sem pergunta, reserva recém-feita ⇒ silêncio", () => {
    const d = bookingNoteSilence(reply(), { bookedMinutesAgo: 1, history: hist(NOTA) });
    expect(d.strategy).toBe("silence");
    expect(d.reply).toBe("");
    expect(d.shouldReply).toBe(false);
  });

  it("'tudo bem?' é cortesia: a nota do Felipe vira silêncio", () => {
    expect(bookingNoteSilence(reply(), { bookedMinutesAgo: 1, history: hist(FELIPE) }).strategy).toBe("silence");
  });

  it("pergunta de verdade segue para o modelo decidir", () => {
    expect(bookingNoteSilence(reply(), { bookedMinutesAgo: 1, history: hist("Boa noite, tudo bem? Que horas é o check-in?") }).strategy).toBe("answer");
  });

  it("fora da janela da reserva recém-feita não age", () => {
    expect(bookingNoteSilence(reply(), { bookedMinutesAgo: null, history: hist(NOTA) }).strategy).toBe("answer");
  });

  it.each([
    ["pergunta informativa", { intents: ["informational_query"] }],
    ["pedido", { intents: ["operational_request"] }],
    ["alteração (pet, mais pessoas)", { intents: ["formal_change_request"], formalChangeRequests: ["guest_count"] }],
    ["encaminhamento", { handoff: { needed: true, question: "?", urgency: "normal" } }],
    ["compromisso", { commitments: ["x"] }],
    ["credencial", { credentialIntent: "would_deliver" }],
  ])("nunca silencia %s", (_n, over) => {
    expect(bookingNoteSilence(reply(over as Partial<ModelDecision>), { bookedMinutesAgo: 1, history: hist(NOTA) }).strategy).not.toBe("silence");
  });

  it("mensagem com foto não é silenciada", () => {
    expect(bookingNoteSilence(reply(), { bookedMinutesAgo: 1, history: hist({ text: NOTA, media: true }) }).strategy).toBe("answer");
  });

  it("rajada: qualquer mensagem do turno com pergunta mantém a resposta", () => {
    expect(bookingNoteSilence(reply(), { bookedMinutesAgo: 2, history: hist(NOTA, "Tem garagem?") }).strategy).toBe("answer");
  });
});

describe("roteiro: pré-estadia sem pergunta não pede resposta", () => {
  const sys = buildSystemPrompt("airbnb");
  it("padrão de responder a apresentações vale para consulta, não para reserva confirmada", () => {
    expect(sys).toMatch(/Em consulta \(inquiry\), cumprimento, apresentação/);
    expect(sys).not.toMatch(/pré-estadia e primeiro contato: ali uma mensagem sem resposta/);
    expect(sys).toMatch(/Com a reserva já confirmada \(pre_stay\)/);
    expect(sys).toMatch(/responda apenas a esse ponto/);
  });
});
