/**
 * TRABALHO EM SEGUNDO PLANO DENTRO DO CICLO DE VIDA DA REQUISIÇÃO (Gate G1, risco R2, 06/11/2026).
 *
 * No Cloudflare Worker, uma promessa solta (`void (async () => …)()`) pode ser encerrada junto com a resposta:
 * foi o que deixou uma sugestão do Copiloto presa em `generating`. Regra deste módulo: NUNCA soltar promessa.
 *  - Com `waitUntil` do Worker disponível (o nitro o pendura no `Request` da Cloudflare; `src/server.ts`
 *    o registra aqui no início de cada requisição), a tarefa é entregue ao `waitUntil` e a resposta não espera.
 *  - Sem `waitUntil`, mas dentro de uma requisição (`src/server.ts`): a tarefa entra na lista da requisição e
 *    `src/server.ts` a AGUARDA antes de devolver a resposta — o fluxo do canal (fallback humano, push) não
 *    espera por ela, só a resposta final. Mais lenta, nunca órfã.
 *  - Fora de qualquer requisição (scripts, testes): a promessa devolvida só resolve quando a tarefa termina.
 * A tarefa nunca rejeita para o chamador: erros são do próprio chamador (que já os trata) ou viram log fechado.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type WaitUntil = (promise: Promise<unknown>) => void;
export interface LifecycleStore {
  waitUntil: WaitUntil | null;
  /** Tarefas sem `waitUntil`: aguardadas por `src/server.ts` antes de devolver a resposta. */
  pending: Promise<void>[];
}

const storage = new AsyncLocalStorage<LifecycleStore>();

/** Extrai o `waitUntil` do Worker (nitro: `request.waitUntil`; contexto de execução: `ctx.waitUntil`). */
export function resolveWaitUntil(request: unknown, ctx?: unknown): WaitUntil | null {
  const fromReq = (request as { waitUntil?: unknown } | null)?.waitUntil;
  if (typeof fromReq === "function") return fromReq as WaitUntil;
  const c = ctx as { waitUntil?: unknown; context?: { waitUntil?: unknown } } | null | undefined;
  if (c && typeof c.waitUntil === "function") return (c.waitUntil as WaitUntil).bind(c);
  if (c?.context && typeof c.context.waitUntil === "function")
    return (c.context.waitUntil as WaitUntil).bind(c.context);
  return null;
}

/** Cria o estado da requisição (chamado por `src/server.ts`). */
export function createLifecycle(waitUntil: WaitUntil | null): LifecycleStore {
  return { waitUntil, pending: [] };
}

/** Executa `fn` com o ciclo de vida da requisição disponível para `runInBackground`. */
export function withRequestLifecycle<T>(store: LifecycleStore, fn: () => T): T {
  return storage.run(store, fn);
}

/** Aguarda as tarefas pendentes da requisição (inclusive as agendadas por outras tarefas). Nunca rejeita. */
export async function drainLifecycle(store: LifecycleStore): Promise<void> {
  while (store.pending.length > 0) {
    const batch = store.pending.splice(0, store.pending.length);
    await Promise.allSettled(batch);
  }
}

/** `true` quando há `waitUntil` do Worker para a requisição corrente. */
export function backgroundAvailable(): boolean {
  return typeof storage.getStore()?.waitUntil === "function";
}

/**
 * Agenda `task` sem deixá-la órfã. Devolve uma promessa que o chamador DEVE aguardar:
 *  - com `waitUntil`: resolve imediatamente (a tarefa segue sob o `waitUntil` do Worker);
 *  - sem `waitUntil`, dentro de requisição: resolve imediatamente (a requisição aguarda a tarefa no fim);
 *  - fora de requisição: resolve quando a tarefa termina.
 * Nunca rejeita.
 */
export function runInBackground(task: () => Promise<unknown>): Promise<void> {
  const done = (async () => {
    try {
      await task();
    } catch {
      console.error("[background] tarefa falhou (erro interno)");
    }
  })();
  const store = storage.getStore();
  if (!store) return done;
  if (store.waitUntil) {
    try {
      store.waitUntil(done);
      return Promise.resolve();
    } catch {
      // `waitUntil` recusou: cai para a lista da requisição
    }
  }
  store.pending.push(done);
  return Promise.resolve();
}
