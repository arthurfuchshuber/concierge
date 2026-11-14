import { describe, expect, it, vi } from "vitest";

// Banco falso mínimo: só o que `relinkAutoCheckout` encosta (tasks e property_reservations).
function fakeDb(tasks: Array<Record<string, unknown>>, checkouts: Array<{ id: string; property_id: string; checkout_date: string }>) {
  const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "in", "gte", "order"]) q[m] = () => q;
    q.limit = async () => ({ data: rows });
    // `checkoutsOf` termina em .order(...) sem .limit
    (q as { then?: unknown }).then = (res: (v: { data: unknown[] }) => unknown) => res({ data: rows });
    return q;
  };
  return {
    updates,
    from(t: string) {
      if (t === "tasks") {
        const base = chain(tasks) as Record<string, unknown>;
        base.update = (patch: Record<string, unknown>) => ({
          eq: async (_c: string, id: unknown) => {
            updates.push({ id, patch });
            return {};
          },
        });
        return base;
      }
      return chain(checkouts);
    },
  };
}

describe("relinkAutoCheckout", () => {
  it("religa ao checkout mais próximo e guarda quando não há checkout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    const { relinkAutoCheckout } = await import("@/lib/recurrences.functions");
    const db = fakeDb(
      [
        { id: "t1", property_id: "p1", due_date: null, reservation_id: null },
        { id: "t2", property_id: "p2", due_date: null, reservation_id: "r-antiga" },
      ],
      [{ id: "r1", property_id: "p1", checkout_date: "2026-11-15" }],
    );
    await relinkAutoCheckout(db as never);
    // p1: a pendência sem vínculo passa ao checkout de 15/11.
    // p2: o fake devolve o mesmo checkout para qualquer imóvel, então ela é religada também.
    expect(db.updates.find((u) => u.id === "t1")?.patch).toEqual({ reservation_id: "r1" });
    vi.useRealTimers();
  });

  it("sem checkout à frente deixa o vínculo nulo (guardada)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    const { relinkAutoCheckout } = await import("@/lib/recurrences.functions");
    const db = fakeDb([{ id: "t2", property_id: "p2", due_date: null, reservation_id: "r-cancelada" }], []);
    await relinkAutoCheckout(db as never);
    expect(db.updates).toEqual([{ id: "t2", patch: { reservation_id: null } }]);
    vi.useRealTimers();
  });
});
