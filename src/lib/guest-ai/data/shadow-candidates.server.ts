/**
 * F2-B · B3.3 (revisão E4 GLOBAL) — Descoberta de conversas candidatas ao Shadow.
 *
 * A escolha acontece NO BANCO (`shadow_list_candidates`, migration de escopo global de 05/11/2026):
 * só com a trava do tick vigente, só imóveis ATIVOS (escopo global + elegibilidade + interruptores, ao vivo),
 * conversa com mensagem de hóspede dentro da janela de atividade, sem execução em andamento e ainda não
 * avaliada depois dessa mensagem; rodízio entre tenants e ordem de chegada dentro de cada tenant; nunca mais
 * que o teto por tick. Não existe lista de imóveis no processo (nenhum teto de imóveis, nenhum `IN (...)`
 * que cresça com a base). O banco devolve só ids e o código da superfície — nunca texto nem o id de sessão.
 * Janela de atividade: só valores aprovados (espera máxima do coletor + carência + cadência do tick).
 */
import type { GuestSurface } from "@/lib/guest-ai/types";
import { COLLECTOR_DEFAULTS } from "@/lib/guest-ai/batch/collector";
import type { ShadowStore } from "./shadow-store.server";

export interface ShadowCandidate {
  conversationId: string;
  propertyId: string;
  tenantId: string;
  surface: GuestSurface;
  messageId: string;
}

export type CandidatesResult =
  | { ok: true; candidates: readonly ShadowCandidate[] }
  | { ok: false; integrity: boolean; code?: "state_not_running" | "tick_not_held" | "scope_off" | "config_incomplete" };

/** Janela de atividade (ms): só valores aprovados (coletor B3.1 + cadência configurada). */
export function candidateLookbackMs(tickIntervalSeconds: number): number {
  return COLLECTOR_DEFAULTS.maxWaitMs + COLLECTOR_DEFAULTS.reconciliationGraceMs + tickIntervalSeconds * 1000;
}

export async function listShadowCandidates(
  store: Pick<ShadowStore, "listCandidates">,
  opts: { tickToken: string; limit: number; tickIntervalSeconds: number },
): Promise<CandidatesResult> {
  try {
    if (!Number.isInteger(opts.limit) || opts.limit < 1 || !Number.isInteger(opts.tickIntervalSeconds) || opts.tickIntervalSeconds < 1) return { ok: false, integrity: false };
    const lookbackSeconds = Math.ceil(candidateLookbackMs(opts.tickIntervalSeconds) / 1000);
    const r = await store.listCandidates(opts.tickToken, lookbackSeconds, opts.limit);
    if (r.kind === "ok") return { ok: true, candidates: r.candidates };
    if (r.kind === "blocked") return { ok: false, integrity: false, code: r.code };
    return { ok: false, integrity: r.integrity };
  } catch {
    return { ok: false, integrity: false };
  }
}
