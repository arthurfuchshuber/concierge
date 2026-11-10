/**
 * Chave de GERAÇÃO do motor da IA (GUEST_AI_COPILOT_GENERATION), validada no SERVIDOR. Desde 10/11/2026 o cartão
 * de sugestão e o envio pela equipe foram removidos (a IA responde sozinha pelo slot); as chaves de interface e
 * de envio deixaram de existir. A geração disparada pelos canais (bastidores e telemetria) continua com a chave.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { copilotFlags, COPILOT_FLAG_ENV } from "@/lib/guest-ai/copilot/contracts";
import { generateCopilotSuggestion } from "@/lib/guest-ai/copilot/generate.server";
import { triggerCopilotSuggestion } from "@/lib/guest-ai/copilot/trigger.server";

const SID = "5a000000-0000-4000-8000-000000000001";
const CONV = "5b000000-0000-4000-8000-000000000002";

describe("chave de geração (servidor)", () => {
  it("só liga com o literal `on`; não há mais chaves de interface ou de envio", () => {
    expect(Object.keys(COPILOT_FLAG_ENV)).toEqual(["generation"]);
    expect(copilotFlags({ GUEST_AI_COPILOT_GENERATION: "on" })).toEqual({ generation: true });
    for (const v of [undefined, "", "ON", "true", " on"]) expect(copilotFlags({ GUEST_AI_COPILOT_GENERATION: v }).generation).toBe(false);
  });

  it("desligada ⇒ nada é validado, reivindicado ou chamado — para QUALQUER chamador (sem desvio)", async () => {
    const store = { claim: vi.fn(), state: vi.fn(), store: vi.fn() };
    const validate = vi.fn();
    for (const env of [{}, { GUEST_AI_COPILOT_UI: "on", GUEST_AI_COPILOT_SEND: "on" }]) {
      const r = await generateCopilotSuggestion(
        { surface: "guide_chat", conversationId: CONV, messageId: SID },
        { env, store, validateTurnScope: validate, db: { from: () => null } },
      );
      expect(r).toEqual({ status: "skipped", code: "generation_off", detail: null });
    }
    expect(store.claim).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    const src = readFileSync(path.resolve(__dirname, "..", "guest-ai", "copilot", "generate.server.ts"), "utf8");
    expect(src).not.toMatch(/\bforce\b/);
  });

  it("disparo dos canais: sem a chave de geração, nada é processado", async () => {
    const before = vi.fn();
    vi.doMock("@/lib/guest-ai/copilot/generate.server", () => ({ generateCopilotSuggestion: before }));
    triggerCopilotSuggestion({ surface: "whatsapp", conversationId: CONV, messageId: SID }, {});
    await new Promise((r) => setTimeout(r, 30));
    expect(before).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/guest-ai/copilot/generate.server");
  });
});
