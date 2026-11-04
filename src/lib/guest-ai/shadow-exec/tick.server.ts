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
 *  4. (liberado) estado global + configuração + manifesto → candidatas → worker, em série.
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
  worker: (c: ShadowCandidate) => Promise<ShadowWorkerOutcome>;
  wallNow?: () => number;
}

const empty = (outcome: ShadowTickSummary["outcome"]): ShadowTickSummary => Object.freeze({ outcome, conversationsConsidered: 0, executed: 0, blocked: 0, failed: 0 });
const json = (body: ShadowTickSummary | { error: string }, status: number) => Response.json(body, { status });

/** Executa um tick (só depois dos portões). Nunca lança. */
export async function runShadowTick(io: Pick<TickIo, "store" | "candidates" | "worker" | "wallNow">): Promise<ShadowTickSummary> {
  try {
    const store = await io.store();
    const control = await store.readControl();
    if (!control) return empty("state_unreadable");
    if (control.state !== "running") return empty("state_not_running");
    const v = validateShadowControl(control);
    if (!v.ok) return empty("limits_missing");
    const manifest = await store.readManifest();
    if (!manifest || manifest.manifestVersion !== v.limits.manifestVersion || manifest.entries.length === 0) return empty("manifest_unreadable");
    const found = await io.candidates(manifest.entries, { limit: v.limits.maxConversationsPerTick, tickIntervalSeconds: v.limits.tickIntervalSeconds, nowMs: (io.wallNow ?? Date.now)() });
    if (!found.ok) {
      if (found.integrity) await store.trip("integrity_violation", "integrity_divergence");
      return empty("tick_failed");
    }
    let executed = 0;
    let blocked = 0;
    let failed = 0;
    for (const c of found.candidates) {
      const r = await io.worker(c);
      if (r.status === "recorded") executed++;
      else if (r.status === "record_failed") failed++;
      else blocked++;
      if (r.status === "record_failed") break; // medição indisponível: não continua
    }
    return Object.freeze({ outcome: "executed", conversationsConsidered: found.candidates.length, executed, blocked, failed });
  } catch {
    return empty("tick_failed");
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
    worker: (c) => runShadowWorker(c, workerIo),
  };
}
