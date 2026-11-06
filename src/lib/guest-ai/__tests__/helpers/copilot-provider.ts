/**
 * Provedor de LLM falso para os testes do Copiloto (sem rede). Cópia literal de `fakeProvider` e `okJson`
 * do helper de testes do Shadow (`b33-shadow.ts`, branch `guest-ai/f2b-orchestrator`), separados aqui
 * para que os testes do Copiloto não dependam de nenhum código de Shadow ou lease.
 */
import type { LlmProvider, ProviderOutcome } from "@/lib/guest-ai/llm/providers/types";

export function fakeProvider(outcome: ProviderOutcome | ((n: number) => ProviderOutcome | Promise<ProviderOutcome>)): LlmProvider & { calls: number } {
  const p = {
    id: "fake",
    calls: 0,
    async complete() {
      p.calls += 1;
      return typeof outcome === "function" ? outcome(p.calls) : outcome;
    },
  };
  return p;
}
export const okJson = (body: unknown, usage = { inputTokens: 900, outputTokens: 120, totalTokens: 1020 }): ProviderOutcome => ({ kind: "ok", text: JSON.stringify(body), finishReason: "stop", usage, requestId: "req-1" });
