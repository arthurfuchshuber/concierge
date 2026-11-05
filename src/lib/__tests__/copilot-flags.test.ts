/**
 * COPILOTO · três chaves independentes, validadas no SERVIDOR (GUEST_AI_COPILOT_UI / _GENERATION / _SEND).
 * Prova, para as 8 combinações, que cada porta só abre com a SUA chave e que, desligada, nada acontece:
 * nem leitura da tabela (UI), nem reivindicação/Gateway (geração), nem reivindicação/rotina de envio (envio).
 * Inclui o modo visual inicial (UI on, geração off, envio off) e a impossibilidade de a interface contornar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { copilotFlags, COPILOT_FLAG_ENV } from "@/lib/guest-ai/copilot/contracts";
import {
  discardCopilotSuggestionCore,
  editCopilotSuggestionCore,
  ensureCopilotSuggestionCore,
  readCopilotSuggestion,
} from "@/lib/copilot-actions.server";
import { sendCopilotSuggestionCore } from "@/lib/copilot-send.server";
import { generateCopilotSuggestion } from "@/lib/guest-ai/copilot/generate.server";
import { triggerCopilotSuggestion } from "@/lib/guest-ai/copilot/trigger.server";

type Env = Record<string, string | undefined>;
const envOf = (ui: boolean, generation: boolean, send: boolean): Env => ({
  ...(ui ? { [COPILOT_FLAG_ENV.ui]: "on" } : {}),
  ...(generation ? { [COPILOT_FLAG_ENV.generation]: "on" } : {}),
  ...(send ? { [COPILOT_FLAG_ENV.send]: "on" } : {}),
});
const COMBOS = [false, true].flatMap((ui) =>
  [false, true].flatMap((g) => [false, true].map((s) => [ui, g, s] as const)),
);
const VISUAL = envOf(true, false, false);
const SID = "5a000000-0000-4000-8000-000000000001";
const CONV = "5b000000-0000-4000-8000-000000000002";

/** Cliente de sessão falso que registra TODA leitura e RPC (para provar que nada foi tocado). */
function spyClient(rpcResult: Record<string, unknown> = {}) {
  const log: string[] = [];
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => {
      log.push(`read:${table}`);
      return table === "property_chat_conversations"
        ? {
            data: {
              id: CONV,
              guest_session_id: "sess",
              property_id: "p",
              properties: { owner_id: "t" },
            },
            error: null,
          }
        : table === "property_chat_messages"
          ? { data: { id: "m1" }, error: null }
          : { data: null, error: null };
    };
    q.then = (r: (v: unknown) => void) => {
      log.push(`read:${table}`);
      r({ data: [], error: null });
    };
    return q;
  };
  return {
    log,
    client: {
      from: (t: string) => chain(t),
      rpc: async (fn: string) => {
        log.push(`rpc:${fn}`);
        return { data: rpcResult[fn] ?? { result: "x" }, error: null };
      },
    },
  };
}

describe("Copiloto · três chaves independentes (servidor)", () => {
  it("cada chave só liga com o literal `on`; nenhuma liga a outra; a chave única antiga não liga nada", () => {
    for (const v of ["1", "true", "ON", " on", "yes", ""]) {
      expect(copilotFlags({ [COPILOT_FLAG_ENV.ui]: v })).toEqual({
        ui: false,
        generation: false,
        send: false,
      });
    }
    expect(copilotFlags({ GUEST_AI_COPILOT: "on" })).toEqual({
      ui: false,
      generation: false,
      send: false,
    });
    expect(copilotFlags(envOf(true, false, false))).toEqual({
      ui: true,
      generation: false,
      send: false,
    });
    expect(copilotFlags(envOf(false, true, false))).toEqual({
      ui: false,
      generation: true,
      send: false,
    });
    expect(copilotFlags(envOf(false, false, true))).toEqual({
      ui: false,
      generation: false,
      send: true,
    });
    expect(new Set(Object.values(COPILOT_FLAG_ENV)).size).toBe(3);
  });

  it.each(COMBOS)(
    "UI=%s GERAÇÃO=%s ENVIO=%s ⇒ cada porta obedece só à sua chave",
    async (ui, gen, send) => {
      const env = envOf(ui, gen, send);

      // leitura
      const r1 = spyClient();
      const read = await readCopilotSuggestion(r1.client, CONV, env);
      expect(read.flags).toEqual({ ui, generation: gen, send });
      expect(r1.log.some((l) => l.includes("guest_ai_copilot_suggestions"))).toBe(ui);

      // edição / descarte
      const r2 = spyClient({
        copilot_edit: { result: "edited" },
        copilot_discard: { result: "discarded" },
      });
      if (ui) {
        await expect(
          editCopilotSuggestionCore(r2.client, { suggestionId: SID, text: "x" }, env),
        ).resolves.toMatchObject({ ok: true });
        await expect(
          discardCopilotSuggestionCore(r2.client, { suggestionId: SID }, env),
        ).resolves.toMatchObject({ ok: true });
      } else {
        await expect(
          editCopilotSuggestionCore(r2.client, { suggestionId: SID, text: "x" }, env),
        ).rejects.toThrow("desativadas");
        await expect(
          discardCopilotSuggestionCore(r2.client, { suggestionId: SID }, env),
        ).rejects.toThrow("desativadas");
        expect(r2.log).toEqual([]);
      }

      // geração sob demanda (pela tela): exige UI e geração; a geração ainda confere a própria chave
      const r3 = spyClient();
      const generate = vi.fn(async () => ({
        status: "stored" as const,
        suggestionId: SID,
        state: "available" as const,
        code: null,
      }));
      const ens = await ensureCopilotSuggestionCore(r3.client, "u", CONV, {
        env,
        generate,
        requirePermission: async () => {},
      });
      if (ui && gen)
        expect(generate).toHaveBeenCalledWith(
          expect.objectContaining({ conversationId: CONV, messageId: "m1" }),
          { env },
        );
      else {
        expect(generate).not.toHaveBeenCalled();
        expect(ens.status).toBe(!ui ? "ui_disabled" : "generation_disabled");
        expect(r3.log).toEqual([]);
      }

      // envio: só a chave de envio (antes de qualquer reivindicação)
      const r4 = spyClient({ copilot_claim_send: { result: "send_in_progress" } });
      const sendHuman = vi.fn();
      const out = await sendCopilotSuggestionCore(
        r4.client,
        "u",
        { suggestionId: SID },
        {
          env,
          sendHuman: sendHuman as never,
          sendWhatsapp: sendHuman as never,
          guard: vi.fn() as never,
        },
      );
      if (send) {
        expect(out).toEqual({ status: "send_in_progress" });
        expect(r4.log).toEqual(["rpc:copilot_claim_send"]);
      } else {
        expect(out).toEqual({ status: "send_disabled" });
        expect(r4.log).toEqual([]);
      }
      expect(sendHuman).not.toHaveBeenCalled();
    },
  );

  it("geração: chave desligada ⇒ nada é validado, reivindicado ou chamado — para QUALQUER chamador (sem desvio)", async () => {
    const store = { claim: vi.fn(), state: vi.fn(), store: vi.fn() };
    const validate = vi.fn();
    for (const env of [VISUAL, envOf(true, false, true), {}]) {
      const r = await generateCopilotSuggestion(
        { surface: "guide_chat", conversationId: CONV, messageId: SID },
        { env, store, validateTurnScope: validate, db: { from: () => null } },
      );
      expect(r).toEqual({ status: "skipped", code: "generation_off", detail: null });
    }
    expect(store.claim).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    const src = readFileSync(
      path.resolve(__dirname, "..", "guest-ai", "copilot", "generate.server.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/\bforce\b/);
  });

  it("disparo dos canais: só a chave de geração liga (UI ligada não liga processamento)", async () => {
    const before = vi.fn();
    vi.doMock("@/lib/guest-ai/copilot/generate.server", () => ({
      generateCopilotSuggestion: before,
    }));
    triggerCopilotSuggestion({ surface: "whatsapp", conversationId: CONV, messageId: SID }, VISUAL);
    triggerCopilotSuggestion(
      { surface: "whatsapp", conversationId: CONV, messageId: SID },
      envOf(true, false, true),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(before).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/guest-ai/copilot/generate.server");
  });

  it("a interface não decide bloqueio: as server functions não recebem chaves do cliente e delegam aos corpos que as conferem", () => {
    const fns = readFileSync(path.resolve(__dirname, "..", "copilot.functions.ts"), "utf8");
    const schemas = [...fns.matchAll(/z\.object\(\{([^}]*)\}\)/g)].map((m) => m[1]!);
    const keys = schemas.flatMap((sc) => [...sc.matchAll(/(\w+)\s*:/g)].map((m) => m[1]!));
    expect(keys.sort()).toEqual([
      "conversationId",
      "conversationId",
      "suggestionId",
      "suggestionId",
      "suggestionId",
      "text",
      "text",
    ]);
    expect(fns.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")).not.toMatch(
      /process\.env|GUEST_AI_COPILOT/,
    );
    for (const call of [
      "readCopilotSuggestion(",
      "ensureCopilotSuggestionCore(",
      "editCopilotSuggestionCore(",
      "discardCopilotSuggestionCore(",
      "sendCopilotSuggestionCore(",
    ]) {
      expect(fns).toContain(call);
    }
    const card = readFileSync(
      path.resolve(__dirname, "..", "..", "components", "handoff", "AiSuggestionCard.tsx"),
      "utf8",
    );
    expect(card).not.toMatch(/GUEST_AI_COPILOT|process\.env|import\.meta\.env/);
  });
});
