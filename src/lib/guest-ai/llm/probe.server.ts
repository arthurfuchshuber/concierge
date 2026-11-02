/**
 * F2-B · B1 — SONDA D14: homologação controlada da 1ª chamada real ao provedor.
 *
 * DESLIGADA por padrão: só responde quando `GUEST_AI_LLM_PROBE=on` E o chamador apresenta o
 * segredo de cron. Com a chave desligada, devolve 404 sem verificar segredo e sem chamar nada.
 *
 * Usa SOMENTE prompts sintéticos (nenhum dado de cliente, imóvel, reserva ou conversa) e
 * devolve SOMENTE telemetria normalizada do Gateway por modelo/caso: sucesso ou código de erro,
 * latência, tokens (com a origem da contagem: provedor ou estimativa), raciocínio e custo.
 * Nunca devolve o texto gerado. Serve para confirmar, antes do shadow: schema real de `usage`,
 * parâmetros de raciocínio aceitos, compatibilidade dos modelos cadastrados, encerramento do
 * streaming, timeout, erros e custo.
 */
import { verifyCronSecret } from "@/lib/cron-auth.server";
import type { LlmRequest, LlmResult, ReasoningEffort } from "./contracts";
import { generateGuestLlm } from "./gateway.server";
import { GUEST_AI_MODELS } from "./models";

export const PROBE_FLAG = "GUEST_AI_LLM_PROBE";
const PROBE_SYSTEM = "Teste técnico de conectividade. Não há usuário real. Responda exatamente ao pedido, sem texto extra.";

export interface ProbeCase {
  id: "text_none" | "text_low" | "json_low";
  responseFormat: "text" | "json";
  reasoningEffort: ReasoningEffort;
  user: string;
}

export const PROBE_CASES: readonly ProbeCase[] = [
  { id: "text_none", responseFormat: "text", reasoningEffort: "none", user: "Responda apenas: OK" },
  { id: "text_low", responseFormat: "text", reasoningEffort: "low", user: "Quanto é 2 + 3? Responda só o número." },
  { id: "json_low", responseFormat: "json", reasoningEffort: "low", user: 'Responda apenas o JSON {"ok": true}' },
];

export interface ProbeResult {
  model: string;
  wire: string;
  case: ProbeCase["id"];
  ok: boolean;
  code: string | null;
  httpStatus: number | null;
  latencyMs: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  usageSource: string;
  costUsd: number;
  /** Só para o caso JSON: o Gateway entregou JSON válido. */
  jsonValid: boolean | null;
}

export function isProbeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[PROBE_FLAG] === "on";
}

function toResult(model: string, wire: string, c: ProbeCase, r: LlmResult): ProbeResult {
  const t = r.telemetry;
  return {
    model,
    wire,
    case: c.id,
    ok: r.ok,
    code: r.ok ? null : r.error.code,
    httpStatus: r.ok ? null : r.error.httpStatus,
    latencyMs: t.latencyMs,
    attempts: t.attempts,
    inputTokens: t.usage.inputTokens,
    outputTokens: t.usage.outputTokens,
    reasoningTokens: t.usage.reasoningTokens,
    usageSource: t.usage.source,
    costUsd: t.costUsd,
    jsonValid: c.responseFormat === "json" ? r.ok && r.json !== undefined : null,
  };
}

/** Executa os casos sintéticos nos modelos cadastrados (ou num só). Concorrência limitada. */
export async function runProbe(deps: { generate?: (req: LlmRequest) => Promise<LlmResult>; onlyModel?: string | null; concurrency?: number } = {}): Promise<ProbeResult[]> {
  const generate = deps.generate ?? ((req: LlmRequest) => generateGuestLlm(req));
  const specs = [...GUEST_AI_MODELS.values()].filter((s) => !deps.onlyModel || s.id === deps.onlyModel);
  const jobs = specs.flatMap((s) => PROBE_CASES.filter((c) => c.reasoningEffort === "none" || s.reasoningEfforts.includes(c.reasoningEffort as never)).map((c) => ({ s, c })));
  const results: ProbeResult[] = new Array(jobs.length);
  const limit = Math.max(1, Math.min(4, deps.concurrency ?? 4));
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      const { s, c } = jobs[i]!;
      const r = await generate({
        purpose: "test",
        model: s.id,
        messages: [
          { role: "system", content: PROBE_SYSTEM },
          { role: "user", content: c.user },
        ],
        maxOutputTokens: 256,
        reasoningEffort: c.reasoningEffort,
        responseFormat: c.responseFormat,
        traceId: `probe:${c.id}`,
      });
      results[i] = toResult(s.id, s.wire, c, r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

export interface ProbeHandlerDeps {
  env?: Record<string, string | undefined>;
  verify?: (request: Request) => boolean;
  generate?: (req: LlmRequest) => Promise<LlmResult>;
}

/** Handler da rota. Ordem: chave → método → segredo → execução. */
export async function handleProbeRequest(request: Request, deps: ProbeHandlerDeps = {}): Promise<Response> {
  if (!isProbeEnabled(deps.env ?? process.env)) return Response.json({ error: "not_found" }, { status: 404 });
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  if (!(deps.verify ?? verifyCronSecret)(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const only = new URL(request.url).searchParams.get("model");
  if (only && !GUEST_AI_MODELS.has(only)) return Response.json({ error: "unknown_model" }, { status: 400 });
  const results = await runProbe({ generate: deps.generate, onlyModel: only });
  return Response.json({ ok: true, probe: "guest-ai-llm-d14", results });
}
