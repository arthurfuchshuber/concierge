/**
 * Executor seguro das chamadas de ferramenta pedidas pelo modelo.
 *
 * - Cada chamada roda com prazo próprio de no máximo `TOOL_TIMEOUT_MS` (4 s), limitado ao que resta do
 *   prazo do turno; chamadas independentes correm em paralelo.
 * - NUNCA lança: ferramenta desconhecida, argumento inválido, falha de rede, chave ausente ou prazo
 *   estourado viram `{ ok: false, erro }` com código fixo — o modelo então responde com o conhecimento
 *   de base, sem metros inventados (regra do System Prompt). Cancelamento do turno também vira
 *   `tempo_esgotado` (o gerador decide parar).
 * - Resultado serializado e limitado a `TOOL_RESULT_MAX_CHARS` (listas são encurtadas, nunca cortadas
 *   no meio de um JSON).
 * - Nenhum detalhe técnico (mensagem de erro, status HTTP, chave) chega ao modelo ou ao log.
 */
import type { LlmToolCall } from "@/lib/guest-ai/llm/contracts";
import {
  TOOL_MAX_CALLS_PER_TURN,
  TOOL_RESULT_MAX_CHARS,
  TOOL_TIMEOUT_MS,
  type ExternalHttp,
  type GuestToolContext,
  type MapsHttp,
  type ToolErrorCode,
  type ToolResult,
} from "./contracts";
import { getGuestTool } from "./registry";

export interface ToolCallOutcome {
  callId: string;
  name: string;
  ok: boolean;
  error: ToolErrorCode | null;
  /** JSON do resultado devolvido ao modelo (mensagem `tool`). */
  content: string;
  latencyMs: number;
}

export interface ExecuteDeps {
  http: MapsHttp;
  /** Clima e voos (Etapa 3). Ausente ⇒ essas ferramentas respondem `indisponivel`. */
  external?: ExternalHttp;
  /** Sinal do turno (cancelamento externo). */
  signal: AbortSignal;
  /** Prazo que resta do turno (ms). Cada ferramenta usa min(6 s, restante). */
  remainingMs: () => number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Serializa dentro do teto: encurta `resultados` até caber; se nem assim, `indisponivel`. */
export function serializeToolResult(result: ToolResult, max = TOOL_RESULT_MAX_CHARS): string {
  let r: ToolResult = result;
  for (;;) {
    const text = JSON.stringify(r);
    if (text.length <= max) return text;
    const list = r.ok ? (r as Record<string, unknown>)["resultados"] : undefined;
    if (!Array.isArray(list) || list.length <= 1) break;
    r = {
      ...(r as Record<string, unknown>),
      ok: true,
      resultados: list.slice(0, list.length - 1),
    } as ToolResult;
  }
  return JSON.stringify({ ok: false, erro: "indisponivel" } satisfies ToolResult);
}

function errorResult(code: ToolErrorCode): ToolResult {
  return { ok: false, erro: code };
}

async function runOne(
  call: LlmToolCall,
  ctx: GuestToolContext,
  deps: ExecuteDeps,
): Promise<ToolCallOutcome> {
  const now = deps.now ?? (() => performance.now());
  const schedule = deps.schedule ?? defaultSchedule;
  const started = now();
  const done = (result: ToolResult): ToolCallOutcome => ({
    callId: call.id,
    name: call.name,
    ok: result.ok,
    error: result.ok ? null : (result as { erro: ToolErrorCode }).erro,
    content: serializeToolResult(result),
    latencyMs: Math.max(0, Math.round(now() - started)),
  });

  const tool = getGuestTool(call.name);
  if (!tool) return done(errorResult("ferramenta_desconhecida"));
  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments || "{}");
  } catch {
    return done(errorResult("argumentos_invalidos"));
  }
  const args = tool.parse(raw);
  if (args === null) return done(errorResult("argumentos_invalidos"));

  const budget = Math.min(TOOL_TIMEOUT_MS, Math.floor(deps.remainingMs()));
  if (budget <= 0 || deps.signal.aborted) return done(errorResult("tempo_esgotado"));

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  deps.signal.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const cancel = schedule(() => {
    timedOut = true;
    controller.abort();
  }, budget);
  try {
    const result = await Promise.race([
      tool.execute(args, ctx, { http: deps.http, external: deps.external, signal: controller.signal }),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      ),
    ]);
    return done(result);
  } catch {
    return done(
      errorResult(timedOut || controller.signal.aborted ? "tempo_esgotado" : "indisponivel"),
    );
  } finally {
    cancel();
    deps.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Executa todas as chamadas (em paralelo). Nunca lança; a ordem do resultado é a das chamadas. Teto de
 * custo do turno: no máximo `TOOL_MAX_CALLS_PER_TURN` chamadas da mesma ferramenta; o excedente nem sai
 * para a rede e volta como `limite_atingido`.
 */
export async function executeToolCalls(
  calls: readonly LlmToolCall[],
  ctx: GuestToolContext,
  deps: ExecuteDeps,
): Promise<ToolCallOutcome[]> {
  const seen = new Map<string, number>();
  return Promise.all(
    calls.map((c) => {
      const n = (seen.get(c.name) ?? 0) + 1;
      seen.set(c.name, n);
      if (n > TOOL_MAX_CALLS_PER_TURN)
        return Promise.resolve<ToolCallOutcome>({
          callId: c.id,
          name: c.name,
          ok: false,
          error: "limite_atingido",
          content: JSON.stringify(errorResult("limite_atingido")),
          latencyMs: 0,
        });
      return runOne(c, ctx, deps).catch((): ToolCallOutcome => ({
        callId: c.id,
        name: c.name,
        ok: false,
        error: "indisponivel",
        content: JSON.stringify(errorResult("indisponivel")),
        latencyMs: 0,
      }));
    }),
  );
}
