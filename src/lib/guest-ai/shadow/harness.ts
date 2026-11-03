/**
 * F2-B · B2.4 — HARNESS PASSIVO do Shadow Mode (fundação B3). Só LLM Mock, só leitura, nada sai.
 *
 * Pipeline (reutiliza `runTurnChain`, B2.3 — não há segunda cadeia):
 *   ValidatedTurn → Context → Dossier → FreeTextGuard → Composer → LLM Mock → Parser →
 *   Structural Validator → Semantic Validator → Final Decision → Passive Telemetry
 *
 * BARREIRA PASSIVA ESTRUTURAL (não é uma flag):
 *  1. O harness só aceita PORTAS DE LEITURA de uma lista fechada (`READ_PORTS`) e opções de lista
 *     fechada (`HARNESS_KEYS`). Qualquer outra dependência (envio, chamado, escrita, RPC, cliente de
 *     banco, integração) ⇒ `passive_barrier_violation` ANTES de executar qualquer coisa.
 *  2. O gerador é OBRIGATORIAMENTE um `LlmMock` emitido por `createLlmMock` (registro WeakSet): não é
 *     possível plugar o Gateway nem outra função. `modelMode: "mock"` é literal no resultado.
 *  3. Os `ChainDeps` são montados aqui, campo a campo (nunca por espalhamento do que veio de fora).
 *  4. Este arquivo não importa Gateway, provedores, `data/`, canais nem o cliente do banco (teste estático).
 *  5. A telemetria recebe um registro congelado, sem texto; falha/lentidão dela nunca altera nem
 *     atrasa a decisão (chamada síncrona protegida; promessa devolvida é ignorada).
 * O resultado é SEMPRE `delivery: "not_sent"`, `effectsExecuted: false`, `modelMode: "mock"`.
 */
import { runTurnChain, type ChainDeps, type ChainInput, type ChainOutcome } from "@/lib/guest-ai/turn-chain";
import type { FreeTextGuard } from "@/lib/guest-ai/composer";
import type { BudgetConfig } from "@/lib/guest-ai/budget";
import type { PriorMilestones } from "@/lib/guest-ai/validation/semantic-validator";
import { isLlmMock, type LlmMock } from "./llm-mock";
import { buildShadowRecord, type ShadowTurnRecord } from "./telemetry";

export const SHADOW_HARNESS_VERSION = "shadow-harness.2026-11-03.2";

/** Portas permitidas: só LEITURA (cada uma devolve dados; nenhuma executa efeito). */
export const READ_PORTS = ["loadContext", "loadHistory", "loadDossiers", "loadStayAuthorizationSource", "loadConversationOwnership", "loadSenderIdentitySource"] as const;
type ReadPortName = (typeof READ_PORTS)[number];
/**
 * B2.5: no harness (fundação da B3) TODAS as portas são obrigatórias — nenhuma etapa da cadeia
 * (atendimento humano/pausa, autorizações de horário, identidade de envio, dossiê) pode ser pulada
 * para chegar a uma decisão favorável. Uma porta pode responder "sem dados", nunca estar ausente.
 */
export const REQUIRED_PORTS: readonly ReadPortName[] = READ_PORTS;
export type ShadowReadPorts = Required<Pick<ChainDeps, ReadPortName>>;

/** Chaves aceitas no objeto de dependências do harness. */
export const HARNESS_KEYS = ["ports", "model", "guard", "telemetry", "priorMilestones", "budget", "now", "schedule", "stageTimeoutMs", "signal"] as const;

export interface ShadowHarnessDeps {
  ports: ShadowReadPorts;
  model: LlmMock;
  guard: FreeTextGuard | null;
  /** Coletor passivo (memória/artefato de teste). Nunca recebe texto. */
  telemetry?: (record: ShadowTurnRecord) => void;
  priorMilestones?: PriorMilestones;
  budget?: BudgetConfig;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  stageTimeoutMs?: number;
  /** Cancelamento externo (passivo: só interrompe a execução simulada). */
  signal?: AbortSignal;
}

interface Passive {
  modelMode: "mock";
  delivery: "not_sent";
  effectsExecuted: false;
}

export type ShadowTurnResult =
  | ({ kind: "executed"; outcome: ChainOutcome; record: ShadowTurnRecord; telemetry: "recorded" | "failed" | "not_configured" } & Passive)
  | ({ kind: "passive_barrier_violation"; reason: "unexpected_dependency" | "unexpected_port" | "port_not_function" | "model_not_mock" | "missing_port" } & Passive);

const PASSIVE: Passive = Object.freeze({ modelMode: "mock", delivery: "not_sent", effectsExecuted: false });

/** Verifica a barreira passiva. `null` = conforme. Nada é chamado durante a verificação. */
export function checkPassiveBarrier(deps: unknown): Extract<ShadowTurnResult, { kind: "passive_barrier_violation" }>["reason"] | null {
  if (!deps || typeof deps !== "object") return "missing_port";
  const d = deps as Record<string, unknown>;
  if (Object.keys(d).some((k) => !(HARNESS_KEYS as readonly string[]).includes(k))) return "unexpected_dependency";
  const ports = d["ports"];
  if (!ports || typeof ports !== "object") return "missing_port";
  const p = ports as Record<string, unknown>;
  if (Object.keys(p).some((k) => !(READ_PORTS as readonly string[]).includes(k))) return "unexpected_port";
  for (const k of Object.keys(p)) if (typeof p[k] !== "function") return "port_not_function";
  if (REQUIRED_PORTS.some((k) => typeof p[k] !== "function")) return "missing_port";
  if (!isLlmMock(d["model"])) return "model_not_mock";
  return null;
}

/** Executa um turno em modo passivo. Nunca lança. */
export async function runShadowTurn(input: ChainInput, deps: ShadowHarnessDeps): Promise<ShadowTurnResult> {
  const violation = checkPassiveBarrier(deps);
  if (violation) return { kind: "passive_barrier_violation", reason: violation, ...PASSIVE };

  const ports = deps.ports;
  const port = <K extends ReadPortName>(k: K) => ports[k];
  const model = deps.model;
  // ChainDeps montado campo a campo: nada além de leitura, mock, guard e relógio.
  const chainDeps: ChainDeps = {
    loadContext: (t, s) => port("loadContext")(t, s),
    loadHistory: (t, s) => port("loadHistory")(t, s),
    loadDossiers: (t, s) => port("loadDossiers")(t, s),
    loadStayAuthorizationSource: (t, s) => port("loadStayAuthorizationSource")(t, s),
    loadConversationOwnership: (t, s) => port("loadConversationOwnership")(t, s),
    loadSenderIdentitySource: (t, s) => port("loadSenderIdentitySource")(t, s),
    generate: (prompt, signal) => model.generate(prompt, signal),
    guard: deps.guard,
    priorMilestones: deps.priorMilestones,
    budget: deps.budget,
    now: deps.now,
    schedule: deps.schedule,
    stageTimeoutMs: deps.stageTimeoutMs,
    signal: deps.signal,
  };

  const outcome = await runTurnChain(input, chainDeps);
  const t = input?.turn;
  const record = buildShadowRecord(
    outcome,
    { conversationId: String(t?.conversationId ?? ""), messageId: String(t?.messageId ?? ""), propertyId: String(t?.propertyId ?? "") },
    { id: model.id, version: model.version, scenario: model.scenario },
  );

  let telemetry: "recorded" | "failed" | "not_configured" = "not_configured";
  if (deps.telemetry) {
    try {
      const r: unknown = deps.telemetry(record);
      // Coletor assíncrono: nunca aguardado (não amplia o prazo) e sua falha não altera a decisão.
      if (r && typeof (r as Promise<unknown>).then === "function") (r as Promise<unknown>).then(undefined, () => {});
      telemetry = "recorded";
    } catch {
      telemetry = "failed";
    }
  }
  return { kind: "executed", outcome, record, telemetry, ...PASSIVE };
}
