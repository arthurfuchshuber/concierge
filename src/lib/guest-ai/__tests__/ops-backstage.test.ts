/**
 * BASTIDORES + CORRIDA PROTEGIDA (08/11/2026). Nada toca a produção: transporte falso, sem rede.
 * Cobre: entrada mínima do extrator (turno corrente do hóspede, varredura de segredos, sem fuso ⇒ nada),
 * validação estrita da saída (ids só do turno corrente, horário/data bem formados, marco exige trecho),
 * extração ponta a ponta com o Gateway real (caso real de 08/11: "Então vamos sair por volta das 9:00"),
 * falha do extrator ⇒ `null`, a geração rodando os bastidores mesmo quando a resposta falha, e a corrida
 * protegida do gerador (Titular lento ⇒ Reserva em paralelo vence; Titular rápido ⇒ Reserva nem dispara).
 */
import { describe, expect, it } from "vitest";
import {
  buildOpsExtractorInput,
  extractOpsSignals,
  hasOpsSignal,
  parseOpsSignals,
  OPS_EXTRACTOR_SYSTEM,
} from "@/lib/guest-ai/copilot/ops-extractor.server";
import { createCopilotGenerator, hedgeDelayMs } from "@/lib/guest-ai/copilot/generator.server";
import type { HistoryResult } from "@/lib/guest-ai/history";
import type { ProviderOutcome, ProviderRequest } from "@/lib/guest-ai/llm/providers/types";
import { llmMessageText } from "@/lib/guest-ai/llm/contracts";
import { GUEST_AI_DEFAULT_MODEL, GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { fakeProvider, okJson } from "./helpers/copilot-provider";
import type { ComposedPrompt } from "@/lib/guest-ai/orchestrator/contracts";

const TZ = "America/Sao_Paulo";

function hist(entries: Array<{ speaker: "guest" | "team"; text: string; at: string }>): HistoryResult {
  const counters: Record<string, number> = {};
  return {
    status: "available",
    entries: entries.map((e, i) => {
      counters[e.speaker] = (counters[e.speaker] ?? 0) + 1;
      return {
        ref: `hist:${e.speaker}:h${i + 1}`,
        messageId: `m${i + 1}`,
        speaker: e.speaker,
        channel: "airbnb",
        at: e.at,
        text: e.text,
        media: null,
        delivery: "delivered",
        current: i === entries.length - 1,
      };
    }),
  } as unknown as HistoryResult;
}

/** Conversa real de 08/11/2026 (Apê Aconchegante): saída prevista pelo hóspede + pergunta sobre a chave. */
const FERNANDA = hist([
  { speaker: "team", text: "Infelizmente não, Fernanda, pois após a nossa equipe de limpeza finalizar o apartamento...", at: "2026-11-08T22:25:00Z" },
  { speaker: "guest", text: "Então vamos sair por volta das 9:00", at: "2026-11-08T23:10:00Z" },
  { speaker: "guest", text: "Pra quem deixamos a chave?", at: "2026-11-08T23:10:30Z" },
]);

const baseInput = (over: Partial<Parameters<typeof extractOpsSignals>[0]> = {}) => ({
  history: FERNANDA,
  phase: "in_stay" as const,
  timezone: TZ,
  checkInAt: "2026-11-04T18:00:00Z",
  checkOutAt: "2026-11-09T14:00:00Z",
  now: new Date("2026-11-08T23:11:00Z"),
  traceId: "t-backstage",
  remainingMs: () => 20_000,
  signal: new AbortController().signal,
  ...over,
});

describe("Bastidores · entrada mínima do extrator", () => {
  it("turno corrente = mensagens do hóspede no fim; datas e 'agora' no fuso do imóvel; sem dossiê nem credenciais", () => {
    const b = buildOpsExtractorInput(baseInput())!;
    expect(b.currentRefs).toEqual(["hist:guest:h2", "hist:guest:h3"]);
    const payload = JSON.parse(b.user.slice(b.user.indexOf("\n") + 1));
    expect(payload.data_de_saida).toBe("2026-11-09");
    expect(payload.agora_no_imovel).toBe("2026-11-08 20:11");
    expect(payload.mensagens.filter((m: { atual: boolean }) => m.atual)).toHaveLength(2);
    expect(b.user).not.toMatch(/dossi|senha|wifi/i);
  });
  it("sem fuso, sem histórico ou sem mensagem do hóspede no fim ⇒ nada a extrair (sem chamada)", () => {
    expect(buildOpsExtractorInput(baseInput({ timezone: null }))).toBeNull();
    expect(buildOpsExtractorInput(baseInput({ history: null }))).toBeNull();
    expect(
      buildOpsExtractorInput(baseInput({ history: hist([{ speaker: "team", text: "Bom dia!", at: "2026-11-08T12:00:00Z" }]) })),
    ).toBeNull();
  });
  it("o prompt do extrator não pede resposta ao hóspede e exige JSON", () => {
    expect(OPS_EXTRACTOR_SYSTEM).toMatch(/JSON/);
    expect(OPS_EXTRACTOR_SYSTEM).toMatch(/Não escreva resposta ao hóspede/);
  });
});

describe("Bastidores · validação estrita da saída", () => {
  const cur = ["hist:guest:h2", "hist:guest:h3"];
  it("previsão bem formada citando o turno corrente passa", () => {
    const s = parseOpsSignals(
      { hospitalityMilestone: null, milestoneQuote: null, guestEtas: [{ card: "checkout", date: "2026-11-09", time: "09:00", evidence: ["hist:guest:h2"], quote: "vamos sair por volta das 9:00" }] },
      cur,
    );
    expect(s.guestEtas).toEqual([{ card: "checkout", date: "2026-11-09", time: "09:00", evidence: ["hist:guest:h2"], quote: "vamos sair por volta das 9:00" }]);
    expect(hasOpsSignal(s)).toBe(true);
  });
  it("id fora do turno corrente, horário/data malformados, card repetido ou sem trecho ⇒ descartado", () => {
    const bad = parseOpsSignals(
      {
        guestEtas: [
          { card: "checkout", date: "2026-11-09", time: "09:00", evidence: ["hist:team:h1"], quote: "x" },
          { card: "checkout", date: "09/11/2026", time: "09:00", evidence: ["hist:guest:h2"], quote: "x" },
          { card: "checkin", date: "2026-11-09", time: "9h", evidence: ["hist:guest:h2"], quote: "x" },
          { card: "checkin", date: "2026-11-09", time: "10:00", evidence: ["hist:guest:h2"], quote: "" },
        ],
      },
      cur,
    );
    expect(bad.guestEtas).toEqual([]);
    expect(hasOpsSignal(bad)).toBe(false);
  });
  it("marco só com evidência do turno corrente E trecho literal", () => {
    expect(parseOpsSignals({ hospitalityMilestone: { kind: "checkout_confirmed", evidence: ["hist:guest:h3"] }, milestoneQuote: "" }, cur).hospitalityMilestone).toBeNull();
    expect(parseOpsSignals({ hospitalityMilestone: { kind: "checkout_confirmed", evidence: ["hist:guest:h3"] }, milestoneQuote: "já saímos" }, cur).hospitalityMilestone).toEqual({ kind: "checkout_confirmed", evidence: ["hist:guest:h3"] });
    expect(parseOpsSignals({ hospitalityMilestone: { kind: "outro", evidence: ["hist:guest:h3"] }, milestoneQuote: "x" }, cur).hospitalityMilestone).toBeNull();
    expect(parseOpsSignals("lixo", cur)).toEqual({ hospitalityMilestone: null, milestoneQuote: null, guestEtas: [] });
  });
});

describe("Bastidores · extração com o Gateway real (transporte falso)", () => {
  it("caso real de 08/11: previsão de saída às 09:00 extraída no modelo Reserva, barata e com raciocínio low", async () => {
    let seen: ProviderRequest | null = null;
    const p = fakeProvider(() => okJson({
      hospitalityMilestone: null,
      milestoneQuote: null,
      guestEtas: [{ card: "checkout", date: "2026-11-09", time: "09:00", evidence: ["hist:guest:h2"], quote: "vamos sair por volta das 9:00" }],
    }, { inputTokens: 900, outputTokens: 60, totalTokens: 960 }));
    const spy = { ...p, complete: async (req: ProviderRequest, s: AbortSignal) => ((seen = req), p.complete(req, s)) };
    const s = await extractOpsSignals(baseInput(), { provider: spy, log: () => {} });
    expect(s?.guestEtas).toHaveLength(1);
    expect(s?.guestEtas?.[0]).toMatchObject({ card: "checkout", time: "09:00", date: "2026-11-09" });
    expect(seen!.spec.id).toBe(GUEST_AI_RESERVE_MODEL);
    expect(seen!.reasoningEffort).toBe("low");
    expect(seen!.maxOutputTokens).toBeLessThanOrEqual(700);
  });
  it("falha do provedor, JSON inválido ou sinal abortado ⇒ null (nunca lança)", async () => {
    const err: ProviderOutcome = { kind: "error", error: { code: "bad_request", retryable: false } as never, usage: null, requestId: null };
    expect(await extractOpsSignals(baseInput(), { provider: fakeProvider(err), log: () => {} })).toBeNull();
    const bad: ProviderOutcome = { kind: "ok", text: "não é json", finishReason: "stop", usage: null, requestId: null };
    expect(await extractOpsSignals(baseInput(), { provider: fakeProvider(bad), log: () => {} })).toBeNull();
    const ac = new AbortController();
    ac.abort();
    const p = fakeProvider(okJson({}));
    expect(await extractOpsSignals(baseInput({ signal: ac.signal }), { provider: p, log: () => {} })).toBeNull();
    expect(p.calls).toBe(0);
  });
});

describe("Corrida protegida do gerador do Copiloto", () => {
  const prompt = {
    system: "Você é o concierge.",
    messages: [{ role: "user" as const, content: "Que horas é o check-in? Responda em JSON." }],
    sourceIds: new Set<string>(),
    promptVersion: "teste",
  } as unknown as ComposedPrompt;
  const slowTitular = (titularMs: number, reserveMs: number) => ({
    id: "fake",
    calls: [] as string[],
    async complete(req: ProviderRequest, signal: AbortSignal): Promise<ProviderOutcome> {
      this.calls.push(req.spec.id);
      const ms = req.spec.id === GUEST_AI_DEFAULT_MODEL ? titularMs : reserveMs;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("aborted"))), { once: true });
      });
      return okJson({ quem: req.spec.id });
    },
  });
  const mk = (provider: ReturnType<typeof slowTitular>, remaining = 12_000) =>
    createCopilotGenerator({
      modelId: GUEST_AI_DEFAULT_MODEL,
      maxOutputTokens: 1536,
      reasoningEffort: "auto",
      remainingMs: () => remaining,
      beforeNetwork: async () => true,
      traceId: "t",
      provider,
      log: () => {},
    });

  it("o atraso do Reserva fica entre 2,5 s e 4,5 s", () => {
    expect(hedgeDelayMs(1_000)).toBe(2_500);
    expect(hedgeDelayMs(10_000)).toBe(3_500);
    expect(hedgeDelayMs(60_000)).toBe(4_500);
  });

  it("Titular lento ⇒ o Reserva dispara em paralelo e a primeira resposta válida vence", async () => {
    const p = slowTitular(30_000, 200);
    const g = mk(p);
    const text = await g.generate(prompt, new AbortController().signal);
    expect(JSON.parse(text)).toEqual({ quem: GUEST_AI_RESERVE_MODEL });
    expect(p.calls).toEqual([GUEST_AI_DEFAULT_MODEL, GUEST_AI_RESERVE_MODEL]);
    expect(g.telemetry()).toMatchObject({ status: "called", hedged: true, model: GUEST_AI_RESERVE_MODEL });
  }, 15_000);

  it("Titular responde a tempo ⇒ o Reserva nem dispara (custo zero extra)", async () => {
    const p = slowTitular(50, 50);
    const g = mk(p);
    const text = await g.generate(prompt, new AbortController().signal);
    expect(JSON.parse(text)).toEqual({ quem: GUEST_AI_DEFAULT_MODEL });
    expect(p.calls).toEqual([GUEST_AI_DEFAULT_MODEL]);
    expect(g.telemetry()).toMatchObject({ hedged: false, model: GUEST_AI_DEFAULT_MODEL });
  });

  it("sem tempo para valer a pena (menos de 3,5 s restantes) ⇒ só o Titular", async () => {
    const p = slowTitular(2_700, 50);
    const g = mk(p, 3_000);
    await g.generate(prompt, new AbortController().signal);
    expect(p.calls).toEqual([GUEST_AI_DEFAULT_MODEL]);
  }, 10_000);

  it("a mensagem que vai ao Reserva é a MESMA do Titular", async () => {
    const seen: string[] = [];
    const p = slowTitular(30_000, 100);
    const orig = p.complete.bind(p);
    p.complete = async (req, s) => {
      seen.push(req.messages.map((m) => llmMessageText(m.content)).join("|"));
      return orig(req, s);
    };
    await mk(p).generate(prompt, new AbortController().signal);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  }, 15_000);
});
