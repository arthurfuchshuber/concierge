import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn(async () => ({ sent: 0, failed: 0 })));
vi.mock("@/lib/handoff.server", () => ({
  getPropertyNotifiableUsers: async () => ["owner-1"],
  sendHandoffPush: push,
}));

import {
  describeAiError,
  handleAiReplyFailure,
  isTransientAiError,
} from "@/lib/channex-messages.server";

const ctx = (attempts?: number) => ({
  threadId: "t1",
  bookingId: null,
  channexPropertyId: null,
  guestName: "Ricardo",
  propertyId: "prop-1",
  attempts,
});

/** Banco falso: registra updates/inserts e devolve as linhas pedidas. */
function fakeAdmin(conv: Record<string, unknown> = { ai_paused: false, paused_until: null }) {
  const updates: Array<{ table: string; patch: any; filters: string[] }> = [];
  const inserts: Array<{ table: string; row: any }> = [];
  const admin = {
    updates,
    inserts,
    from(table: string) {
      let mode: "select" | "update" = "select";
      let patch: any = null;
      const filters: string[] = [];
      const b: any = {
        select: () => b,
        update: (p: unknown) => {
          mode = "update";
          patch = p;
          return b;
        },
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: null };
        },
        eq: (c: string, v: unknown) => {
          filters.push(`${c}=${v}`);
          return b;
        },
        is: (c: string, v: unknown) => {
          filters.push(`${c} is ${v}`);
          return b;
        },
        maybeSingle: async () => {
          if (table === "properties") return { data: { owner_id: "owner-1", name: "Studio 103" } };
          if (table === "property_chat_conversations") return { data: conv };
          return { data: null };
        },
        then: (res: (v: unknown) => unknown) => {
          if (mode === "update") updates.push({ table, patch, filters });
          return res(table === "user_roles" ? { data: [{ user_id: "adm-1" }] } : { data: null });
        },
      };
      return b;
    },
  };
  return admin;
}

describe("classificação de erro da IA", () => {
  it("passageiros: 503, 502, 504, 429, rede e timeout", () => {
    for (const e of [
      Object.assign(new Error("x"), { status: 503 }),
      new Error("AI gateway 502 bad gateway"),
      new Error("504"),
      new Error("429 rate limit"),
      new Error("fetch failed"),
      new Error("ETIMEDOUT"),
      new Error("upstream_error"),
    ])
      expect(isTransientAiError(e)).toBe(true);
  });
  it("definitivos: 400, 401, 402", () => {
    for (const e of [
      new Error("400 bad request"),
      new Error("401"),
      Object.assign(new Error("pay"), { status: 402 }),
    ])
      expect(isTransientAiError(e)).toBe(false);
  });
  it("motivos em português claro", () => {
    expect(describeAiError(new Error("503 upstream"))).toMatch(/erro 503 upstream/);
    expect(describeAiError(new Error("429"))).toMatch(/Limite de requisições/);
    expect(describeAiError(new Error("ETIMEDOUT"))).toMatch(/Tempo limite/);
    expect(describeAiError(new Error("x".repeat(300))).length).toBeLessThanOrEqual(120);
  });
});

describe("handleAiReplyFailure", () => {
  beforeEach(() => push.mockClear());

  it("503 na 1ª tentativa: reagenda em 20 s com attempts = 1", async () => {
    const a = fakeAdmin();
    const t0 = Date.now();
    const r = await handleAiReplyFailure(a, "c1", ctx(), new Error("503 upstream"));
    expect(r).toBe("retry");
    const u = a.updates[0]!;
    expect(u.patch.ai_reply_ctx.attempts).toBe(1);
    const delay = new Date(u.patch.ai_reply_due_at).getTime() - t0;
    expect(delay).toBeGreaterThanOrEqual(19_000);
    expect(delay).toBeLessThan(22_000);
    // só reagenda se nenhuma mensagem nova reiniciou a janela
    expect(u.filters).toContain("ai_reply_due_at is null");
    expect(push).not.toHaveBeenCalled();
  });

  it("2ª retentativa espera 35 s", async () => {
    const a = fakeAdmin();
    const t0 = Date.now();
    await handleAiReplyFailure(a, "c1", ctx(1), new Error("503"));
    const delay = new Date(a.updates[0]!.patch.ai_reply_due_at).getTime() - t0;
    expect(delay).toBeGreaterThanOrEqual(34_000);
    expect(a.updates[0]!.patch.ai_reply_ctx.attempts).toBe(2);
  });

  it("falha persistente após 2 retentativas: needs_human, alerta detalhado e push", async () => {
    const a = fakeAdmin();
    const r = await handleAiReplyFailure(a, "c1", ctx(2), new Error("503 upstream"));
    expect(r).toBe("handoff");
    const u = a.updates[0]!;
    expect(u.patch.status).toBe("needs_human");
    expect(u.patch.handoff_urgency).toBe("high");
    expect(u.patch.ai_reply_due_at).toBeNull();
    expect(u.patch.handoff_reason).toContain("devido a: Instabilidade temporária");
    const alert = a.inserts.find((i) => i.table === "ai_alerts")!.row;
    expect(alert).toMatchObject({
      tenant_id: "owner-1",
      kind: "ai_provider_error",
      severity: "critical",
    });
    expect(alert.detail).toContain("Ricardo");
    expect(alert.detail).toContain("Studio 103");
    expect(alert.metadata.attempts).toBe(2);
    const pushArg = (
      push.mock.calls[0] as unknown as [unknown, { userIds: string[]; urgency: string }]
    )[1];
    expect(pushArg.userIds.sort()).toEqual(["adm-1", "owner-1"]);
    expect(pushArg.urgency).toBe("high");
  });

  it("erro 402: vai direto para humano, sem retentar", async () => {
    const a = fakeAdmin();
    const r = await handleAiReplyFailure(
      a,
      "c1",
      ctx(),
      Object.assign(new Error("payment"), { status: 402 }),
    );
    expect(r).toBe("handoff");
    expect(a.updates[0]!.patch.handoff_reason).toContain("Créditos de IA insuficientes");
    expect(a.inserts.some((i) => i.table === "ai_alerts")).toBe(true);
  });

  it("anfitrião assumiu (IA pausada): não reagenda nem faz handoff", async () => {
    const a = fakeAdmin({ ai_paused: true, paused_until: null });
    const r = await handleAiReplyFailure(a, "c1", ctx(), new Error("503"));
    expect(r).toBe("skipped");
    expect(a.updates.length).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });
});
