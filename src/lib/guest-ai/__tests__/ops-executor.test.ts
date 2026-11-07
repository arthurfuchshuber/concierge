/**
 * GATE G2a · executor em MODO DE OBSERVAÇÃO e integração com a geração do Copiloto. Nada toca a produção.
 * Cobre: chave (só `shadow` liga; `on` NÃO existe na G2a), piloto por imóvel, registro de cada avaliação
 * pela RPC fechada, foto do card, nunca lança, nunca escreve em card, e a geração chama o executor com a
 * decisão validada sem que uma falha dele afete a sugestão.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  opsMode,
  opsPropertyAllowed,
  runOpsShadow,
  type OpsRunInput,
} from "@/lib/guest-ai/ops/executor.server";
import type { OpsState } from "@/lib/guest-ai/data/ops-state.server";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { v5 } from "./helpers/b23-chain";

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
    ...(v5() as unknown as ModelDecision),
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
const recorder = (result: unknown = { result: "recorded" }) => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: {
      call: async (fn: "guest_ai_ops_record", args: Record<string, unknown>) => (
        calls.push({ fn, args }),
        { data: result, error: null }
      ),
    },
  };
};
const SHADOW = { GUEST_AI_OPS_MODE: "shadow" };

describe("G2a · executor (modo de observação)", () => {
  it("chave: só o literal `shadow` liga; `on` e qualquer outro valor ⇒ off", () => {
    expect(opsMode({ GUEST_AI_OPS_MODE: "shadow" })).toBe("shadow");
    for (const v of ["on", "ON", "Shadow", " shadow", "1", "true", ""])
      expect(opsMode({ GUEST_AI_OPS_MODE: v }), v).toBe("off");
    expect(opsMode({})).toBe("off");
  });

  it("piloto por imóvel: vazio ⇒ todos; lista ⇒ só os listados", () => {
    expect(opsPropertyAllowed("p1", {})).toBe(true);
    expect(opsPropertyAllowed("p1", { GUEST_AI_OPS_PROPERTY_IDS: "p2, p1" })).toBe(true);
    expect(opsPropertyAllowed("p3", { GUEST_AI_OPS_PROPERTY_IDS: "p2,p1" })).toBe(false);
  });

  it("off, sem sinal ou fora do piloto ⇒ nada é lido nem registrado", async () => {
    const r = recorder();
    const loadState = vi.fn(async () => STATE);
    expect(await runOpsShadow(input(), { env: {}, rpc: r.rpc, loadState })).toEqual({
      status: "off",
    });
    expect(
      await runOpsShadow(input(), { env: { GUEST_AI_OPS_MODE: "on" }, rpc: r.rpc, loadState }),
    ).toEqual({ status: "off" });
    expect(
      await runOpsShadow(
        input({ decision: decision({ hospitalityMilestone: null, milestoneQuote: null }) }),
        { env: SHADOW, rpc: r.rpc, loadState },
      ),
    ).toEqual({ status: "no_signal" });
    expect(
      await runOpsShadow(input(), {
        env: { ...SHADOW, GUEST_AI_OPS_PROPERTY_IDS: "outro" },
        rpc: r.rpc,
        loadState,
      }),
    ).toEqual({ status: "property_not_in_pilot" });
    expect(loadState).not.toHaveBeenCalled();
    expect(r.calls).toEqual([]);
  });

  it("shadow: registra a avaliação com escopo do turno, foto do card e modo shadow", async () => {
    const r = recorder();
    const out = await runOpsShadow(input(), {
      env: SHADOW,
      rpc: r.rpc,
      loadState: async () => STATE,
      now: () => new Date("2026-11-10T20:00:00Z"),
    });
    expect(out).toMatchObject({ status: "recorded", recorded: 1, failed: 0 });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toEqual({
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
    });
  });

  it("recusa também é registrada (com o motivo); card inexistente vira { exists: false }", async () => {
    const r = recorder();
    await runOpsShadow(input({ phase: "pre_stay" }), {
      env: SHADOW,
      rpc: r.rpc,
      loadState: async () => ({ ...STATE, cards: { checkin: null, checkout: null } }),
    });
    expect(r.calls[0]!.args).toMatchObject({
      p_outcome: "refused",
      p_code: "not_in_stay",
      p_card_before: { exists: false },
    });
  });

  it("registro existente (reentrega) conta como registrado; erro de RPC é contado, nunca lança", async () => {
    const dup = recorder({ result: "exists" });
    expect(
      await runOpsShadow(input(), { env: SHADOW, rpc: dup.rpc, loadState: async () => STATE }),
    ).toMatchObject({ recorded: 1, failed: 0 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bad = { call: async () => ({ data: null, error: { message: "x" } }) };
    expect(
      await runOpsShadow(input(), { env: SHADOW, rpc: bad, loadState: async () => STATE }),
    ).toMatchObject({ recorded: 0, failed: 1 });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await runOpsShadow(input(), {
        env: SHADOW,
        rpc: bad,
        loadState: async () => Promise.reject(new Error("db")),
      }),
    ).toEqual({ status: "error" });
    warn.mockRestore();
    err.mockRestore();
  });
});

describe("G2a · estáticos: nenhuma escrita em card nesta etapa", () => {
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

  it("o módulo guest-ai não chama o avanço do painel nem grava previsão", () => {
    for (const f of files(ROOT)) {
      const c = code(f);
      const rel = path.relative(ROOT, f);
      expect(c, rel).not.toMatch(
        /runAdvanceArrival|markGuideStayStep|dashboard\.functions|guide-access\.functions|auto-checkout/,
      );
      expect(c, rel).not.toMatch(/arrival_time_source\s*:\s*["']guest_ai["']/);
    }
  });

  it("porta de auditoria: lista fechada com uma única função, usada só pelo executor", () => {
    const client = code(path.join(ROOT, "data/client.server.ts"));
    expect(client).toMatch(/OPS_RPC_FUNCTIONS = \["guest_ai_ops_record"\] as const/);
    expect(client).toMatch(
      /if \(!\(OPS_RPC_FUNCTIONS as readonly string\[\]\)\.includes\(fn\)\) return/,
    );
    const users = files(ROOT)
      .filter((f) => /getGuestAiOpsRpc|opsRpcFrom|GuestAiOpsRpc/.test(code(f)))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(users).toEqual(["data/client.server.ts", "ops/executor.server.ts"]);
  });

  it("a migration G2a não agenda, não chama nada externo e aceita só o modo shadow", () => {
    const sql = readFileSync(
      path.resolve(ROOT, "../../../supabase/migrations/20261107010000_guest_ai_ops_actions.sql"),
      "utf8",
    ).replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/cron\.|net\.http|pg_net|http_post|guest_arrival_status/i);
    expect(sql).toMatch(/mode text not null check \(mode in \('shadow'\)\)/);
    expect(sql).toMatch(/if p_mode <> 'shadow' then/);
  });
});

describe("G2a · integração com a geração do Copiloto", () => {
  it("a geração chama o executor depois da gravação, com a decisão validada; falha do executor não afeta a sugestão", async () => {
    const src = readFileSync(path.join(ROOT, "copilot/generate.server.ts"), "utf8");
    const store = src.indexOf("const stored = await store.store(");
    const ops = src.indexOf("deps.ops ?? ((i: OpsRunInput) => runOpsShadow(i, { env }))");
    expect(store).toBeGreaterThan(0);
    expect(ops).toBeGreaterThan(store);
    expect(src).toMatch(
      /outcome\.kind === "reply" \|\| outcome\.kind === "silence" \|\| outcome\.kind === "human_action"/,
    );
  });
});
