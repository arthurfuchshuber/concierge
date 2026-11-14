import { describe, expect, it, vi } from "vitest";
import { isGuestMemoryUnavailable } from "@/lib/guest-memory/unavailable";
import { createSupabaseGuestMemoryStore, runGuestMemoryCycle } from "@/lib/guest-memory/worker.server";

const env = { GUEST_MEMORY_WORKER: "on", GUEST_MEMORY_DAILY_COST_USD: "1" };
const pending = { reservationId: "r1", propertyId: "p1", tenantId: "t1", checkoutDate: "2026-11-14" };
const errors = [
  { code: "42P01", message: "missing relation" },
  { code: "42883", message: "missing function" },
  { code: "PGRST205", message: "missing table" },
  { code: "PGRST202", message: "missing RPC" },
  { message: "relation guest_ai_guest_profiles does not exist" },
  { message: "function guest_ai_pending_stay_memories does not exist" },
  { message: "Could not find the table in the schema cache" },
  { message: "Could not find the function" },
];

function fakeAdmin(failAt: string, error: unknown) {
  const calls: string[] = [];
  const admin = {
    from(table: string) {
      const q: any = {
        select() { return q; }, eq() { return q; },
        limit: async () => { calls.push(`read:${table}`); return { data: [], error: table === failAt ? error : null }; },
        maybeSingle: async () => {
          calls.push(`read:${table}`);
          return { data: table === "guest_ai_guest_profiles" ? null : {}, error: table === failAt ? error : null };
        },
      };
      return q;
    },
    async rpc(name: string) {
      calls.push(name);
      return { data: name === "guest_ai_pending_stay_memories" ? [{ reservation_id: "r1", property_id: "p1", tenant_id: "t1", checkout_date: "2026-11-14" }] : {}, error: name === failAt ? error : null };
    },
  };
  return { admin, calls };
}

describe("memória não ativada", () => {
  it.each(errors)("detecta relação/função ausente sem depender do texto pessoal: %j", error => {
    expect(isGuestMemoryUnavailable(error)).toBe(true);
  });
  it.each([null, { code: "42501", message: "permission denied" }, new Error("network offline"), { code: "PGRST204", message: "column missing" }])("não mascara outros erros: %j", error => {
    expect(isGuestMemoryUnavailable(error)).toBe(false);
  });
  it.each(["guest_ai_guest_profiles", "guest_ai_guest_identities", "guest_ai_pending_stay_memories", "guest_ai_claim_stay_memory"])("%s ausente termina sem gravar/encerrar fila ou repetir", async target => {
    const { admin, calls } = fakeAdmin(target, { code: "42P01" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await runGuestMemoryCycle({ store: createSupabaseGuestMemoryStore(admin), env, log: () => undefined });
      expect(result).toMatchObject({ stoppedBy: "not_activated", processed: 0, failed: 0, skipped: 0, costUsd: 0 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(calls.filter(c => c === target || c === `read:${target}`)).toHaveLength(1);
      expect(calls).not.toContain("guest_ai_finish_stay_memory");
      expect(calls).not.toContain("guest_ai_upsert_titular_profile");
      expect(calls).not.toContain("guest_ai_record_stay_summary");
      if (target.startsWith("guest_ai_guest_")) expect(calls.every(c => c.startsWith("read:"))).toBe(true);
    } finally { warn.mockRestore(); }
  });
  it("pending com outro erro continua lançando pending_failed", async () => {
    const { admin } = fakeAdmin("guest_ai_pending_stay_memories", { code: "42501", message: "permission denied" });
    await expect(runGuestMemoryCycle({ store: createSupabaseGuestMemoryStore(admin), env })).rejects.toThrow("pending_failed");
  });
  it("claim com outro erro mantém notClaimed e não sinaliza ausência", async () => {
    const { admin } = fakeAdmin("guest_ai_claim_stay_memory", { code: "42501" });
    expect(await runGuestMemoryCycle({ store: createSupabaseGuestMemoryStore(admin), env, log: () => undefined })).toMatchObject({ stoppedBy: "none", notClaimed: 1, failed: 0 });
  });
  it.each(["upsertTitular", "profile", "record", "finish"])("%s ausente não vira falha definitiva e interrompe o lote", async method => {
    const store = {
      pending: vi.fn(async () => [pending, { ...pending, reservationId: "r2" }]),
      claim: vi.fn(async () => ({ kind: "claimed" as const, token: "token", attempt: 1 })),
      material: vi.fn(async () => ({ otaGuestId: null, phones: [], guestName: null, checkinDate: null, checkoutDate: null, checkinTime: null, checkoutTime: null, timeZone: null, checkinCard: null, checkoutCard: null, messages: [] })),
      upsertTitular: vi.fn(async () => ({ canonicalId: "g1" })),
      profile: vi.fn(async () => ({ reservationIds: new Set<string>(), notes: [], assessment: {}, stays: [] })),
      record: vi.fn(async () => "recorded" as const),
      finish: vi.fn(async () => "finished" as const),
    };
    store[method as "finish"].mockRejectedValueOnce({ code: "PGRST202" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await runGuestMemoryCycle({ store, env, log: () => undefined })).toMatchObject({ stoppedBy: "not_activated", failed: 0, skipped: 0, recorded: 0 });
      expect(store.claim).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      if (method !== "finish") expect(store.finish).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
  it.each(["guest_ai_upsert_titular_profile", "guest_ai_record_stay_summary", "guest_ai_finish_stay_memory"])("handler %s preserva erro de ausência", async target => {
    const { admin } = fakeAdmin(target, { code: "42883" });
    const store = createSupabaseGuestMemoryStore(admin);
    const call = target.includes("upsert") ? store.upsertTitular("t1", null, [], null)
      : target.includes("record") ? store.record({ tenantId: "t1", canonicalId: "g1", reservationId: "r1", checkoutDate: "2026-11-14", token: "token", result: {} as never })
      : store.finish("r1", "token", "done", "recorded", 0);
    await expect(call).rejects.toMatchObject({ message: "guest_memory_not_activated" });
  });
  it("handler de perfil propaga ausência e mantém null para outro erro", async () => {
    const absent = fakeAdmin("guest_ai_guest_profiles", { code: "PGRST205" });
    await expect(createSupabaseGuestMemoryStore(absent.admin).profile("t1", "g1")).rejects.toMatchObject({ message: "guest_memory_not_activated" });
    const other = fakeAdmin("guest_ai_guest_profiles", { code: "42501" });
    expect(await createSupabaseGuestMemoryStore(other.admin).profile("t1", "g1")).toBeNull();
  });
});