/**
 * A pausa com prazo, sob teste.
 *
 * A regra que estes casos travam é a que existe porque o contrário aconteceu:
 * conversa silenciada em 10/09 porque alguém clicou em "Assumir" e ninguém
 * lembrou de devolver. Como a expiração é preguiçosa (lida no uso, sem cron),
 * ela precisa estar certa nos dois sentidos — não soltar cedo demais, e não
 * prender para sempre.
 */
import { describe, it, expect, vi } from "vitest";
import {
  PAUSE_MINUTES,
  pausePatch,
  resumePatch,
  isPausedNow,
  minutesLeft,
  resolvePause,
} from "@/lib/ai/pause";

const AGORA = Date.parse("2026-09-11T12:00:00Z");
const emMinutos = (m: number) => new Date(AGORA + m * 60_000).toISOString();

describe("estado da pausa", () => {
  it("pausa por 30 minutos por padrão", () => {
    expect(PAUSE_MINUTES).toBe(30);
    const p = pausePatch();
    expect(p.ai_paused).toBe(true);
    const faltam = (new Date(p.paused_until).getTime() - Date.now()) / 60_000;
    expect(faltam).toBeGreaterThan(29);
    expect(faltam).toBeLessThanOrEqual(30);
  });

  it("continua calada enquanto o prazo não venceu", () => {
    expect(isPausedNow({ ai_paused: true, paused_until: emMinutos(10) }, AGORA)).toBe(true);
  });

  it("volta a falar assim que o prazo vence", () => {
    expect(isPausedNow({ ai_paused: true, paused_until: emMinutos(-1) }, AGORA)).toBe(false);
  });

  it("pausa antiga, sem prazo, continua valendo", () => {
    // As conversas anteriores à mudança têm `paused_until` nulo. Devolvê-las
    // todas de uma vez podia atropelar alguém conduzindo um caso agora.
    expect(isPausedNow({ ai_paused: true, paused_until: null }, AGORA)).toBe(true);
  });

  it("conversa não pausada nunca é considerada calada", () => {
    expect(isPausedNow({ ai_paused: false, paused_until: emMinutos(30) }, AGORA)).toBe(false);
    expect(isPausedNow(null, AGORA)).toBe(false);
  });

  it("data corrompida não solta a IA por engano", () => {
    expect(isPausedNow({ ai_paused: true, paused_until: "não é data" }, AGORA)).toBe(true);
  });

  it("conta os minutos que faltam, arredondando para cima", () => {
    expect(minutesLeft({ ai_paused: true, paused_until: emMinutos(28.2) }, AGORA)).toBe(29);
    expect(minutesLeft({ ai_paused: true, paused_until: emMinutos(-5) }, AGORA)).toBe(0);
    expect(minutesLeft({ ai_paused: true, paused_until: null }, AGORA)).toBeNull();
    expect(minutesLeft({ ai_paused: false, paused_until: emMinutos(9) }, AGORA)).toBeNull();
  });

  it("devolver limpa o prazo junto", () => {
    expect(resumePatch()).toEqual({ ai_paused: false, paused_until: null });
  });
});

describe("expiração preguiçosa", () => {
  function clientFalso() {
    const eq = vi.fn().mockResolvedValue({});
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    return { client: { from }, from, update, eq };
  }

  it("expirada: devolve a conversa à IA e grava isso no banco", async () => {
    const f = clientFalso();
    const calada = await resolvePause(f.client, "conv-1", {
      ai_paused: true,
      paused_until: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(calada).toBe(false);
    expect(f.from).toHaveBeenCalledWith("property_chat_conversations");
    expect(f.update).toHaveBeenCalledWith({ ai_paused: false, paused_until: null });
    expect(f.eq).toHaveBeenCalledWith("id", "conv-1");
  });

  it("ainda no prazo: não escreve nada", async () => {
    const f = clientFalso();
    const calada = await resolvePause(f.client, "conv-1", {
      ai_paused: true,
      paused_until: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    expect(calada).toBe(true);
    expect(f.update).not.toHaveBeenCalled();
  });

  it("nunca pausada: não escreve nada", async () => {
    const f = clientFalso();
    expect(await resolvePause(f.client, "conv-1", { ai_paused: false })).toBe(false);
    expect(f.from).not.toHaveBeenCalled();
  });

  it("falha ao gravar não derruba o atendimento", async () => {
    const quebrado = {
      from: () => ({
        update: () => ({
          eq: () => Promise.reject(new Error("banco fora")),
        }),
      }),
    };
    await expect(
      resolvePause(quebrado, "conv-1", {
        ai_paused: true,
        paused_until: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).resolves.toBe(false);
  });
});
