/**
 * Resolvedor unificado de intenção de estadia (14/10/2026): previsão de
 * horário, check-in realizado e check-out realizado — nos 3 canais.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const applyStayEvent = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/lib/ai/stay-events.server", () => ({
  findStayForEvent: vi.fn(async () => ({ reservationId: "res1", checkinDate: "2026-10-14", checkoutDate: "2026-10-16" })),
  applyStayEvent: (...a: unknown[]) => (applyStayEvent as (...x: unknown[]) => unknown)(...a),
}));

import { normalizeStayTime, registerStayTimeForecast, registerStayDone } from "@/lib/ai/stay-intent-resolver.server";

type Row = Record<string, unknown>;
function fakeDb(initial: Row[] = []) {
  const rows = [...initial];
  const writes: Array<{ op: string; row: Row }> = [];
  const builder = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const api = {
      select: () => api,
      eq: (k: string, v: unknown) => (filters.push([k, v]), api),
      order: () => api,
      limit: async () => ({
        data:
          table === "guide_access_logs"
            ? [{ id: "log1" }]
            : rows.filter((r) => filters.every(([k, v]) => r[k] === v)),
        error: null,
      }),
      update: (patch: Row) => ({
        eq: async (_k: string, id: unknown) => {
          const r = rows.find((x) => x.id === id);
          if (r) Object.assign(r, patch);
          writes.push({ op: "update", row: patch });
          return { error: null };
        },
      }),
      insert: async (row: Row) => {
        rows.push({ id: `n${rows.length}`, ...row });
        writes.push({ op: "insert", row });
        return { error: null };
      },
    };
    return api;
  };
  return { db: { from: builder } as never, rows, writes };
}
const ref = { propertyId: "p1", checkinDate: "2026-10-14", checkoutDate: "2026-10-16", guestName: "Ana" };

describe("normalizeStayTime", () => {
  it.each([
    ["15:30", "15:30"],
    ["15h", "15:00"],
    ["umas 10h30", "10:30"],
    ["3 da tarde", "15:00"],
    ["3pm", "15:00"],
    ["meio-dia", "12:00"],
    ["8 da manhã", "08:00"],
  ])("%s → %s", (i, o) => expect(normalizeStayTime(i)).toBe(o));
  it.each(["à tarde", "depois do almoço", "às 3", "3h", "", "25h"])("ambíguo/inválido: %s", (i) =>
    expect(normalizeStayTime(i)).toBeNull(),
  );
});

describe("previsão de horário", () => {
  beforeEach(() => applyStayEvent.mockClear());
  it("grava previsão de check-in com source 'ai'", async () => {
    const { db, writes } = fakeDb();
    const r = await registerStayTimeForecast(db, ref, { kind: "checkin", time: "15h" });
    expect(r).toMatchObject({ ok: true, horario: "15:00" });
    expect(writes[0].row).toMatchObject({ kind: "checkin", arrival_time_override: "15:00", arrival_time_source: "ai", reservation_id: "res1", log_id: "log1" });
  });
  it("grava previsão de check-out e atualiza linha existente (sem duplicar)", async () => {
    const { db, writes, rows } = fakeDb([{ id: "a", kind: "checkout", reservation_id: "res1", status: "pending", arrival_time_override: "09:00", arrival_time_source: "guest" }]);
    const r = await registerStayTimeForecast(db, ref, { kind: "checkout", time: "10h30" });
    expect(r.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe("update");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ arrival_time_override: "10:30", arrival_time_source: "ai" });
  });
  it("não sobrescreve horário da equipe nem regride 'done'", async () => {
    const staff = fakeDb([{ id: "a", kind: "checkin", reservation_id: "res1", status: "pending", arrival_time_override: "12:00", arrival_time_source: "staff" }]);
    expect(await registerStayTimeForecast(staff.db, ref, { kind: "checkin", time: "16h" })).toMatchObject({ ok: false, motivo: "horario_definido_pela_equipe" });
    expect(staff.writes).toHaveLength(0);
    const done = fakeDb([{ id: "b", kind: "checkin", reservation_id: "res1", status: "done", done_at: "2026-10-14T15:00:00Z", arrival_time_override: null, arrival_time_source: null }]);
    expect(await registerStayTimeForecast(done.db, ref, { kind: "checkin", time: "16h" })).toMatchObject({ ok: true, motivo: "ja_concluido" });
    expect(done.writes).toHaveLength(0);
  });
  it("horário ambíguo não grava", async () => {
    const { db, writes } = fakeDb();
    expect(await registerStayTimeForecast(db, ref, { kind: "checkin", time: "à tarde" })).toMatchObject({ ok: false, motivo: "horario_ambiguo" });
    expect(writes).toHaveLength(0);
  });
});

describe("confirmação de entrada/saída", () => {
  it("check-in e check-out realizados vão pela rotina do painel (done + done_at)", async () => {
    applyStayEvent.mockClear();
    const { db } = fakeDb();
    await registerStayDone(db, ref, "checkin");
    await registerStayDone(db, ref, "checkout");
    expect(applyStayEvent.mock.calls.map((c) => c[2])).toEqual(["checkin", "checkout"]);
  });
});

describe("os 3 canais usam o mesmo núcleo", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  it.each([
    ["Airbnb (Channex)", "src/lib/channex-messages.server.ts"],
    ["WhatsApp", "src/routes/api/public/whatsapp/sinch-webhook.ts"],
    ["Guia Digital", "src/routes/api/public/guide-chat.ts"],
  ])("%s chama runHospitalityAgent", (_n, f) => {
    expect(read(f)).toMatch(/runHospitalityAgent/);
  });
  it("ferramentas registradas no agente e na suíte de ferramentas", () => {
    expect(read("src/lib/ai/agents/registry.server.ts")).toContain('"register_stay_time_forecast"');
    expect(read("src/lib/ai/agents/registry.server.ts")).toContain('"register_guest_stay_event"');
    expect(read("src/lib/ai/tools.server.ts")).toContain('name: "register_stay_time_forecast"');
  });
});

import { isLimitExpression } from "@/lib/ai/stay-intent-resolver.server";
describe("previsão de saída — madrugada e limite", () => {
  it("02:30 em 24h é explícito", () => { expect(normalizeStayTime("02:30")).toBe("02:30"); });
  it("'às 3h' sem período continua ambíguo", () => { expect(normalizeStayTime("às 3h")).toBeNull(); });
  it("saída nos últimos minutos = limite", () => {
    expect(isLimitExpression("Eu vou sair nos últimos min que tenho para sair")).toBe(true);
    expect(isLimitExpression("limite")).toBe(true);
    expect(isLimitExpression("à tarde")).toBe(false);
  });
});
