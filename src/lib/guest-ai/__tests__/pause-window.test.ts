/**
 * Pausa humana (15/11/2026, decisão do titular): a IA volta 10 minutos depois da ÚLTIMA MENSAGEM do humano
 * (renovada a cada nova fala). Chamado de ocorrência aberto e decisão pendente seguem valendo à parte.
 */
import { describe, expect, it } from "vitest";
import { HUMAN_PAUSE_WINDOW_MS, deriveHumanPause } from "@/lib/guest-ai/policy/human-pause";
import { PAUSE_MINUTES, isPausedNow, pausePatch } from "@/lib/chat/pause";

const T0 = Date.parse("2026-11-11T18:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const human = { id: "h1", role: "assistant", sender_type: "human", is_internal_note: false, created_at: at(0), external_id: null };
const input = (nowMin: number) => ({
  lookup: "ok" as const,
  now: at(nowMin),
  column: { ai_paused: false, paused_until: null },
  persisted: [human],
  persistedComplete: true,
  raw: [],
  rawComplete: true,
  allowedSourcePropertyIds: null,
});

describe("janela de respeito à intervenção humana", () => {
  it("10 minutos nos dois lugares (coluna de pausa e histórico)", () => {
    expect(PAUSE_MINUTES).toBe(10);
    expect(HUMAN_PAUSE_WINDOW_MS).toBe(10 * 60_000);
  });

  it("até 9 min depois da fala do humano a IA continua pausada", () => {
    expect(deriveHumanPause(input(1)).state).toBe("paused");
    expect(deriveHumanPause(input(9)).state).toBe("paused");
  });

  it("passados 10 min sem nova fala humana, a IA volta", () => {
    expect(deriveHumanPause(input(11)).state).toBe("active");
  });

  it("nova fala do humano renova os 10 minutos", () => {
    const again = { ...human, id: "h2", created_at: at(8) };
    expect(deriveHumanPause({ ...input(15), persisted: [human, again] }).state).toBe("paused");
    expect(deriveHumanPause({ ...input(19), persisted: [human, again] }).state).toBe("active");
  });

  it("coluna: pausePatch vale 10 min a partir de agora", () => {
    const p = pausePatch();
    const until = Date.parse(p.paused_until);
    expect(isPausedNow(p, until - 60_000)).toBe(true);
    expect(isPausedNow(p, until + 1)).toBe(false);
  });
});
