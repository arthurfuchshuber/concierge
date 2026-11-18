import { describe, expect, it, vi } from "vitest";
import { planWatchdog, runHandoffWatchdog, watchdogConfig, type WatchdogRow } from "@/lib/handoff-watchdog.server";

const NOW = Date.parse("2026-11-14T20:00:00Z");
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const row = (id: string, minAgo: number, over: Partial<WatchdogRow> = {}): WatchdogRow => ({
  id, property_id: "p1", status: "needs_human", handoff_at: ago(minAgo), handoff_reason: "Acesso", guest_name: "Ana",
  handoff_reminded_at: null, handoff_escalated_at: null, ...over,
});
const cfg = watchdogConfig({});

describe("vigia de encaminhamentos · decisão", () => {
  it("padrões: lembrete em 10 min, escalonamento em 30 min", () => {
    expect(cfg).toMatchObject({ remindMs: 600_000, escalateMs: 1_800_000, enabled: true });
  });
  it("antes de 10 min: nada; 10–30: lembrete; 30+: escalonamento", () => {
    expect(planWatchdog([row("a", 5)], new Set(), NOW, cfg)).toEqual([]);
    expect(planWatchdog([row("a", 12)], new Set(), NOW, cfg)).toEqual([{ id: "a", stage: "remind" }]);
    expect(planWatchdog([row("a", 40)], new Set(), NOW, cfg)).toEqual([{ id: "a", stage: "escalate" }]);
  });
  it("cada etapa dispara uma vez só", () => {
    expect(planWatchdog([row("a", 12, { handoff_reminded_at: ago(2) })], new Set(), NOW, cfg)).toEqual([]);
    expect(planWatchdog([row("a", 40, { handoff_reminded_at: ago(25), handoff_escalated_at: ago(1) })], new Set(), NOW, cfg)).toEqual([]);
    expect(planWatchdog([row("a", 40, { handoff_reminded_at: ago(25) })], new Set(), NOW, cfg)).toEqual([{ id: "a", stage: "escalate" }]);
  });
  it("conversa respondida, assumida ou fora de needs_human não é cobrada", () => {
    expect(planWatchdog([row("a", 40)], new Set(["a"]), NOW, cfg)).toEqual([]);
    expect(planWatchdog([row("a", 40, { status: "assigned" })], new Set(), NOW, cfg)).toEqual([]);
  });
  it("desligado por GUEST_AI_WATCHDOG=off", () => {
    expect(planWatchdog([row("a", 40)], new Set(), NOW, watchdogConfig({ GUEST_AI_WATCHDOG: "off" }))).toEqual([]);
  });
});

function fakeDb(rows: WatchdogRow[], answeredIds: string[]) {
  const updates: Array<{ id: string; patch: unknown }> = [];
  const db = {
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      let convId = "";
      for (const k of ["select", "eq", "not", "lte", "gte", "neq", "limit", "order"]) q[k] = (...a: unknown[]) => { if (k === "eq" && a[0] === "conversation_id") convId = String(a[1]); return q; };
      q["update"] = (patch: unknown) => ({ eq: async (_c: string, id: string) => { updates.push({ id, patch }); return { error: null }; } });
      q["then"] = (res: (v: unknown) => unknown) => res({ data: t === "property_chat_conversations" ? rows : answeredIds.includes(convId) ? [{ id: "m", role: "assistant" }] : [{ id: "g", role: "user" }] });
      return q;
    },
  };
  return { db, updates };
}

describe("vigia · execução", () => {
  it("avisa a equipe com urgência alta e grava a etapa; quem já foi respondido fica de fora", async () => {
    const { db, updates } = fakeDb([row("a", 12), row("b", 45), row("c", 45)], ["c"]);
    const push = vi.fn(async (..._a: unknown[]) => {});
    const r = await runHandoffWatchdog({ db, now: () => NOW, env: {}, push });
    expect(r).toMatchObject({ checked: 3, reminded: 1, escalated: 1 });
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[0]![1]).toMatchObject({ urgency: "high" });
    expect(updates.map((u) => u.id).sort()).toEqual(["a", "b"]);
  });
  it("caso Nailton: filtra nota interna por is_internal_note (sender_type não tem esse valor no enum)", async () => {
    const filters: unknown[][] = [];
    const db = {
      from: (t: string) => {
        const q: Record<string, unknown> = {};
        for (const k of ["select", "eq", "not", "lte", "gte", "neq", "limit", "order"]) q[k] = (...a: unknown[]) => { if (t === "property_chat_messages") filters.push([k, ...a]); return q; };
        q["update"] = () => ({ eq: async () => ({ error: null }) });
        q["then"] = (res: (v: unknown) => unknown) => res({ data: t === "property_chat_conversations" ? [row("a", 12)] : [{ id: "m", role: "assistant" }] });
        return q;
      },
    };
    const push = vi.fn(async (..._a: unknown[]) => {});
    await runHandoffWatchdog({ db, now: () => NOW, env: {}, push });
    expect(filters).toContainEqual(["eq", "is_internal_note", false]);
    expect(filters.some((f) => f[1] === "sender_type")).toBe(false);
    expect(push).not.toHaveBeenCalled(); // a IA respondeu depois do encaminhamento
  });
  it("falha ao ler as respostas ⇒ não cobra a equipe (não afirma o que não conferiu)", async () => {
    const db = {
      from: (t: string) => {
        const q: Record<string, unknown> = {};
        for (const k of ["select", "eq", "not", "lte", "gte", "neq", "limit", "order"]) q[k] = () => q;
        q["update"] = () => ({ eq: async () => ({ error: null }) });
        q["then"] = (res: (v: unknown) => unknown) =>
          res(t === "property_chat_conversations" ? { data: [row("a", 12)] } : { data: null, error: { message: "invalid input value for enum" } });
        return q;
      },
    };
    const push = vi.fn(async (..._a: unknown[]) => {});
    await runHandoffWatchdog({ db, now: () => NOW, env: {}, push });
    expect(push).not.toHaveBeenCalled();
  });
  it("erro de leitura nunca lança", async () => {
    const r = await runHandoffWatchdog({ db: { from: () => { throw new Error("x"); } }, now: () => NOW, env: {} });
    expect(r).toEqual({ checked: 0, reminded: 0, escalated: 0 });
  });
});
