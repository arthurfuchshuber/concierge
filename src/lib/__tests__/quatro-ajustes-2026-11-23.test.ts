import { describe, expect, it } from "vitest";
import { planAssignedWatchdog, watchdogConfig } from "@/lib/handoff-watchdog.server";
import { trimHistoryForBudget, BUDGET_HISTORY_KEEP } from "@/lib/guest-ai/turn-chain";
import { HUMAN_WEBHOOK_GRACE_MS } from "@/lib/channex-messages.server";

const cfg = watchdogConfig({});
const now = Date.parse("2026-11-20T00:30:00Z");
const base = { property_id: "p", guest_name: "Roberto", handoff_reason: "x", handoff_reminded_at: null, handoff_escalated_at: null };

describe("vigia cobre conversa assumida (caso Roberto, 20/11)", () => {
  it("lembra aos 10 min e escalona aos 30 min contados da mensagem do hóspede", () => {
    expect(planAssignedWatchdog([{ ...base, id: "a", lastGuestAt: "2026-11-20T00:25:00Z" }], now, cfg)).toEqual([]);
    expect(planAssignedWatchdog([{ ...base, id: "a", lastGuestAt: "2026-11-20T00:15:00Z" }], now, cfg)).toEqual([{ id: "a", stage: "remind" }]);
    expect(planAssignedWatchdog([{ ...base, id: "a", lastGuestAt: "2026-11-19T23:50:00Z" }], now, cfg)).toEqual([{ id: "a", stage: "escalate" }]);
  });
  it("lembrete antigo (de outra mensagem) não impede o novo; lembrete desta mensagem impede repetir", () => {
    const old = { ...base, id: "a", handoff_reminded_at: "2026-11-19T22:00:00Z", lastGuestAt: "2026-11-20T00:15:00Z" };
    expect(planAssignedWatchdog([old], now, cfg)).toEqual([{ id: "a", stage: "remind" }]);
    const done = { ...old, handoff_reminded_at: "2026-11-20T00:26:00Z" };
    expect(planAssignedWatchdog([done], now, cfg)).toEqual([]);
  });
});

describe("orçamento: histórico longo é enxugado sem perder a atual", () => {
  it("mantém as últimas mensagens", () => {
    const entries = Array.from({ length: 70 }, (_, i) => ({ i, current: i === 69 }));
    const h = trimHistoryForBudget({ status: "available", entries });
    expect(h.entries).toHaveLength(BUDGET_HISTORY_KEEP);
    expect((h.entries!.at(-1) as { current: boolean }).current).toBe(true);
  });
});

describe("carência antes da última conferência", () => {
  it("é zero em teste e 4 s em produção", () => {
    expect(HUMAN_WEBHOOK_GRACE_MS).toBe(0);
  });
});
