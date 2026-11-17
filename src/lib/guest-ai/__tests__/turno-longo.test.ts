import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LONG_TURN } from "@/lib/guest-ai/turn/contracts";
import { AUTONOMOUS_DEADLINE_MS, turnTimings } from "@/lib/guest-ai/turn/generate.server";
import { LIMITS } from "@/lib/guest-ai/llm/contracts";
import { TURN_DEADLINE_CEILING_MS } from "@/lib/guest-ai/turn-chain";
import { airbnbTurnPayload, parseAirbnbTurnPayload } from "@/lib/channex-messages.server";
import { reservationChangeNote } from "@/lib/channex-webhook.server";

// 17/11/2026 (casos Larissa, Pamela): o turno no webhook morria em ~30 s; o titular quer mais tempo e raciocínio livre.
describe("turno longo", () => {
  it("autônomo em requisição própria: 80 s, chamadas de 45 s, nova tentativa com ≥ 20 s e sempre em auto", () => {
    expect(turnTimings({ longTurn: true })).toEqual({
      deadlineMs: 80_000,
      stageMaxMs: 45_000,
      callMaxMs: 45_000,
      retryMinMs: 20_000,
      timeoutRetryEffort: "auto",
    });
  });
  it("sem a requisição própria (disparo falhou) segue o prazo curto de antes", () => {
    expect(turnTimings({ longTurn: false })).toMatchObject({ deadlineMs: AUTONOMOUS_DEADLINE_MS, timeoutRetryEffort: "low" });
  });
  it("os tetos de baixo comportam o turno longo e a contingência só entra depois da geração", () => {
    expect(LIMITS.maxTimeoutMs).toBeGreaterThanOrEqual(LONG_TURN.callMaxMs);
    expect(TURN_DEADLINE_CEILING_MS).toBeGreaterThanOrEqual(LONG_TURN.stageMaxMs);
    expect(LONG_TURN.fallbackMs).toBeGreaterThan(LONG_TURN.deadlineMs);
    expect(LONG_TURN.deadlineMs - LONG_TURN.callMaxMs).toBeGreaterThanOrEqual(LONG_TURN.retryMinMs);
    // pg_net espera 150 s: sobra para entrega e encaminhamento
    const sql = readFileSync("supabase/migrations/20261117120000_dispatch_guest_ai_turn.sql", "utf8");
    expect(sql).toMatch(/timeout_milliseconds := 150000/);
    expect(sql).toMatch(/\/api\/public\/ia\/turno/);
    expect(sql).toMatch(/grant execute on function public\.dispatch_guest_ai_turn\(jsonb\) to service_role/);
  });
  it("o webhook e a varredura disparam o turno; a rota roda o mesmo turno com prazo longo", () => {
    const msgs = readFileSync("src/lib/channex-messages.server.ts", "utf8");
    expect(msgs).toMatch(/await dispatchAirbnbAiTurn\(admin, \{/);
    expect(msgs).toMatch(/rpc\("dispatch_guest_ai_turn"/);
    expect(readFileSync("src/lib/post-pause-sweep.server.ts", "utf8")).toMatch(/dispatchAirbnbAiTurn\(d, t\)/);
    const route = readFileSync("src/routes/api/public/ia.turno.ts", "utf8");
    expect(route).toMatch(/runAirbnbAiTurn\(supabaseAdmin, turn, \{ longTurn: true \}\)/);
    expect(route).toMatch(/CRON_SECRET/);
    expect(readFileSync("src/lib/guest-ai/slot.server.ts", "utf8")).toMatch(/longTurn: req\.longTurn === true/);
  });
  it("corpo do disparo: ida e volta preservam o turno; campos inválidos ⇒ recusado", () => {
    const t = {
      convId: "b5e0a289-ddce-4300-a754-42ea0b11da9a",
      threadId: "f625813e-a0f9-4215-828c-5d82db7c205a",
      guestName: "Pamela",
      guestContent: "Boa noite",
      propertyId: "782d1ada-f9dd-43f2-a417-3973db5f70a2",
      ownerId: "25239e5b-1a66-46f1-b9a2-829c499cc366",
      propertyName: "Apartamento",
      guestMessageId: "db992672-f588-405d-a912-bcd180b11056",
      guestCreatedAt: "2026-11-16T23:28:01Z",
    };
    expect(parseAirbnbTurnPayload(JSON.parse(JSON.stringify(airbnbTurnPayload(t))))).toEqual(t);
    expect(parseAirbnbTurnPayload({ ...t, convId: "x" })).toBeNull();
    expect(parseAirbnbTurnPayload({ ...t, guestMessageId: null })).toBeNull();
    expect(parseAirbnbTurnPayload({ ...t, ownerId: "1; drop" })).toBeNull();
    expect(parseAirbnbTurnPayload(null)).toBeNull();
  });
});

describe("alteração da reserva vira registro na conversa (caso Larissa)", () => {
  const antes = { checkin_date: "2026-11-19", checkout_date: "2026-11-22", occupancy: { adults: 4, children: 0, infants: 0 } };
  it("hóspedes mudaram ⇒ registro com antes e agora", () => {
    expect(reservationChangeNote(antes, { ...antes, occupancy: { adults: 5, children: 0, infants: 0 } })).toBe(
      "Reserva alterada na plataforma: hóspedes de 4 para 5.",
    );
  });
  it("datas mudaram ⇒ registro com as datas", () => {
    expect(reservationChangeNote(antes, { ...antes, checkout_date: "2026-11-23" })).toBe(
      "Reserva alterada na plataforma: datas de 19/11–22/11 para 19/11–23/11.",
    );
  });
  it("nada mudou (reenvio da mesma revisão) ou ocupação desconhecida ⇒ nenhum registro", () => {
    expect(reservationChangeNote(antes, { ...antes })).toBeNull();
    expect(reservationChangeNote(antes, { ...antes, occupancy: null })).toBeNull();
  });
});
