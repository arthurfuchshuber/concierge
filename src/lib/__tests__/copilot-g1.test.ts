/**
 * COPILOTO · GATE G1 (unidade e estáticos). Nada toca a produção.
 *  - D2: ações do atendente chamam `copilot_actor_*` pelo cliente do SERVIDOR com `p_actor` = usuário da sessão;
 *    o cliente da sessão nunca chama RPC do Copiloto; ator inválido ⇒ nenhuma chamada.
 *  - R2: `runInBackground` nunca solta promessa (com `waitUntil`, sem `waitUntil` dentro da requisição, fora
 *    de requisição); o disparo do Copiloto usa esse caminho; `src/server.ts` instala o ciclo de vida.
 *  - Estáticos: nenhuma RPC do Copiloto chamada fora do servidor; nomes legados fora do código; slot `null`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  backgroundAvailable,
  createLifecycle,
  drainLifecycle,
  resolveWaitUntil,
  runInBackground,
  withRequestLifecycle,
} from "@/lib/background.server";
import { COPILOT_ACTOR_RPC, copilotActorRpc } from "@/lib/copilot-actor-rpc.server";
import {
  discardCopilotSuggestionCore,
  editCopilotSuggestionCore,
} from "@/lib/copilot-actions.server";
import { sendCopilotSuggestionCore } from "@/lib/copilot-send.server";
import { triggerCopilotSuggestion } from "@/lib/guest-ai/copilot/trigger.server";

const SRC = path.resolve(__dirname, "..", "..");
const REPO = path.resolve(SRC, "..");
const ACTOR = "5d000000-0000-4000-8000-000000000004";
const SID = "5a000000-0000-4000-8000-000000000001";
const CONV = "5b000000-0000-4000-8000-000000000002";
const MSG = "5c000000-0000-4000-8000-000000000003";

function recordingDb(responses: Record<string, unknown> = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    db: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: responses[fn] ?? { result: "x" }, error: null };
      },
    },
  };
}
/** Cliente da SESSÃO: leitura permitida; qualquer RPC é falha do teste. */
function sessionClient() {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: null, error: null });
  return {
    from: () => q,
    rpc: () => {
      throw new Error("RPC pelo cliente da sessão é proibida (Gate G1)");
    },
  };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("G1 · D2: RPCs do atendente com ator explícito pelo servidor", () => {
  it("copilotActorRpc: injeta p_actor; ator ausente/malformado ⇒ nenhuma chamada; erro do banco ⇒ código fechado", async () => {
    const r = recordingDb({ copilot_actor_edit: { result: "edited" } });
    await copilotActorRpc(r.db, COPILOT_ACTOR_RPC.edit, ACTOR, {
      p_suggestion_id: SID,
      p_text: "x",
    });
    expect(r.calls).toEqual([
      { fn: "copilot_actor_edit", args: { p_actor: ACTOR, p_suggestion_id: SID, p_text: "x" } },
    ]);
    for (const bad of ["", "u", "not-a-uuid", null, undefined, `${ACTOR} `]) {
      const z = recordingDb();
      await expect(
        copilotActorRpc(z.db, COPILOT_ACTOR_RPC.edit, bad as never, { p_suggestion_id: SID }),
      ).rejects.toThrow("copilot_actor_invalid");
      expect(z.calls).toEqual([]);
    }
    // o argumento do chamador não sobrescreve o ator da sessão
    const o = recordingDb();
    await copilotActorRpc(o.db, COPILOT_ACTOR_RPC.discard, ACTOR, { p_actor: "outro" });
    expect(o.calls[0]!.args.p_actor).toBe(ACTOR);
    const failing = {
      rpc: async () => ({ data: null, error: { message: "permission denied for function x" } }),
    };
    await expect(copilotActorRpc(failing, COPILOT_ACTOR_RPC.discard, ACTOR, {})).rejects.toThrow(
      "copilot_rpc_failed:copilot_actor_discard",
    );
  });

  it("editar e descartar: só o cliente do servidor chama RPC, com o ator da sessão", async () => {
    const env = { GUEST_AI_COPILOT_UI: "on" };
    const r = recordingDb({
      copilot_actor_edit: { result: "edited" },
      copilot_actor_discard: { result: "discarded" },
    });
    const session = sessionClient();
    await editCopilotSuggestionCore(
      session,
      ACTOR,
      { suggestionId: SID, text: "Às 15h." },
      { env, actorDb: r.db },
    );
    await discardCopilotSuggestionCore(
      session,
      ACTOR,
      { suggestionId: SID },
      { env, actorDb: r.db },
    );
    expect(r.calls.map((c) => [c.fn, c.args.p_actor])).toEqual([
      ["copilot_actor_edit", ACTOR],
      ["copilot_actor_discard", ACTOR],
    ]);
  });

  it("envio: reivindicação, encerramento e reconciliação pelo servidor com o ator da sessão", async () => {
    const r = recordingDb({
      copilot_actor_claim_send: {
        result: "claimed",
        send_token: "5e000000-0000-4000-8000-000000000005",
        text: "Às 15h.",
        conversation_id: CONV,
        property_id: "p1",
        tenant_id: "t1",
        surface: "guide_chat",
        trigger_message_id: MSG,
      },
      copilot_actor_finish_send: { result: "invalid", reason: "message_mismatch" },
      copilot_actor_reconcile_send: { result: "reconciled_sent", sent_message_id: "m-real" },
    });
    const session = sessionClient();
    const sendHuman = vi.fn(async () => ({
      ok: true as const,
      messageId: "m-x",
      channel: "web" as const,
      externalId: null,
    }));
    const out = await sendCopilotSuggestionCore(
      session,
      ACTOR,
      { suggestionId: SID },
      {
        env: { GUEST_AI_COPILOT_SEND: "on" },
        actorDb: r.db,
        sendHuman: sendHuman as never,
        guard: (async () => ({
          ok: true,
          surface: "guide_chat",
          turn: {},
          senderChannelId: null,
          senderSource: null,
        })) as never,
      },
    );
    // id recusado pelo banco (message_mismatch) ⇒ reconcilia pelo autor/instante; nunca reenvia
    expect(out).toEqual({ status: "sent", messageId: "m-real" });
    expect(sendHuman).toHaveBeenCalledTimes(1);
    expect((sendHuman.mock.calls[0] as unknown[])[0]).toBe(session); // a rotina humana do canal usa a SESSÃO
    expect(r.calls.map((c) => c.fn)).toEqual([
      "copilot_actor_claim_send",
      "copilot_actor_finish_send",
      "copilot_actor_reconcile_send",
    ]);
    expect(new Set(r.calls.map((c) => c.args.p_actor))).toEqual(new Set([ACTOR]));
  });
});

describe("G1 · R2: trabalho em segundo plano nunca fica solto", () => {
  it("resolveWaitUntil: Request do nitro, ctx.waitUntil, ctx.context.waitUntil; ausente ⇒ null", () => {
    const w = vi.fn();
    expect(resolveWaitUntil({ waitUntil: w })).toBe(w);
    const ctx = { waitUntil: vi.fn() };
    resolveWaitUntil({}, ctx)!(Promise.resolve());
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    const nested = { context: { waitUntil: vi.fn() } };
    resolveWaitUntil(null, nested)!(Promise.resolve());
    expect(nested.context.waitUntil).toHaveBeenCalledTimes(1);
    expect(resolveWaitUntil({}, {})).toBeNull();
    expect(resolveWaitUntil(undefined)).toBeNull();
  });

  it("com waitUntil: devolve na hora e entrega a tarefa ao waitUntil (que só resolve no fim da tarefa)", async () => {
    const gate = deferred();
    const handed: Promise<unknown>[] = [];
    const store = createLifecycle((p) => handed.push(p));
    let finished = false;
    await withRequestLifecycle(store, async () => {
      expect(backgroundAvailable()).toBe(true);
      await runInBackground(async () => {
        await gate.promise;
        finished = true;
      });
    });
    expect(finished).toBe(false);
    expect(handed).toHaveLength(1);
    expect(store.pending).toHaveLength(0);
    gate.resolve();
    await handed[0];
    expect(finished).toBe(true);
  });

  it("sem waitUntil, dentro da requisição: entra na lista e o servidor a aguarda antes de responder", async () => {
    const gate = deferred();
    const store = createLifecycle(null);
    let finished = false;
    await withRequestLifecycle(store, async () => {
      expect(backgroundAvailable()).toBe(false);
      await runInBackground(async () => {
        await gate.promise;
        finished = true;
      });
    });
    expect(store.pending).toHaveLength(1);
    const drained = drainLifecycle(store);
    gate.resolve();
    await drained;
    expect(finished).toBe(true);
    expect(store.pending).toHaveLength(0);
  });

  it("waitUntil que lança ⇒ cai para a lista da requisição (nunca solta)", async () => {
    const store = createLifecycle(() => {
      throw new Error("encerrada");
    });
    await withRequestLifecycle(store, () => runInBackground(async () => undefined));
    expect(store.pending).toHaveLength(1);
    await drainLifecycle(store);
  });

  it("fora de requisição: a promessa só resolve quando a tarefa termina; tarefa que lança nunca rejeita", async () => {
    let finished = false;
    await runInBackground(async () => {
      await new Promise((r) => setTimeout(r, 5));
      finished = true;
    });
    expect(finished).toBe(true);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      runInBackground(async () => Promise.reject(new Error("x"))),
    ).resolves.toBeUndefined();
    err.mockRestore();
  });

  it("disparo do Copiloto: com waitUntil volta antes da geração; sem, a requisição a aguarda; chave desligada ⇒ nada", async () => {
    const env = { GUEST_AI_COPILOT_GENERATION: "on" };
    const req = { surface: "guide_chat" as const, conversationId: CONV, messageId: MSG };
    const gate = deferred();
    const generate = vi.fn(async () => {
      await gate.promise;
      return { status: "stored" } as never;
    });
    const handed: Promise<unknown>[] = [];
    // rajada (06/11/2026): com waitUntil, espera a janela de respiro (6 s) antes de gerar, descontada do prazo
    const sleep = vi.fn(async () => {});
    await withRequestLifecycle(
      createLifecycle((p) => handed.push(p)),
      () => triggerCopilotSuggestion(req, env, { generate, sleep }),
    );
    expect(handed).toHaveLength(1);
    gate.resolve();
    await handed[0];
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(6_000);
    expect(generate).toHaveBeenCalledWith(expect.anything(), { env, deadlineMs: 19_000 });

    // sem waitUntil: fica na lista da requisição até terminar
    const store = createLifecycle(null);
    const gen2 = vi.fn(async () => ({ status: "stored" }) as never);
    const sleep2 = vi.fn(async () => {});
    await withRequestLifecycle(store, () =>
      triggerCopilotSuggestion(req, env, { generate: gen2, sleep: sleep2 }),
    );
    expect(store.pending).toHaveLength(1);
    await drainLifecycle(store);
    expect(gen2).toHaveBeenCalledTimes(1);
    // sem waitUntil a resposta do canal nunca fica presa na janela de respiro
    expect(sleep2).not.toHaveBeenCalled();
    expect(gen2).toHaveBeenCalledWith(expect.anything(), { env });

    const gen3 = vi.fn();
    await triggerCopilotSuggestion(req, {}, { generate: gen3 as never });
    await triggerCopilotSuggestion({ ...req, messageId: "x" }, env, { generate: gen3 as never });
    expect(gen3).not.toHaveBeenCalled();
  });
});

describe("G1 · estáticos", () => {
  const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");
  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "generated" || name === "node_modules") continue;
        files(full, out);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  it("nenhuma RPC do Copiloto é chamada fora de módulos do servidor; nomes legados não são usados no código", () => {
    const LEGACY =
      /["'`](copilot_edit|copilot_discard|copilot_claim_send|copilot_finish_send|copilot_reconcile_send)["'`]/;
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      const rel = path.relative(REPO, f);
      expect(LEGACY.test(src), rel).toBe(false);
      if (/\.rpc\(\s*["'`]copilot/.test(src) || src.includes("COPILOT_ACTOR_RPC")) {
        expect(rel, rel).toMatch(/\.server\.ts$/);
      }
    }
  });

  it("disparo do Copiloto sem promessa solta; servidor instala o ciclo de vida; canais aguardam o disparo", () => {
    const trigger = read("src/lib/guest-ai/copilot/trigger.server.ts");
    expect(trigger).not.toMatch(/void \(async/);
    expect(trigger).toMatch(/runInBackground\(/);
    const server = read("src/server.ts");
    expect(server).toMatch(/withRequestLifecycle\(lifecycle/);
    expect(server).toMatch(/await drainLifecycle\(lifecycle\)/);
    for (const f of [
      "src/routes/api/public/guide-chat.ts",
      "src/routes/api/public/whatsapp/sinch-webhook.ts",
      "src/lib/channex-messages.server.ts",
    ]) {
      const src = read(f);
      expect(src, f).toMatch(/await triggerCopilotSuggestion\(/);
      expect(src, f).not.toMatch(/[^t] triggerCopilotSuggestion\(\{/);
    }
  });

  it("G1b registrada em supabase/migrations com o conteúdo idêntico ao de ops/ (registro histórico)", () => {
    const ops = read("ops/copilot-g1/g1b-revoke-legacy.sql");
    const record = read("supabase/migrations/20261107000100_copilot_g1b_revoke_legacy.sql");
    expect(record.startsWith("-- REGISTRO HISTÓRICO — GATE G1b")).toBe(true);
    expect(record.endsWith(ops)).toBe(true);
    expect(
      record
        .slice(0, record.length - ops.length)
        .split("\n")
        .filter((l) => l && !l.startsWith("--")),
    ).toEqual([]);
  });

  it("slot da IA continua devolvendo null", () => {
    const slot = read("src/lib/guest-ai/slot.server.ts");
    const body = slot.slice(slot.indexOf("export async function requestGuestAiReply"));
    expect(body).toMatch(/\{\s*return null;\s*\}/);
  });
});
