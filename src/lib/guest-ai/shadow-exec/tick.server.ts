/**
 * F2-B · B3.3 — TICK do Shadow (rota `/api/public/guest-ai/shadow-tick`). PERMANENTEMENTE DESLIGADO
 * na Entrega 2.
 *
 * Ordem (nada é lido antes de cada portão passar):
 *  1. Chave mestra `GUEST_AI_SHADOW=on` (só ambiente; nunca query, body ou cabeçalho) — desligada ⇒ 404,
 *     sem ler segredo, corpo, banco ou qualquer outra coisa.
 *  2. Segredo de cron (`verifyCronSecret`) — inválido ⇒ 401.
 *  3. Portão de LIBERAÇÃO em código (`SHADOW_TICK_RELEASED`, literal `false`): mesmo com a chave ligada
 *     e o segredo válido, nada executa até uma mudança de código revisada (Entrega 4).
 *  4. (liberado) estado global + configuração + manifesto → TRAVA GLOBAL do tick (F-07: um único worker
 *     ativo; outro tick simultâneo sai com `tick_busy`) → reconciliação de execuções de workers perdidos
 *     (F-01/F-04/F-05: sela, liquida pelo pior caso, registra) → até 3 candidatas pelo relógio do BANCO →
 *     worker, em série, com o token da trava → liberação da trava.
 * A resposta tem SÓ códigos e contadores (`ShadowTickSummary`). Exceção ⇒ código fixo, sem conteúdo.
 */
import { verifyCronSecret } from "@/lib/cron-auth.server";
import type { ShadowCandidate, CandidatesResult } from "@/lib/guest-ai/data/shadow-candidates.server";
import type { ShadowStore } from "@/lib/guest-ai/data/shadow-store.server";
import { validateShadowControl } from "./breakers";
import type { ShadowTickSummary } from "./contracts";
import { defaultMasterSwitch } from "./gateway-generator.server";
import type { ShadowWorkerOutcome } from "./worker.server";

/** Portão de liberação: só uma mudança de código revisada (Entrega 4) o abre. */
export const SHADOW_TICK_RELEASED = false as boolean;

export interface TickIo {
  masterSwitchOn: () => boolean;
  verifySecret: (request: Request) => boolean;
  released: boolean;
  store: () => Promise<ShadowStore>;
  candidates: (entries: Parameters<typeof import("@/lib/guest-ai/data/shadow-candidates.server").listShadowCandidates>[0], opts: { limit: number; tickIntervalSeconds: number; nowMs: number }) => Promise<CandidatesResult>;
  worker: (c: ShadowCandidate, tickToken: string) => Promise<ShadowWorkerOutcome>;
}

const empty = (outcome: ShadowTickSummary["outcome"]): ShadowTickSummary => Object.freeze({ outcome, conversationsConsidered: 0, executed: 0, blocked: 0, failed: 0 });
const json = (body: ShadowTickSummary | { error: string }, status: number) => Response.json(body, { status });

/** Executa um tick (só depois dos portões). Nunca lança. */
export async function runShadowTick(io: Pick<TickIo, "store" | "candidates" | "worker">): Promise<ShadowTickSummary> {
  let store: ShadowStore | null = null;
  let token: string | null = null;
  try {
    store = await io.store();
    const control = await store.readControl();
    if (!control) return empty("state_unreadable");
    if (control.state !== "running") return empty("state_not_running");
    const v = validateShadowControl(control);
    if (!v.ok) return empty("limits_missing");
    const manifest = await store.readManifest();
    if (!manifest || manifest.manifestVersion !== v.limits.manifestVersion || manifest.entries.length === 0) return empty("manifest_unreadable");
    const tick = await store.acquireTick();
    if (tick.kind === "busy") return empty("tick_busy");
    if (tick.kind === "blocked") return empty(tick.code === "state_not_running" ? "state_not_running" : "limits_missing");
    if (tick.kind !== "acquired") return empty("tick_failed");
    token = tick.token;
    // workers perdidos primeiro: nada novo começa enquanto houver execução órfã sem encerramento
    const rec = await store.reconcile(token);
    if (rec.kind !== "ok") return empty("tick_failed");
    const found = await io.candidates(manifest.entries, { limit: v.limits.maxConversationsPerTick, tickIntervalSeconds: v.limits.tickIntervalSeconds, nowMs: tick.dbNowMs });
    if (!found.ok) {
      if (found.integrity) await store.trip("integrity_violation", "integrity_divergence");
      return empty("tick_failed");
    }
    let executed = 0;
    let blocked = 0;
    let failed = 0;
    const list = found.candidates.slice(0, v.limits.maxConversationsPerTick);
    for (const c of list) {
      const r = await io.worker(c, token);
      if (r.status === "recorded") executed++;
      else if (r.status === "record_failed") failed++;
      else blocked++;
      if (r.status === "record_failed") break; // medição indisponível: não continua
      if (r.status === "skipped" && r.code === "tick_not_held") break; // trava perdida: para o tick
    }
    return Object.freeze({ outcome: "executed", conversationsConsidered: list.length, executed, blocked, failed });
  } catch {
    return empty("tick_failed");
  } finally {
    if (store && token) await store.releaseTick(token).catch(() => "error");
  }
}

/** Entrada da rota. Os portões 1–3 vêm antes de qualquer leitura. */
export async function handleShadowTick(request: Request, io?: Partial<TickIo>): Promise<Response> {
  const switchOn = io?.masterSwitchOn ?? defaultMasterSwitch;
  if (switchOn() !== true) return new Response(null, { status: 404 });
  const verify = io?.verifySecret ?? verifyCronSecret;
  if (!verify(request)) return json({ error: "unauthorized" }, 401);
  const released = io?.released ?? SHADOW_TICK_RELEASED;
  if (released !== true) return json(empty("not_released"), 200);
  try {
    const full = io?.store && io.candidates && io.worker ? (io as TickIo) : await productionTickIo();
    return json(await runShadowTick(full), 200);
  } catch {
    return json(empty("tick_failed"), 200);
  }
}

/** Ligação de produção (imports dinâmicos; só alcançada com o portão de liberação aberto). */
async function productionTickIo(): Promise<Pick<TickIo, "store" | "candidates" | "worker">> {
  const [{ productionWorkerIo, runShadowWorker }, { listShadowCandidates }, { getShadowStore }] = await Promise.all([
    import("./worker.server"),
    import("@/lib/guest-ai/data/shadow-candidates.server"),
    import("@/lib/guest-ai/data/shadow-store.server"),
  ]);
  const workerIo = await productionWorkerIo();
  return {
    store: () => getShadowStore(),
    candidates: (entries, opts) => listShadowCandidates(entries, opts),
    worker: (c, tickToken) => runShadowWorker(c, { ...workerIo, tickToken }),
  };
}
