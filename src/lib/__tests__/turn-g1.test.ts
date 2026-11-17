/**
 * IA · GATE G1 (unidade e estáticos). Nada toca a produção.
 *  - R2: `runInBackground` nunca solta promessa (com `waitUntil`, sem `waitUntil` dentro da requisição, fora
 *    de requisição); `src/server.ts` instala o ciclo de vida.
 *  - Estáticos: nenhuma RPC da IA chamada fora do servidor; slot `null`.
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

const SRC = path.resolve(__dirname, "..", "..");
const REPO = path.resolve(SRC, "..");
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

  it("requisições concorrentes mantêm tarefas isoladas mesmo após await", async () => {
    const gate = deferred();
    const handed: Promise<unknown>[] = [];
    const workerStore = createLifecycle((p) => handed.push(p));
    const fallbackStore = createLifecycle(null);
    await Promise.all([
      withRequestLifecycle(workerStore, async () => {
        await gate.promise;
        expect(backgroundAvailable()).toBe(true);
        await runInBackground(async () => undefined);
      }),
      withRequestLifecycle(fallbackStore, async () => {
        expect(backgroundAvailable()).toBe(false);
        gate.resolve();
        await Promise.resolve();
        await runInBackground(async () => undefined);
      }),
    ]);
    expect(handed).toHaveLength(1);
    expect(workerStore.pending).toHaveLength(0);
    expect(fallbackStore.pending).toHaveLength(1);
    await Promise.all([drainLifecycle(fallbackStore), ...handed]);
    expect(fallbackStore.pending).toHaveLength(0);
    expect(backgroundAvailable()).toBe(false);
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

  it("nenhuma RPC da IA é chamada fora de módulos do servidor", () => {
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      const rel = path.relative(REPO, f);
      if (/\.rpc\(\s*["'`]guest_ai_(claim_turn|turn_state|store_turn|purge_turns|record_trace|release_unsent_turn)/.test(src)) {
        expect(rel, rel).toMatch(/\.server\.ts$/);
      }
    }
  });

  it("slot da IA: sem GUEST_AI_AUTONOMOUS=on devolve null (fail-closed)", () => {
    const slot = read("src/lib/guest-ai/slot.server.ts");
    const body = slot.slice(slot.indexOf("export async function requestGuestAiReply"));
    expect(body).toMatch(/if \(!autonomousEnabled\(env\)\) return null;/);
    expect(slot).toMatch(/env\["GUEST_AI_AUTONOMOUS"\] === "on"/);
  });
});
