import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildGuestContext } from "@/lib/guest-ai/context/builder.server";
import { loadConversationContext } from "@/lib/guest-ai/context/conversation-context.server";
import { GuestAiAbortedError, abortableDb, throwIfAborted, type GuestAiDb } from "@/lib/guest-ai/data/client.server";
import { fetchDossierKnowledge, type BuildPlaybookFn } from "@/lib/guest-ai/data/dossier.server";
import { fetchReservationState } from "@/lib/guest-ai/data/reservation.server";
import { runGuestTurn } from "@/lib/guest-ai/orchestrator/orchestrator.server";
import type { ConversationContext, TurnRequest } from "@/lib/guest-ai/orchestrator/contracts";
import type { TurnLogEvent } from "@/lib/guest-ai/orchestrator/telemetry";
import { IDS, makeDb } from "./helpers/fixtures";

const fakeBuild: BuildPlaybookFn = () => [];
const guide = { surface: "guide_chat" as const, conversationId: IDS.conv1, messageId: IDS.msg1 };
const req: TurnRequest = { ...guide, expectedOwnerId: null, mode: "shadow", traceId: "abort-1" };
const dossierDep = { fetchDossierKnowledge: (turn: never, aud: never, d: never) => fetchDossierKnowledge(turn, aud, { ...(d as object), buildPlaybook: fakeBuild }) } as never;

/** Construtor de consulta que imita o PostgREST: `select()` devolve um builder com `abortSignal()`. */
function postgrestLikeDb() {
  const attached: Array<AbortSignal | null> = [];
  const db: GuestAiDb = {
    from() {
      const q: Record<string, unknown> = {
        signal: null as AbortSignal | null,
        select() { attached.push(null); return q; },
        abortSignal(s: AbortSignal) { q["signal"] = s; attached[attached.length - 1] = s; return q; },
        eq() { return q; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      };
      return q;
    },
  };
  return { db, attached };
}

describe("Fechamento B1 · item 1 — cancelamento real das leituras de contexto", () => {
  it("abortableDb anexa o sinal a TODA consulta (.abortSignal do PostgREST → fetch)", () => {
    const { db, attached } = postgrestLikeDb();
    const ac = new AbortController();
    const wrapped = abortableDb(db, ac.signal);
    wrapped.from("properties").select("id").eq("id", "x");
    wrapped.from("property_reservations").select("id");
    expect(attached).toEqual([ac.signal, ac.signal]);
  });
  it("sem sinal, o cliente é devolvido intacto (F0/F1 inalterados)", () => {
    const { db } = postgrestLikeDb();
    expect(abortableDb(db)).toBe(db);
  });
  it("depois do cancelamento, NENHUMA consulta nova é aberta", () => {
    const fake = makeDb();
    const ac = new AbortController();
    const wrapped = abortableDb(fake, ac.signal);
    ac.abort();
    expect(() => wrapped.from("properties")).toThrow(GuestAiAbortedError);
    expect(fake.calls).toHaveLength(0);
    expect(() => throwIfAborted(ac.signal)).toThrow(GuestAiAbortedError);
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });
  it("builder sem abortSignal (banco simulado) continua funcionando com o proxy", async () => {
    const fake = makeDb();
    const wrapped = abortableDb(fake, new AbortController().signal);
    const { data } = await wrapped.from("properties").select("id").eq("id", IDS.prop1).maybeSingle();
    expect(data).toEqual({ id: IDS.prop1 });
  });

  it("buildGuestContext com sinal já cancelado: lança GuestAiAbortedError e não toca o banco", async () => {
    const fake = makeDb();
    const ac = new AbortController();
    ac.abort();
    await expect(buildGuestContext(guide, { db: fake, signal: ac.signal, credentials: "skip" })).rejects.toBeInstanceOf(GuestAiAbortedError);
    expect(fake.calls).toHaveLength(0);
  });

  it("cancelamento NO MEIO do carregamento: as etapas seguintes (anúncio, Dossiê) não consultam o banco", async () => {
    const fake = makeDb();
    const ac = new AbortController();
    const p = buildGuestContext(guide, {
      db: fake,
      signal: ac.signal,
      credentials: "skip",
      now: () => new Date("2026-11-11T12:00:00Z"),
      fetchReservationState: async (turn, d) => {
        const r = await fetchReservationState(turn, d);
        ac.abort(); // o prazo do turno estourou enquanto lia a reserva
        return r;
      },
      ...(dossierDep as object),
    });
    await expect(p).rejects.toBeInstanceOf(GuestAiAbortedError);
    expect(fake.touched("property_listing_raw_data")).toBe(0);
    expect(fake.touched("property_faqs")).toBe(0);
    expect(fake.touched("property_playbook_entries")).toBe(0);
  });

  it("cancelamento não é mascarado como 'reserva indisponível' (o turno é interrompido)", async () => {
    const fake = makeDb();
    const ac = new AbortController();
    const p = buildGuestContext(guide, {
      db: fake,
      signal: ac.signal,
      credentials: "skip",
      fetchReservationState: async () => {
        ac.abort();
        throw new Error("fetch aborted");
      },
      ...(dossierDep as object),
    });
    await expect(p).rejects.toBeInstanceOf(GuestAiAbortedError);
  });

  it("loadConversationContext repassa o sinal ao builder (cancelado ⇒ 0 consultas)", async () => {
    const fake = makeDb();
    const ac = new AbortController();
    ac.abort();
    await expect(loadConversationContext(req, { db: fake }, ac.signal)).rejects.toBeInstanceOf(GuestAiAbortedError);
    expect(fake.calls).toHaveLength(0);
  });

  it("loadConversationContext sem cancelamento continua igual (contexto completo, sem credenciais)", async () => {
    const fake = makeDb();
    const cc = await loadConversationContext(req, { db: fake, now: () => new Date("2026-11-11T12:00:00Z"), ...(dossierDep as object) }, new AbortController().signal);
    expect(cc.guest.credentials).toBeNull();
    expect(cc.guest.property.id).toBe(IDS.prop1);
  });

  it("o loader padrão do Orchestrator repassa o sinal do turno (verificação de código)", () => {
    const src = readFileSync(path.resolve(__dirname, "../orchestrator/orchestrator.server.ts"), "utf8");
    expect(src).toMatch(/loadConversationContext\(r, \{\}, s\)/);
  });

  it("Promise do contexto que termina DEPOIS do fallback: resultado descartado, sem 2º log, sem Gateway, sem escrita", async () => {
    let clock = 0;
    const timers: Array<{ at: number; fn: () => void; done: boolean }> = [];
    const logs: TurnLogEvent[] = [];
    let generateCalls = 0;
    let resolveLate: ((c: ConversationContext) => void) | null = null;
    let signalSeen: AbortSignal | null = null;
    const p = runGuestTurn(req, {
      loadContext: (_r, s) => {
        signalSeen = s;
        return new Promise<ConversationContext>((res) => { resolveLate = res; });
      },
      composePrompt: () => ({ system: "s", messages: [{ role: "user", content: "u" }], sourceIds: null, promptVersion: "t" }),
      generate: async () => { generateCalls += 1; throw new Error("não deveria"); },
      now: () => clock,
      schedule: (fn, ms) => { const t = { at: clock + ms, fn, done: false }; timers.push(t); return () => { t.done = true; }; },
      log: (e) => logs.push(e),
    });
    await Promise.resolve();
    clock = 15_000;
    for (const t of timers) if (!t.done && t.at <= clock) { t.done = true; t.fn(); }
    const r = await p;
    expect(r).toMatchObject({ kind: "fallback", fallback: "deadline_exceeded" });
    expect(signalSeen!.aborted).toBe(true);
    // a leitura "atrasada" termina agora, com um contexto que até traz credenciais: nada acontece
    resolveLate!({ guest: { credentials: { lockCode: "4821" } } } as never);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(logs).toHaveLength(1);
    expect(generateCalls).toBe(0);
    expect(JSON.stringify([r, logs])).not.toContain("4821");
  });
});

describe("Fechamento B1 · item 1 — cada ponto de checagem do builder (etapas sem banco)", () => {
  const ok = { fetchDossierKnowledge: async () => ({ items: [], manuals: [], withheldByPolicy: 0 }) };
  const turnOf = async () => {
    const { validateTurnScope } = await import("@/lib/guest-ai/data/scope.server");
    return validateTurnScope(guide, { db: makeDb() });
  };

  it("o builder anexa o sinal a TODAS as consultas reais que faz", async () => {
    const fake = makeDb();
    const attached: AbortSignal[] = [];
    const recording: GuestAiDb = {
      from(t: string) {
        const q = fake.from(t);
        q.abortSignal = (s: AbortSignal) => { attached.push(s); return q; };
        return q;
      },
    };
    const ac = new AbortController();
    await buildGuestContext(guide, { db: recording, signal: ac.signal, credentials: "skip", now: () => new Date("2026-11-11T12:00:00Z"), ...(dossierDep as object) });
    expect(fake.calls.length).toBeGreaterThan(3);
    expect(attached).toHaveLength(fake.calls.length);
    expect(attached.every((s) => s === ac.signal)).toBe(true);
  });

  it("S0 — já cancelado: nem a validação de escopo é chamada", async () => {
    const ac = new AbortController();
    ac.abort();
    let scopeCalls = 0;
    await expect(buildGuestContext(guide, { db: makeDb(), signal: ac.signal, validateTurnScope: async () => { scopeCalls += 1; return turnOf(); } })).rejects.toBeInstanceOf(GuestAiAbortedError);
    expect(scopeCalls).toBe(0);
  });

  it("S1 — cancelado durante o escopo: o imóvel não é carregado", async () => {
    const ac = new AbortController();
    let propCalls = 0;
    await expect(
      buildGuestContext(guide, {
        db: makeDb(),
        signal: ac.signal,
        validateTurnScope: async () => { const t = await turnOf(); ac.abort(); return t; },
        loadPropertyScope: async () => { propCalls += 1; return null; },
      }),
    ).rejects.toBeInstanceOf(GuestAiAbortedError);
    expect(propCalls).toBe(0);
  });

  it("S2 — cancelado ao carregar o imóvel: a reserva não é consultada", async () => {
    const ac = new AbortController();
    let resCalls = 0;
    await expect(
      buildGuestContext(guide, {
        db: makeDb(),
        signal: ac.signal,
        validateTurnScope: turnOf,
        loadPropertyScope: async () => { ac.abort(); return null; },
        fetchReservationState: async () => { resCalls += 1; return { kind: "no_link" } as never; },
      }),
    ).rejects.toBeInstanceOf(GuestAiAbortedError);
    expect(resCalls).toBe(0);
  });

  it("S3 — cancelado ao ler a reserva: anúncio e Dossiê não são buscados", async () => {
    const ac = new AbortController();
    let knowledgeCalls = 0;
    await expect(
      buildGuestContext(guide, {
        db: makeDb(),
        signal: ac.signal,
        validateTurnScope: turnOf,
        loadPropertyScope: async () => null,
        fetchReservationState: async () => { ac.abort(); return { kind: "no_link" } as never; },
        fetchListingFacts: async () => { knowledgeCalls += 1; throw new Error("x"); },
        fetchDossierKnowledge: async () => { knowledgeCalls += 1; throw new Error("x"); },
      }),
    ).rejects.toBeInstanceOf(GuestAiAbortedError);
    expect(knowledgeCalls).toBe(0);
  });

  it("S4 — cancelado durante anúncio/Dossiê: nenhum contexto é devolvido", async () => {
    const ac = new AbortController();
    await expect(
      buildGuestContext(guide, {
        db: makeDb(),
        signal: ac.signal,
        validateTurnScope: turnOf,
        loadPropertyScope: async () => null,
        fetchReservationState: async () => ({ kind: "no_link" }) as never,
        fetchListingFacts: async () => { ac.abort(); return { multipleListingRows: false, facts: { name: null, city: null, state: null, country: null, shortDescription: null, address: null, normalized: null, syncedAt: null } }; },
        ...ok,
      }),
    ).rejects.toBeInstanceOf(GuestAiAbortedError);
  });
});
