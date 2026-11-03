/**
 * B2.1 · isolamento e regressão: o que a B2.1 NÃO pode fazer.
 * - módulos novos sem rede, sem Gateway, sem `llm/`, sem credenciais, sem escrita, sem tabelas legadas;
 * - nada de produção instala o compositor: `NO_COMPOSER` continua o padrão; slot intacto;
 * - os cenários de teste não são importados por código de produção (comportamento ≠ roteiro);
 * - com o compositor injetado (só em teste), o Orchestrator recebe 2 mensagens e nada é enviado.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGuestTurn } from "@/lib/guest-ai/orchestrator/orchestrator.server";
import { NO_COMPOSER } from "@/lib/guest-ai/orchestrator/orchestrator.server";
import { composeTurnPrompt, toComposedPrompt } from "@/lib/guest-ai/composer";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { GUEST_AI_DEFAULT_MODEL, type TurnRequest } from "@/lib/guest-ai/orchestrator/contracts";
import type { LlmRequest, LlmResult } from "@/lib/guest-ai/llm/contracts";
import { CONV, MSG, TEST_GUARD, conversationContext, row, v2 } from "./helpers/b21-fixtures";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(ROOT, "..", "..");
const NEW_FILES = ["persona.ts", "system-prompt.ts", "composer.ts", "render.ts", "budget.ts", "history.ts", "data/history.server.ts"];
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const LEGACY = /\b(ai_agent_evaluations|ai_agent_learning_metrics|ai_agent_logs|ai_agent_metrics|ai_channel_connections|ai_conversation_channels|ai_conversation_summaries|ai_conversations|ai_messages|ai_global_intelligence|ai_guest_memory|ai_host_corrections|ai_human_escalations|ai_kb_chunks|ai_knowledge_gaps|ai_learning_candidates|ai_learning_impact_logs|ai_memories|ai_operational_memory|ai_precedents|ai_proactive_actions|ai_prompt_change_candidates|ai_property_playbooks|ai_tenant_knowledge|ai_usage_events|chat_message_feedback|host_behavior|host_faqs|host_knowledge)\b/;

function allSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__") return [];
    if (statSync(full).isDirectory()) return allSources(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

describe("B2.1 · módulos novos isolados", () => {
  for (const rel of NEW_FILES) {
    it(`${rel}: sem rede, Gateway, llm/, credenciais, escrita, ferramentas, envio ou tabelas legadas`, () => {
      const c = code(path.join(ROOT, rel));
      expect(c).not.toMatch(/\bfetch\(|ai\.gateway|openai|anthropic|generativelanguage/i);
      expect(c).not.toMatch(/generateGuestLlm|guest-ai\/llm|@\/lib\/llm|lib\/llm\//);
      expect(c).not.toMatch(/fetchSensitiveCredentials|credentials\.server|issueCredentialGrant|PROPERTY_CREDENTIAL_COLUMNS|SENSITIVE_PROPERTY_COLUMNS|lock_code|wifi_password|pin_code|gate_code/);
      expect(c).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
      expect(c).not.toMatch(/\btools\s*:|tool_choice|function_call/);
      expect(c).not.toMatch(/deliverToAirbnbThread|sinch|sendChannexThreadMessage|sendTenantWhatsappText|sendHandoffPush|sendGuestReplyPush|sendPushToGuest|notifyStaff/i);
      expect(c).not.toMatch(/slot\.server/);
      expect(c).not.toMatch(LEGACY);
    });
  }
  it("só data/history.server.ts consulta o banco (e só property_chat_messages)", () => {
    for (const rel of NEW_FILES) {
      const c = code(path.join(ROOT, rel));
      const tables = [...c.matchAll(/\.from\(\s*["'`]([\w]+)["'`]/g)].map((m) => m[1]);
      expect(tables, rel).toEqual(rel === "data/history.server.ts" ? ["property_chat_messages"] : []);
    }
  });
  it("composer, persona, system-prompt, render, budget e history são puros (sem relógio nem aleatoriedade)", () => {
    for (const rel of NEW_FILES.filter((f) => !f.startsWith("data/"))) {
      expect(code(path.join(ROOT, rel)), rel).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|crypto\.random|performance\.now/);
    }
  });
});

describe("B2.1 · nada de produção ativa a composição", () => {
  const prod = allSources(SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`));

  it("nenhum arquivo de produção fora dos módulos B2.1 importa composer/render (NO_COMPOSER segue o padrão)", () => {
    const importers = prod
      .filter((f) => /guest-ai\/(composer|render)["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(importers).toEqual([]);
  });
  it("o Orchestrator continua com NO_COMPOSER como padrão e não importa a B2.1", () => {
    const orch = code(path.join(ROOT, "orchestrator/orchestrator.server.ts"));
    expect(orch).toMatch(/deps\.composePrompt \?\? NO_COMPOSER/);
    expect(orch).not.toMatch(/composer|persona|system-prompt|render|budget|history/);
    expect(NO_COMPOSER(null as never, null as never)).toBeNull();
    for (const f of ["slot.server.ts", "context/conversation-context.server.ts", "context/builder.server.ts"]) {
      expect(code(path.join(ROOT, f)), f).not.toMatch(/composer|history\.server|guest-ai\/history|render|persona|system-prompt/);
    }
  });
  it("os cenários de teste nunca são importados por código de produção", () => {
    expect(prod.filter((f) => /b21-scenarios|b21-fixtures/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
  it("sem compositor injetado, todo turno cai em prompt_unavailable e o Gateway nunca é chamado", async () => {
    const req: TurnRequest = { surface: "guide_chat", conversationId: CONV, messageId: MSG, expectedOwnerId: null, mode: "shadow", traceId: "b21-nocomp" };
    let called = 0;
    const r = await runGuestTurn(req, { loadContext: async () => conversationContext(), generate: async () => { called++; throw new Error("não deveria"); }, log: () => {} });
    expect(r).toMatchObject({ kind: "fallback", fallback: "prompt_unavailable" });
    expect(called).toBe(0);
  });
});

describe("B2.1 · compositor injetado SÓ em teste (compatibilidade com o contrato B1)", () => {
  const req: TurnRequest = { surface: "airbnb", conversationId: CONV, messageId: MSG, expectedOwnerId: null, mode: "shadow", traceId: "b21-int" };
  const history = normalizeHistory([row({ created_at: "2026-11-03T10:00:00Z", content: "Oi" }), row({ id: MSG, created_at: "2026-11-03T10:01:00Z", content: "Tem estacionamento?" })], { conversationId: CONV, currentMessageId: MSG });
  const ok = (json: unknown): LlmResult => ({ ok: true, text: JSON.stringify(json), json, finishReason: "stop", telemetry: { provider: "fake", model: GUEST_AI_DEFAULT_MODEL, purpose: "guest_reply", latencyMs: 5, attempts: 1, usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2, source: "provider" }, costUsd: 0, providerRequestId: null, traceId: req.traceId } });

  it("com guard: Gateway recebe exatamente [system, user], o modelo padrão e o teto de saída; o resultado é só rascunho shadow", async () => {
    const calls: LlmRequest[] = [];
    const ctx = conversationContext({ interlocutor: { guestId: "airbnb:123", conversationId: CONV, messageId: MSG, surface: "airbnb" } });
    const r = await runGuestTurn(req, {
      loadContext: async () => ctx,
      composePrompt: (c) => toComposedPrompt(composeTurnPrompt({ context: c, history }, { guard: TEST_GUARD })),
      generate: async (x) => { calls.push(x); return ok(v2({ groundedOn: ["ctx:fase"] })); },
      log: () => {},
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(calls[0]!.model).toBe(GUEST_AI_DEFAULT_MODEL);
    expect(calls[0]!.messages[0]!.content).toMatch(/Canal: chat do Airbnb/);
    expect(r.kind).toBe("draft");
    if (r.kind === "draft") {
      expect(r.validation.verdict).toBe("pass");
      expect(r.telemetry.mode).toBe("shadow");
      expect(r.telemetry.promptVersion).toMatch(/^b2\.2\//); // versão do prompt avança a cada gate (B2.2)
    }
  });
  it("sem guard (estado real até a B2.2): composição indisponível ⇒ prompt_unavailable, sem chamada", async () => {
    let called = 0;
    const r = await runGuestTurn(req, {
      loadContext: async () => conversationContext(),
      composePrompt: (c) => toComposedPrompt(composeTurnPrompt({ context: c, history })),
      generate: async () => { called++; return ok(v2()); },
      log: () => {},
    });
    expect(r).toMatchObject({ kind: "fallback", fallback: "prompt_unavailable" });
    expect(called).toBe(0);
  });
  it("citação de id de histórico de outro falante não passa por fundamento (ids reais do prompt)", async () => {
    const r = await runGuestTurn(req, {
      loadContext: async () => conversationContext(),
      composePrompt: (c) => toComposedPrompt(composeTurnPrompt({ context: c, history }, { guard: TEST_GUARD })),
      generate: async () => ok(v2({ groundedOn: ["hist:team:h2"] })),
      log: () => {},
    });
    expect(r).toMatchObject({ kind: "fallback", fallback: "validator_block" });
  });
});
