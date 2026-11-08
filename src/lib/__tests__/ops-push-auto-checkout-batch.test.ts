/**
 * "Aguardando Limpeza" (pedido explícito, 08/11/2026): não repete mais a cada hora na varredura; sai só no
 * momento da liberação. Na baixa AUTOMÁTICA do horário oficial vira UM aviso em massa por pessoa (contagem por
 * cidade), nunca um push por imóvel.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ endpoints: string[]; payload: { title: string; body: string; data?: { url?: string } } }> = [];
vi.mock("@/lib/push.server", () => ({
  sendPushToSubscriptions: vi.fn(async (subs: Array<{ endpoint: string }>, payload: never) => {
    sent.push({ endpoints: subs.map((s) => s.endpoint), payload });
    return { sent: subs.length, stale: [] };
  }),
}));

const { notifyAutoCheckoutBatch } = await import("@/lib/ops-push.server");

const OWNER = "a1000000-0000-4000-8000-000000000001";
const MEMBER = "a2000000-0000-4000-8000-000000000002"; // vê só P1
const props = [
  { id: "p1", owner_id: OWNER, name: "Casa 1", city: "Gramado" },
  { id: "p2", owner_id: OWNER, name: "Casa 2", city: "Gramado" },
  { id: "p3", owner_id: OWNER, name: "Casa 3", city: "Canela" },
];

function fakeAdmin() {
  const log = new Set<string>();
  return {
    rpc: async (_n: string, a: { _user_id: string; _property_id: string }) => ({
      data: a._user_id === MEMBER && a._property_id === "p1",
    }),
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const q: Record<string, unknown> = {};
      const resolve = () => {
        if (table === "properties")
          return { data: props.filter((p) => (filters.in as string[]).includes(p.id)), error: null };
        if (table === "account_members") return { data: [{ member_user_id: MEMBER }], error: null };
        if (table === "property_assignments") return { data: [], error: null };
        if (table === "push_subscriptions")
          return {
            data: (filters.in as string[]).map((u) => ({ id: u, endpoint: `ep:${u}`, p256dh: "k", auth: "a" })),
            error: null,
          };
        return { data: null, error: null };
      };
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        in: (_c: string, v: string[]) => {
          filters.in = v;
          return q;
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ko),
        insert: async (row: { dedupe_key: string }) => {
          if (log.has(row.dedupe_key)) return { error: { message: "dup" } };
          log.add(row.dedupe_key);
          return { error: null };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
        delete: () => ({ eq: async () => ({ error: null }), in: async () => ({ error: null }) }),
      });
      return q;
    },
  } as never;
}

beforeEach(() => {
  sent.length = 0;
});

describe("notifyAutoCheckoutBatch", () => {
  it("um push por pessoa/grupo com a contagem por cidade, abrindo a Fila de Limpeza", async () => {
    const admin = fakeAdmin();
    const r = await notifyAutoCheckoutBatch(admin, { propertyIds: ["p1", "p2", "p3"], runKey: "2026-11-10T14:00" });
    expect(r.notifications).toBe(2); // dono (3 imóveis) + membro (só p1)
    const owner = sent.find((s) => s.endpoints.includes(`ep:${OWNER}`))!;
    expect(owner.endpoints).toEqual([`ep:${OWNER}`]);
    expect(owner.payload.title).toBe("🧹 Aguardando Limpeza");
    expect(owner.payload.body).toContain("Gramado");
    expect(owner.payload.body).toContain("2 imóveis");
    expect(owner.payload.body).toContain("Canela");
    expect(owner.payload.body).toContain("1 imóvel");
    expect(owner.payload.data?.url).toBe("/admin/dashboard?janela=limpeza");
    const member = sent.find((s) => s.endpoints.includes(`ep:${MEMBER}`))!;
    expect(member.payload.body).toContain("1 imóvel");
    expect(member.payload.body).not.toContain("Canela");
    // nunca um push por imóvel
    expect(sent.length).toBeLessThan(3);
  });

  it("mesma rodada não repete; lista vazia não envia", async () => {
    const admin = fakeAdmin();
    await notifyAutoCheckoutBatch(admin, { propertyIds: ["p1"], runKey: "k" });
    const n = sent.length;
    await notifyAutoCheckoutBatch(admin, { propertyIds: ["p1"], runKey: "k" });
    expect(sent.length).toBe(n);
    expect((await notifyAutoCheckoutBatch(admin, { propertyIds: [], runKey: "k2" })).notifications).toBe(0);
  });

  it("a varredura de 30 min não emite mais 'Aguardando Limpeza'", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/ops-push.server.ts"), "utf8");
    const scan = src.slice(src.indexOf("export async function runOpsPushScan"), src.indexOf("export async function notifyAutoCheckoutBatch"));
    expect(scan).not.toContain("cleaningPending");
    expect(scan).not.toContain("cleaning-pending");
  });
});
