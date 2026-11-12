/**
 * Pausa humana (11/11/2026): a janela passou de 10 para 60 minutos desde a última intervenção da equipe (renovada a
 * cada nova mensagem). O hóspede que demora 15–59 min para responder ao atendente não recebe a IA por cima dele.
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
  it("60 minutos nos dois lugares (coluna de pausa e histórico)", () => {
    expect(PAUSE_MINUTES).toBe(60);
    expect(HUMAN_PAUSE_WINDOW_MS).toBe(60 * 60_000);
  });

  it("hóspede responde 15 min depois do atendente ⇒ a IA continua pausada", () => {
    expect(deriveHumanPause(input(15)).state).toBe("paused");
    expect(deriveHumanPause(input(59)).state).toBe("paused");
  });

  it("passados 60 min sem nova intervenção, a IA volta", () => {
    expect(deriveHumanPause(input(61)).state).toBe("active");
  });

  it("coluna: pausePatch vale 60 min a partir de agora", () => {
    const p = pausePatch();
    const until = Date.parse(p.paused_until);
    expect(isPausedNow(p, until - 15 * 60_000 - 45 * 60_000 + 15 * 60_000)).toBe(true);
    expect(isPausedNow(p, until + 1)).toBe(false);
  });
});
