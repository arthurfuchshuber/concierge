import { beforeEach, describe, expect, it, vi } from "vitest";

const upserts: unknown[] = [];
const applyOpsAction = vi.fn(async () => ({ ok: false, code: "panel_refused" }));

function table(name: string) {
  const data: Record<string, unknown> = {
    property_chat_conversations: { id: "c1", property_id: "p1", reservation_id: "r2" },
    property_reservations: { id: "r2", property_id: "p1", status: "confirmed", checkin_date: "2026-11-14", checkout_date: "2026-11-16" },
    properties: { city: "São Paulo", country: "BR" },
  };
  const rows: Record<string, unknown[]> = {
    guest_arrival_status: [{ reservation_id: "r1", kind: "checkout", status: "pending", done_at: null, manual: false, concluded_at: null }],
  };
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const k of ["select", "eq", "is", "in", "order", "limit", "neq"]) q[k] = chain;
  q["maybeSingle"] = async () => ({ data: data[name] ?? null });
  q["upsert"] = async (row: unknown) => { upserts.push(row); return { error: null }; };
  q["then"] = (res: (v: unknown) => unknown) => res({ data: name === "property_reservations" ? [{ id: "r1", checkin_date: "2026-11-10", checkout_date: "2026-11-14" }] : (rows[name] ?? []) });
  return q;
}

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
vi.mock("@/lib/guest-ai/ops/executor.server", () => ({ opsMode: () => "live" }));
vi.mock("@/lib/property-timezone", () => ({ propertyTimeZoneOrNull: () => "America/Sao_Paulo" }));
vi.mock("@/lib/guest-ai-ops-apply.server", () => ({ applyOpsAction }));
vi.mock("@/lib/llm/gateway.server", () => ({ chatJson: vi.fn(async () => ({ data: { milestone: "none", confidence: 0 } })) }));

describe("T-STANDBY-03 · 'Check-in confirmado' com limpeza anterior em aberto", () => {
  beforeEach(() => { upserts.length = 0; vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T17:00:00Z")); });

  it("grava a nota de standby e o card de check-in continua PENDENTE (nunca done)", async () => {
    const { processHostMilestone } = await import("../host-milestone.server");
    const { HOST_CHECKIN_STANDBY_NOTE } = await import("../standby.server");
    const out = await processHostMilestone({ conversationId: "c1", hostText: "Check-in confirmado.", automated: false });
    expect(out).toBe("standby_cleaning");
    expect(upserts).toEqual([{ property_id: "p1", reservation_id: "r2", kind: "checkin", status: "pending", note: HOST_CHECKIN_STANDBY_NOTE }]);
  });

  it("mensagem automática/programada nunca dá baixa nem entra em standby", async () => {
    applyOpsAction.mockClear();
    const { processHostMilestone } = await import("../host-milestone.server");
    await processHostMilestone({ conversationId: "c1", hostText: "Seu check-in está confirmado!", automated: true });
    expect(upserts).toHaveLength(0);
    expect(applyOpsAction).not.toHaveBeenCalled();
  });
});
