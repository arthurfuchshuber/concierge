/**
 * GATE G2 · executor (modos `shadow` e `live`) e integração com a geração do Copiloto. Nada toca a produção.
 * Cobre: chave (`live`/`on` ⇒ ação real; `shadow` ⇒ registro; resto ⇒ desligado), piloto por imóvel,
 * registro em shadow, ciclo live claim → apply → finish (applied com foto depois; recusa do painel ⇒
 * refused), reentrega nunca aplica duas vezes, recusa da política nunca chama a escrita, nunca lança, e a
 * fronteira: o módulo guest-ai nunca escreve em card (só a porta `apply`, fora dele).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  opsMode,
  opsPropertyAllowed,
  runOps,
  type OpsRunInput,
} from "@/lib/guest-ai/ops/executor.server";
import type { OpsState } from "@/lib/guest-ai/data/ops-state.server";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { v6 } from "./helpers/b23-chain";

const ROOT = path.resolve(__dirname, "..");
const TURN = {
  surface: "airbnb",
  conversationId: "c1000000-0000-4000-8000-000000000001",
  messageId: "e1000000-0000-4000-8000-000000000001",
  propertyId: "b1000000-0000-4000-8000-000000000001",
  tenantId: "a1000000-0000-4000-8000-000000000001",
  guestSessionId: "airbnb:x",
  conversationStatus: "needs_human",
  reservationId: "r1000000-0000-4000-8000-000000000001",
  messageCreatedAt: null,
} as unknown as ValidatedTurn;

const decision = (over: Partial<ModelDecision> = {}) =>
  ({
    ...(v6() as unknown as ModelDecision),
    hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"] },
    milestoneQuote: "Já entramos",
    intents: ["arrival_confirmation"],
    ...over,
  }) as ModelDecision;

const input = (over: Partial<OpsRunInput> = {}): OpsRunInput => ({
  turn: TURN,
  decision: decision(),
  history: {
    status: "available",
    entries: [
      {
        ref: "hist:team:h0",
        messageId: "t0",
        speaker: "team",
        text: "Bem-vindos",
        channel: "airbnb",
        at: "",
        media: null,
        delivery: "delivered",
        current: false,
      },
      {
        ref: "hist:guest:h1",
        messageId: TURN.messageId,
        speaker: "guest",
        text: "Já entramos, obrigado!",
        channel: "airbnb",
        at: "",
        media: null,
        delivery: "delivered",
        current: true,
      },
    ],
  } as never,
  phase: "in_stay",
  timezone: "America/Sao_Paulo",
  suggestionId: "s1",
  ...over,
});
const STATE: OpsState = {
  conversation: {
    status: "needs_human",
    assignedTo: null,
    handoffReason: "Atendimento automático indisponível — responder ao hóspede.",
    handoffUrgency: null,
    aiPaused: false,
    pausedUntil: null,
  },
  reservation: {
    id: "r1000000-0000-4000-8000-000000000001",
    status: "confirmed",
    checkinDate: "2026-11-10",
    checkoutDate: "2026-11-13",
  },
  cards: {
    checkin: {
      status: "pending",
      doneAt: null,
      arrivalTimeOverride: null,
      arrivalTimeSource: null,
      mutedUntil: null,
      lateCheckoutTime: null,
      lateCheckoutApprovedAt: null,
    },
    checkout: null,
  },
  property: {
    checkinTime: "15:00",
    checkinTimeMax: null,
    checkoutTime: "11:00",
    checkoutTimeMin: null,
  },
};
/** RPC falsa com o comportamento do banco: record/claim idempotentes por mensagem + ação; finish fecha o claim. */
function fakeRpc(opts: { claimResult?: string; recordResult?: string } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const claimed = new Set<string>();
  return {
    calls,
    rpc: {
      call: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "guest_ai_ops_record")
          return { data: { result: opts.recordResult ?? "recorded" }, error: null };
        if (fn === "guest_ai_ops_claim") {
          const key = `${args.p_trigger_message_id}:${args.p_action}`;
          if (opts.claimResult) return { data: { result: opts.claimResult, id: "x" }, error: null };
          if (claimed.has(key)) return { data: { result: "exists" }, error: null };
          claimed.add(key);
          return { data: { result: "claimed", id: `id-${claimed.size}` }, error: null };
        }
        if (fn === "guest_ai_ops_finish") return { data: { result: "finished" }, error: null };
        return { data: null, error: { code: "x" } };
      },
    } as never,
  };
}
const SHADOW = { GUEST_AI_OPS_MODE: "shadow" };
const LIVE = { GUEST_AI_OPS_MODE: "live" };
const NOW = () => new Date("2026-11-10T20:00:00Z");
const AFTER = { exists: true, status: "done", done_at: "2026-11-10T20:00:01Z" };

describe("G2 · executor: chave e piloto", () => {
  it("chave: `live`/`on` ⇒ ação real; `shadow` ⇒ registro; qualquer outro valor ⇒ off", () => {
    expect(opsMode({ GUEST_AI_OPS_MODE: "live" })).toBe("live");
    expect(opsMode({ GUEST_AI_OPS_MODE: "on" })).toBe("live");
    expect(opsMode({ GUEST_AI_OPS_MODE: "shadow" })).toBe("shadow");
    for (const v of ["ON", "Live", " live", "Shadow", "1", "true", ""])
      expect(opsMode({ GUEST_AI_OPS_MODE: v }), v).toBe("off");
    expect(opsMode({})).toBe("off");
  });

  it("piloto por imóvel: vazio ⇒ todos; lista ⇒ só os listados", () => {
    expect(opsPropertyAllowed("p1", {})).toBe(true);
    expect(opsPropertyAllowed("p1", { GUEST_AI_OPS_PROPERTY_IDS: "p2, p1" })).toBe(true);
    expect(opsPropertyAllowed("p3", { GUEST_AI_OPS_PROPERTY_IDS: "p2,p1" })).toBe(false);
  });

  it("off, sem sinal ou fora do piloto ⇒ nada é lido, registrado ou escrito", async () => {
    const r = fakeRpc();
    const loadState = vi.fn(async () => STATE);
    const apply = vi.fn();
    expect(await runOps(input(), { env: {}, rpc: r.rpc, loadState, apply })).toEqual({
      status: "off",
    });
    // sem sinal do modelo e sem mensagem da equipe no histórico: nem o estado é lido
    const noSignal = input({
      decision: decision({ hospitalityMilestone: null, milestoneQuote: null }),
    });
    (noSignal.history as { entries: unknown[] }).entries.shift();
    expect(await runOps(noSignal, { env: LIVE, rpc: r.rpc, loadState, apply })).toEqual({
      status: "no_signal",
    });
    expect(
      await runOps(input(), {
        env: { ...LIVE, GUEST_AI_OPS_PROPERTY_IDS: "outro" },
        rpc: r.rpc,
        loadState,
        apply,
      }),
    ).toEqual({
      status: "property_not_in_pilot",
    });
    expect(loadState).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(r.calls).toEqual([]);
  });
});

describe("G2 · executor: shadow (registro, sem escrita)", () => {
  it("registra a avaliação com escopo do turno e foto do card; a escrita nunca é chamada", async () => {
    const r = fakeRpc();
    const apply = vi.fn();
    const out = await runOps(input(), {
      env: SHADOW,
      rpc: r.rpc,
      loadState: async () => STATE,
      now: NOW,
      apply,
    });
    expect(out).toMatchObject({
      status: "done",
      mode: "shadow",
      recorded: 1,
      applied: 0,
      failed: 0,
    });
    expect(apply).not.toHaveBeenCalled();
    expect(r.calls).toEqual([
      {
        fn: "guest_ai_ops_record",
        args: {
          p_tenant_id: TURN.tenantId,
          p_property_id: TURN.propertyId,
          p_conversation_id: TURN.conversationId,
          p_trigger_message_id: TURN.messageId,
          p_reservation_id: STATE.reservation!.id,
          p_suggestion_id: "s1",
          p_action: "checkin_done",
          p_mode: "shadow",
          p_outcome: "would_apply",
          p_code: null,
          p_evidence_message_id: TURN.messageId,
          p_proposed_date: null,
          p_proposed_time: null,
          p_madrugada: false,
          p_card_before: { exists: true, ...STATE.cards!.checkin },
        },
      },
    ]);
  });
});

describe("G2c · executor: live (ação real)", () => {
  it("aprovada ⇒ claim → apply (rotina oficial) → finish applied com a foto depois", async () => {
    const r = fakeRpc();
    const apply = vi.fn(async () => ({ ok: true as const, cardAfter: AFTER }));
    const out = await runOps(input(), {
      env: LIVE,
      rpc: r.rpc,
      loadState: async () => STATE,
      now: NOW,
      apply,
    });
    expect(out).toMatchObject({ status: "done", mode: "live", applied: 1, refused: 0, failed: 0 });
    expect(apply).toHaveBeenCalledWith({
      action: "checkin_done",
      propertyId: TURN.propertyId,
      reservationId: STATE.reservation!.id,
    });
    expect(r.calls.map((c) => c.fn)).toEqual(["guest_ai_ops_claim", "guest_ai_ops_finish"]);
    expect(r.calls[0]!.args).toMatchObject({
      p_action: "checkin_done",
      p_reservation_id: STATE.reservation!.id,
      p_card_before: { exists: true },
    });
    expect(r.calls[1]!.args).toEqual({
      p_id: "id-1",
      p_outcome: "applied",
      p_code: null,
      p_card_after: AFTER,
    });
  });

  it("recusa da política ⇒ só registro (live/refused); a escrita nunca é chamada", async () => {
    const r = fakeRpc();
    const apply = vi.fn();
    const out = await runOps(input({ phase: "pre_stay" }), {
      env: LIVE,
      rpc: r.rpc,
      loadState: async () => STATE,
      now: NOW,
      apply,
    });
    expect(out).toMatchObject({ applied: 0, refused: 1 });
    expect(apply).not.toHaveBeenCalled();
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.args).toMatchObject({
      p_mode: "live",
      p_outcome: "refused",
      p_code: "not_in_stay",
    });
  });

  it("recusa da rotina do painel ⇒ finish refused com o código; nada é forçado", async () => {
    const r = fakeRpc();
    const apply = vi.fn(async () => ({ ok: false as const, code: "panel_refused" as const }));
    const out = await runOps(input(), {
      env: LIVE,
      rpc: r.rpc,
      loadState: async () => STATE,
      now: NOW,
      apply,
    });
    expect(out).toMatchObject({ applied: 0, refused: 1 });
    expect(r.calls[1]!.args).toEqual({
      p_id: "id-1",
      p_outcome: "refused",
      p_code: "panel_refused",
      p_card_after: null,
    });
  });

  it("porta de escrita que lança ⇒ apply_failed registrado; o executor nunca lança", async () => {
    const r = fakeRpc();
    const out = await runOps(input(), {
      env: LIVE,
      rpc: r.rpc,
      loadState: async () => STATE,
      now: NOW,
      apply: async () => Promise.reject(new Error("x")),
    });
    expect(out).toMatchObject({ applied: 0, refused: 1 });
    expect(r.calls[1]!.args).toMatchObject({ p_outcome: "refused", p_code: "apply_failed" });
  });

  it("reentrega da mesma mensagem (claim exists) ⇒ nada é escrito de novo", async () => {
    const r = fakeRpc({ claimResult: "exists" });
    const apply = vi.fn();
    const out = await runOps(input(), {
      env: LIVE,
      rpc: r.rpc,
      loadState: async () => STATE,
      now: NOW,
      apply,
    });
    expect(out).toMatchObject({ applied: 0, skipped: 1 });
    expect(apply).not.toHaveBeenCalled();
    expect(r.calls.map((c) => c.fn)).toEqual(["guest_ai_ops_claim"]);
  });

  it("claim inválido ⇒ nada é escrito (falha contada)", async () => {
    const r = fakeRpc({ claimResult: "invalid" });
    const apply = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await runOps(input(), {
      env: LIVE,
      rpc: r.rpc,
      loadState: async () => STATE,
      now: NOW,
      apply,
    });
    expect(out).toMatchObject({ applied: 0, failed: 1 });
    expect(apply).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("previsão e saída antecipada chegam à porta com os dados certos", async () => {
    const etaDecision = decision({
      hospitalityMilestone: null,
      milestoneQuote: null,
      intents: ["informational_query"],
      guestEtas: [
        {
          card: "checkin",
          date: "2026-11-10",
          time: "16:30",
          evidence: ["hist:guest:h1"],
          quote: "chegamos às 16:30",
        },
      ],
    });
    const etaInput = input({ decision: etaDecision, phase: "pre_stay" });
    (etaInput.history as { entries: Array<{ text: string }> }).entries[1]!.text =
      "Oi, chegamos às 16:30";
    const r1 = fakeRpc();
    const a1 = vi.fn(async () => ({ ok: true as const, cardAfter: AFTER }));
    await runOps(etaInput, {
      env: LIVE,
      rpc: r1.rpc,
      loadState: async () => STATE,
      now: () => new Date("2026-11-10T12:00:00Z"),
      apply: a1,
    });
    expect(a1).toHaveBeenCalledWith({
      action: "eta_checkin",
      propertyId: TURN.propertyId,
      reservationId: STATE.reservation!.id,
      time: "16:30",
    });

    const early = input({
      decision: decision({
        hospitalityMilestone: { kind: "checkout_confirmed", evidence: ["hist:guest:h1"] },
        milestoneQuote: "já saí, deixei as chaves no cofre",
        intents: ["departure_confirmation"],
      }),
    });
    (early.history as { entries: Array<{ text: string }> }).entries[1]!.text =
      "Tive um imprevisto, já saí, deixei as chaves no cofre";
    const r2 = fakeRpc();
    const a2 = vi.fn(async () => ({ ok: true as const, cardAfter: AFTER }));
    await runOps(early, {
      env: LIVE,
      rpc: r2.rpc,
      loadState: async () => STATE,
      now: () => new Date("2026-11-11T18:00:00Z"),
      apply: a2,
    });
    expect(a2).toHaveBeenCalledWith({
      action: "early_departure",
      propertyId: TURN.propertyId,
      reservationId: STATE.reservation!.id,
      today: "2026-11-11",
      checkoutDate: "2026-11-13",
    });
  });

  it("late checkout concedido pela equipe chega à porta com a mensagem da equipe e o horário", async () => {
    const lc = input({
      decision: decision({ hospitalityMilestone: null, milestoneQuote: null, intents: [] }),
    });
    const entries = (lc.history as unknown as { entries: Array<Record<string, unknown>> }).entries;
    entries[0] = {
      ...entries[0],
      text: "Combinado, pode sair às 13h!",
      at: "2026-11-12T21:00:00Z",
    };
    entries[1] = { ...entries[1], text: "Obrigado!", at: "2026-11-12T21:10:00Z" };
    const r = fakeRpc();
    const apply = vi.fn(async () => ({
      ok: true as const,
      cardAfter: { exists: true, late_checkout_time: "13:00" },
    }));
    const res = await runOps(lc, {
      env: LIVE,
      rpc: r.rpc,
      loadState: async () => STATE,
      now: () => new Date("2026-11-12T22:00:00Z"),
      apply,
    });
    expect(res).toMatchObject({ status: "done", applied: 1 });
    expect(apply).toHaveBeenCalledWith({
      action: "late_checkout",
      propertyId: TURN.propertyId,
      reservationId: STATE.reservation!.id,
      conversationId: TURN.conversationId,
      staffMessageId: "t0",
      time: "13:00",
    });
    expect(r.calls.find((c) => c.fn === "guest_ai_ops_claim")?.args).toMatchObject({
      p_action: "late_checkout",
      p_evidence_message_id: "t0",
      p_proposed_date: "2026-11-13",
      p_proposed_time: "13:00",
    });
    // mensagem da equipe sobre outro assunto: estado lido, nada registrado
    entries[0] = { ...entries[0], text: "O wifi é CasaNet" };
    const r2 = fakeRpc();
    expect(
      await runOps(lc, {
        env: LIVE,
        rpc: r2.rpc,
        loadState: async () => STATE,
        now: () => new Date("2026-11-12T22:00:00Z"),
        apply,
      }),
    ).toEqual({ status: "no_signal" });
    expect(r2.calls).toEqual([]);
  });

  it("falha ao ler o estado ⇒ error, sem escrita", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const apply = vi.fn();
    expect(
      await runOps(input(), {
        env: LIVE,
        rpc: fakeRpc().rpc,
        loadState: async () => Promise.reject(new Error("db")),
        apply,
      }),
    ).toEqual({
      status: "error",
    });
    expect(apply).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("G2 · estáticos: o módulo guest-ai nunca escreve em card", () => {
  function files(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const f = path.join(dir, n);
      if (statSync(f).isDirectory()) {
        if (n !== "__tests__") files(f, out);
      } else if (f.endsWith(".ts")) out.push(f);
    }
    return out;
  }
  const code = (f: string) =>
    readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("o módulo guest-ai não chama o avanço do painel nem grava previsão (só a porta apply, fora dele)", () => {
    for (const f of files(ROOT)) {
      const c = code(f);
      const rel = path.relative(ROOT, f);
      expect(c, rel).not.toMatch(
        /runAdvanceArrival|markGuideStayStep|dashboard\.functions|guide-access\.functions|auto-checkout/,
      );
      expect(c, rel).not.toMatch(/arrival_time_source\s*:\s*["']guest_ai["']/);
    }
  });

  it("porta de auditoria: lista fechada (record, claim, finish), usada só pelo executor", () => {
    const client = code(path.join(ROOT, "data/client.server.ts"));
    expect(client).toMatch(
      /OPS_RPC_FUNCTIONS = \[\s*"guest_ai_ops_record",\s*"guest_ai_ops_claim",\s*"guest_ai_ops_finish",?\s*\] as const/,
    );
    expect(client).toMatch(
      /if \(!\(OPS_RPC_FUNCTIONS as readonly string\[\]\)\.includes\(fn\)\) return/,
    );
    const users = files(ROOT)
      .filter((f) => /getGuestAiOpsRpc|opsRpcFrom|GuestAiOpsRpc/.test(code(f)))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(users).toEqual(["data/client.server.ts", "ops/executor.server.ts"]);
  });

  it("escrita só pela porta apply, implementada FORA do módulo com as rotinas oficiais", () => {
    const exec = code(path.join(ROOT, "ops/executor.server.ts"));
    expect(exec).toMatch(/import\("@\/lib\/guest-ai-ops-apply\.server"\)/);
    const apply = readFileSync(path.resolve(ROOT, "../guest-ai-ops-apply.server.ts"), "utf8");
    expect(apply).toMatch(/runAdvanceArrival/);
    expect(apply).toMatch(/origin: "ai"/);
    // diretriz 07/11/2026: a informação mais recente vale, inclusive sobre previsão da equipe
    expect(apply).not.toMatch(/arrival_time_source\.neq\.staff/);
  });

  it("migrations G2a/G2c não agendam nem chamam nada externo; G2c aceita live só com claim/finish", () => {
    const g2c = readFileSync(
      path.resolve(ROOT, "../../../supabase/migrations/20261107020000_guest_ai_ops_live.sql"),
      "utf8",
    ).replace(/--.*$/gm, "");
    expect(g2c).not.toMatch(/cron\.|net\.http|pg_net|http_post|guest_arrival_status/i);
    expect(g2c).toMatch(/if p_mode = 'live' and p_outcome <> 'refused' then/);
    const sql = readFileSync(
      path.resolve(ROOT, "../../../supabase/migrations/20261107010000_guest_ai_ops_actions.sql"),
      "utf8",
    ).replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/cron\.|net\.http|pg_net|http_post|guest_arrival_status/i);
    expect(sql).toMatch(/mode text not null check \(mode in \('shadow'\)\)/);
    expect(sql).toMatch(/if p_mode <> 'shadow' then/);
  });
});

describe("G2 · integração com a geração do Copiloto", () => {
  it("a geração chama o executor depois da gravação, com a decisão validada; falha do executor não afeta a sugestão", async () => {
    const src = readFileSync(path.join(ROOT, "copilot/generate.server.ts"), "utf8");
    const store = src.indexOf("const stored = await store.store(");
    const ops = src.indexOf("deps.ops ?? ((i: OpsRunInput) => runOps(i, { env }))");
    expect(store).toBeGreaterThan(0);
    expect(ops).toBeGreaterThan(store);
    expect(src).toMatch(
      /outcome\.kind === "reply" \|\| outcome\.kind === "silence" \|\| outcome\.kind === "human_action"/,
    );
  });
});
