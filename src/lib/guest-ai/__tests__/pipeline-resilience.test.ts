/**
 * Resiliência do pipeline do Copiloto (diretriz de 07/11/2026): emojis reais não derrubam a composição
 * (`guard_failed`), a corrida webhook × vínculo da reserva não gera `reservation_conversation_mismatch`, seções
 * opcionais isoladas, verdade estrita do dossiê e fim das muletas. Puro / bancos falsos.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SECRET_MARKER, SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { composeTurnPrompt } from "@/lib/guest-ai/composer";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { buildGuestContext, type BuilderDeps } from "@/lib/guest-ai/context/builder.server";
import { fetchDossierKnowledge, type BuildPlaybookFn } from "@/lib/guest-ai/data/dossier.server";
import { validateTurnScope } from "@/lib/guest-ai/data/scope.server";
import { checkContextIntegrity } from "@/lib/guest-ai/turn-chain";
import { CITY_EVENTS_TAG, CONTEXT_TAG, buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { issue } from "@/lib/guest-ai/trust";
import type { ConversationContext } from "@/lib/guest-ai/orchestrator/contracts";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { CONV, MSG, conversationContext, row } from "./helpers/b21-fixtures";
import { IDS, makeDb } from "./helpers/fixtures";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(ROOT, "..", "..");

// ─────────────────────────── A. emojis Unicode ───────────────────────────

const REAL_EMOJI_TEXTS = [
  "Studio 105 👩‍🍳 cozinha completa para você preparar suas refeições",
  "Dias de sol ☀️ e piscina aquecida",
  "Feito com ❤️ pela equipe",
  "🗓️ Check-in a partir das 15h",
  "Joinha 👍🏽 e aceno 👋🏿",
  "Família 👨‍👩‍👧‍👦 bem-vinda; casal 👩‍❤️‍👨",
  "Bandeiras 🇧🇷 🏳️‍🌈 🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "Andar 1️⃣ · quarto #️⃣2",
  "Texto com acento decomposto: café", // e + U+0301 (NFD)
];

describe("A · secret-scrub preserva emojis compostos byte a byte", () => {
  it.each(REAL_EMOJI_TEXTS)("safe e sem adulteração: %s", (t) => {
    const r = SECRET_SCRUBBER.scan(t);
    expect(r.status).toBe("safe");
    expect(r.text).toBe(t);
    expect(r.findings).toEqual([]);
    // idempotente: a segunda varredura (a do composer) também é safe e igual
    const again = SECRET_SCRUBBER.scan(r.text);
    expect(again).toEqual({ status: "safe", text: t, findings: [] });
  });

  it("invisível suspeito fora de emoji é removido sem derrubar nada (sanitized, nunca falha)", () => {
    const rlo = "Bem-vindo‮ ao apê";
    const r = SECRET_SCRUBBER.scan(rlo);
    expect(r).toEqual({
      status: "sanitized",
      text: "Bem-vindo ao apê",
      findings: [{ category: "hidden_character", detector: "normalization" }],
    });
    expect(SECRET_SCRUBBER.scan("ola​mundo").text).toBe("olamundo");
    // ZWJ solto entre letras (não emoji) sai
    expect(SECRET_SCRUBBER.scan("a‍b").text).toBe("ab");
    // a segunda varredura do texto limpo é safe e igual
    expect(SECRET_SCRUBBER.scan(r.text)).toEqual({ status: "safe", text: r.text, findings: [] });
  });

  it("emoji não vira esconderijo de segredo: ZWJ entre dígitos sai e a senha é detectada", () => {
    const r = SECRET_SCRUBBER.scan("A senha da porta é 4‍8‍2‍1, qualquer coisa chame.");
    expect(r.status).not.toBe("safe");
    expect(r.text).toContain(SECRET_MARKER);
    expect(r.text).not.toMatch(/4.?8.?2.?1/);
    const withEmoji = SECRET_SCRUBBER.scan("👩‍🍳 Senha do wifi: Praia2024 ☀️");
    expect(withEmoji.text).toContain("👩‍🍳");
    expect(withEmoji.text).toContain("☀️");
    expect(withEmoji.text).not.toContain("Praia2024");
  });

  it("composição com texto do dossiê/histórico cheio de emojis não falha mais (guard_failed)", () => {
    const h = normalizeHistory(
      [row({ id: MSG, content: "Oi! 👩‍🍳 A cozinha tem air fryer? ☀️❤️👍🏽" })],
      { conversationId: CONV, currentMessageId: MSG },
    );
    const r = composeTurnPrompt(
      { context: conversationContext(), history: h },
      { guard: SECRET_SCRUBBER },
    );
    expect(r.kind).toBe("prompt");
    if (r.kind === "prompt") expect(r.prompt.messages[0]!.content).toContain("👩‍🍳");
  });
});

// ─────────────────────────── B. corrida webhook × vínculo ───────────────────────────

const fakeBuild: BuildPlaybookFn = (src) => [
  {
    rows: [
      {
        id: "f:titulo_publico",
        label: "Título",
        value: String(src.property["name"] ?? ""),
        raw: "",
        empty: false,
        secret: false,
        au: "P",
        note: "",
      },
    ],
  },
];
const deps = (db: ReturnType<typeof makeDb>, extra: Partial<BuilderDeps> = {}): BuilderDeps => ({
  db,
  now: () => new Date("2026-11-11T12:00:00Z"),
  credentials: "skip",
  fetchDossierKnowledge: (turn, aud, d) =>
    fetchDossierKnowledge(turn, aud, { ...d, buildPlaybook: fakeBuild }),
  ...extra,
});
const guide = { surface: "guide_chat", conversationId: IDS.conv1, messageId: IDS.msg1 } as const;

describe("B · conversa ainda sem reserva vinculada: degradação graciosa, sem mismatch", () => {
  it("turno validado ANTES do vínculo + conversa já vinculada no banco: o contexto segue o mesmo retrato (consulta)", async () => {
    const db = makeDb(); // no banco a conversa já tem reservation_id (o vínculo terminou depois do turno)
    const real = await validateTurnScope(guide, { db });
    expect(real.reservationId).toBe(IDS.res1);
    // retrato do turno no momento da validação (antes do vínculo)
    const snapshot = issue("turn", { ...real, reservationId: null }) as ValidatedTurn;
    const g = await buildGuestContext(guide, deps(db, { validateTurnScope: async () => snapshot }));
    expect(g.stay).toBeNull();
    expect(g.phase).toBe("inquiry");
    expect(g.audiences).toEqual(["P"]);
    expect(g.credentials).toBeNull();
    const ctx = {
      guest: g,
      credentialPolicy: { decision: "deny", reason: "x" },
      humanOwnership: { openCaseCount: 0, cases: [] },
    } as unknown as ConversationContext;
    expect(checkContextIntegrity(snapshot, ctx)).toBeNull();
  });

  it("o Copiloto monta o contexto com o MESMO turno já validado (nunca revalida a conversa no meio)", () => {
    const src = readFileSync(path.join(ROOT, "copilot", "generate.server.ts"), "utf8");
    expect(src).toMatch(/\{ db, validateTurnScope: async \(\) => t \}/);
  });

  it("Airbnb: o vínculo da reserva termina (await) ANTES do disparo do Copiloto", () => {
    const src = readFileSync(path.join(SRC, "lib", "channex-messages.server.ts"), "utf8");
    const link = src.indexOf("await link.linkConversationByCode(");
    const trigger = src.indexOf("await triggerCopilotSuggestion(");
    expect(link).toBeGreaterThan(0);
    expect(trigger).toBeGreaterThan(link);
  });

  it("estadia de OUTRA reserva no contexto continua recusada (proteção mantida)", () => {
    const turn = issue("turn", {
      surface: "guide_chat",
      conversationId: CONV,
      messageId: MSG,
      propertyId: "p1",
      tenantId: "t1",
      guestSessionId: "s",
      conversationStatus: "ai",
      reservationId: null,
      messageCreatedAt: null,
    }) as ValidatedTurn;
    const ctx = conversationContext({
      interlocutor: { guestId: "s", conversationId: CONV, messageId: MSG, surface: "guide_chat", guestName: null },
    });
    expect(checkContextIntegrity(turn, ctx)).toBe("reservation_conversation_mismatch");
  });
});

// ─────────────────────────── D. seções opcionais isoladas ───────────────────────────

describe("D · seção opcional com texto inseguro é isolada, a sugestão segue", () => {
  it("evento com texto ambíguo é omitido; o restante compõe normalmente", () => {
    const h = normalizeHistory([row({ id: MSG, content: "Tem algo para fazer hoje?" })], {
      conversationId: CONV,
      currentMessageId: MSG,
    });
    const guard = {
      id: "test-guard",
      version: "1",
      scan(text: string) {
        if (text === "GUARDA_FALHA")
          return {
            status: "ambiguous" as const,
            text: "[segredo removido]",
            findings: [{ category: "password", detector: "structural" }],
          };
        if (text.includes("7319-CANARIO"))
          return {
            status: "sanitized" as const,
            text: text.replace("7319-CANARIO", "[x]"),
            findings: [{ category: "password", detector: "structural" }],
          };
        return { status: "safe" as const, text, findings: [] };
      },
    };
    const r = composeTurnPrompt(
      {
        context: conversationContext(),
        history: h,
        cityEvents: {
          status: "available",
          city: "Floripa",
          today: "2026-11-07",
          items: [
            {
              id: "evt-00000001",
              title: "Feira",
              category: "evento",
              startDate: "2026-11-08",
              endDate: null,
              venue: null,
              summary: "GUARDA_FALHA",
            },
            {
              id: "evt-00000002",
              title: "Show",
              category: "evento",
              startDate: "2026-11-08",
              endDate: null,
              venue: null,
              summary: "Ao ar livre",
            },
          ],
        },
      },
      { guard },
    );
    expect(r.kind).toBe("prompt");
    if (r.kind !== "prompt") return;
    const user = r.prompt.messages[0]!.content;
    const ev = JSON.parse(
      user.slice(
        user.indexOf("\n", user.indexOf(`<${CITY_EVENTS_TAG}`)) + 1,
        user.indexOf(`</${CITY_EVENTS_TAG}>`),
      ),
    );
    expect(ev.itens.map((i: { titulo: string }) => i.titulo)).toEqual(["Show"]);
    expect(r.prompt.sourceIds!.has("evt:evt-00000001")).toBe(false);
  });
});

// ─────────────────────────── C. verdade estrita e fim das muletas ───────────────────────────

describe("C · verdade estrita do dossiê, check-in antecipado/malas e fim das muletas", () => {
  const sys = buildSystemPrompt("airbnb");
  it("comodidade só existe se declarada no dossiê", () => {
    expect(sys).toMatch(
      /Só afirme que existe uma comodidade, serviço ou instalação \(guarda-volumes, maleiro/,
    );
    expect(sys).toMatch(/O que não estiver declarado não existe para você/);
  });
  it("pedido de check-in antecipado/malas: horário oficial com franqueza, sem inventar maleiro, sem pergunta burocrática", () => {
    expect(sys).toMatch(/o horário oficial de check-in é o padrão; diga que faremos o possível para liberar o acesso antes/); // diretiva 11/11/2026
    expect(sys).toMatch(/a acomodação não dispõe de local para deixar as malas antes da liberação/);
    expect(sys).toMatch(
      /Nunca diga que dá para deixar ou desembarcar as malas enquanto o espaço é preparado/,
    );
    expect(sys).toMatch(
      /não faça perguntas que não mudam a resposta \(como quantas malas a pessoa tem\)/,
    );
    // a pergunta "você combinou com a equipe?" fica só para quem JÁ chegou
    expect(sys).toMatch(/Se o hóspede disser que JÁ chegou e quer entrar antes do horário oficial/);
  });
  it("sem muletas de transferência no texto ao hóspede (o encaminhamento é estruturado)", () => {
    for (const phrase of [
      "'vou avisar a equipe'",
      "'transferindo para o time humano'",
      "'nossa equipe já foi acionada'",
    ])
      expect(sys).toContain(phrase);
    expect(sys).toMatch(
      /O encaminhamento à equipe é feito pelos campos estruturados \(handoff, formalChangeRequests\), que o hóspede não vê/,
    );
    expect(sys).not.toMatch(/Você pode dizer que a equipe vai verificar/);
  });

  it("cenário Gustavo: imóvel com check-in às 15h e sem maleiro — o prompt leva o horário oficial e nenhum guarda-volumes", () => {
    const h = normalizeHistory(
      [
        row({
          id: MSG,
          channel: "airbnb",
          content: "Tem a possibilidade do check in antecipado? Para as 11h da manhã?",
        }),
      ],
      { conversationId: CONV, currentMessageId: MSG },
    );
    const ctx = conversationContext({
      interlocutor: {
        guestId: "airbnb:1",
        conversationId: CONV,
        messageId: MSG,
        surface: "airbnb",
        guestName: null,
      },
      stay: {
        reservationId: "r1",
        phase: "pre_stay",
        status: "confirmed",
        checkInAt: "2026-11-10T18:00:00.000Z",
        checkOutAt: "2026-11-12T14:00:00.000Z",
        timezone: "America/Sao_Paulo",
      },
    });
    const r = composeTurnPrompt({ context: ctx, history: h }, { guard: SECRET_SCRUBBER });
    expect(r.kind).toBe("prompt");
    if (r.kind !== "prompt") return;
    const user = r.prompt.messages[0]!.content;
    const data = user.slice(user.indexOf(`<${CONTEXT_TAG}>`), user.indexOf(`</${CONTEXT_TAG}>`));
    expect(data).toContain("2026-11-10T18:00:00.000Z"); // 15:00 em São Paulo
    expect(user).not.toMatch(/guarda-volumes|maleiro|bagage/i);
    expect(r.prompt.system).toMatch(/a acomodação não dispõe de local para deixar as malas/);
  });
});
