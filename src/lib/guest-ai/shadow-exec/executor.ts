/**
 * F2-B · B3.3 — EXECUTOR SHADOW (barreira estrutural; reutiliza `runTurnChain`, sem segunda cadeia).
 *
 *  1. Só aceita PORTAS DE LEITURA da lista fechada do harness (`READ_PORTS`) e chaves de lista fechada
 *     (`EXECUTOR_KEYS`). Qualquer outra dependência ⇒ `barrier_violation` ANTES de executar.
 *  2. O gerador é OBRIGATORIAMENTE um `ShadowGatewayGenerator` emitido (WeakSet).
 *  3. O guard é sempre o real (`SECRET_SCRUBBER`), nunca injetado.
 *  4. Os `ChainDeps` são montados campo a campo; o prazo de cada etapa é o que RESTA do prazo global
 *     (nenhuma etapa ganha relógio próprio) e o sinal é o ÚNICO da execução.
 *  5. O `ChainOutcome` integral NÃO sai daqui: é estreitado (`narrowOutcome`) na mesma função e só a
 *     projeção sem texto é devolvida. Nenhum log da cadeia é instalado (`deps.log` ausente).
 */
import { runTurnChain, type ChainDeps, type ChainInput } from "@/lib/guest-ai/turn-chain";
import { READ_PORTS, REQUIRED_PORTS, type ShadowReadPorts } from "@/lib/guest-ai/shadow/harness";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { narrowOutcome, type NarrowOutcome } from "./extract";
import { isShadowGatewayGenerator, type ShadowGatewayGenerator } from "./gateway-generator.server";

export const EXECUTOR_KEYS = ["ports", "generator", "signal", "remainingMs", "now", "schedule"] as const;

export interface ShadowExecutorDeps {
  ports: ShadowReadPorts;
  generator: ShadowGatewayGenerator;
  /** Sinal ÚNICO da execução (`ShadowDeadline.signal`). */
  signal: AbortSignal;
  /** Tempo de processamento que resta (ms) — teto de qualquer etapa. */
  remainingMs: () => number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

export type ShadowExecutionResult =
  | { kind: "executed"; narrow: NarrowOutcome }
  | { kind: "barrier_violation"; reason: "unexpected_dependency" | "unexpected_port" | "port_not_function" | "missing_port" | "generator_not_issued" | "signal_missing" | "deadline_expired" };

export function checkExecutorBarrier(deps: unknown): Extract<ShadowExecutionResult, { kind: "barrier_violation" }>["reason"] | null {
  if (!deps || typeof deps !== "object") return "missing_port";
  const d = deps as Record<string, unknown>;
  if (Object.keys(d).some((k) => !(EXECUTOR_KEYS as readonly string[]).includes(k))) return "unexpected_dependency";
  const p = d["ports"];
  if (!p || typeof p !== "object") return "missing_port";
  const ports = p as Record<string, unknown>;
  if (Object.keys(ports).some((k) => !(READ_PORTS as readonly string[]).includes(k))) return "unexpected_port";
  if (Object.values(ports).some((f) => typeof f !== "function")) return "port_not_function";
  if (REQUIRED_PORTS.some((k) => typeof ports[k] !== "function")) return "missing_port";
  if (!isShadowGatewayGenerator(d["generator"])) return "generator_not_issued";
  if (!(d["signal"] instanceof AbortSignal) || typeof d["remainingMs"] !== "function") return "signal_missing";
  return null;
}

/** Executa um turno Shadow. Nunca lança; devolve só a projeção sem texto. */
export async function runShadowExecution(input: ChainInput, deps: ShadowExecutorDeps): Promise<ShadowExecutionResult> {
  const violation = checkExecutorBarrier(deps);
  if (violation) return { kind: "barrier_violation", reason: violation };
  const remaining = deps.remainingMs();
  if (!(remaining > 0) || deps.signal.aborted) return { kind: "barrier_violation", reason: "deadline_expired" };
  const ports = deps.ports;
  const generator = deps.generator;
  const chainDeps: ChainDeps = {
    loadContext: (t, s) => ports.loadContext(t, s),
    loadHistory: (t, s) => ports.loadHistory(t, s),
    loadDossiers: (t, s) => ports.loadDossiers(t, s),
    loadStayAuthorizationSource: (t, s) => ports.loadStayAuthorizationSource(t, s),
    loadConversationOwnership: (t, s) => ports.loadConversationOwnership(t, s),
    loadSenderIdentitySource: (t, s) => ports.loadSenderIdentitySource(t, s),
    loadHumanPause: (t, s) => ports.loadHumanPause(t, s),
    generate: (prompt, signal) => generator.generate(prompt, signal),
    guard: SECRET_SCRUBBER,
    stageTimeoutMs: remaining,
    signal: deps.signal,
    now: deps.now,
    schedule: deps.schedule,
  };
  const outcome = await runTurnChain(input, chainDeps);
  return { kind: "executed", narrow: narrowOutcome(outcome) };
}
