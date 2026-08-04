/**
 * AI Agent Evaluation Engine.
 *
 * Executa a biblioteca de cenários contra o pipeline REAL (mesmo orquestrador
 * usado em produção), compara com o comportamento esperado, calcula o Agent
 * Quality Score e persiste tudo em `ai_agent_evaluations`.
 *
 * Nunca envia mensagem ao hóspede: roda em superfície isolada ("evaluation").
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { agentQualityScore, accuracyScore, statusFor } from "./quality";
import { scenariosBySuite, type TestScenario } from "./scenarios";
import { resolveTenantByProperty } from "../tenant/context.server";

export type EvaluationRunResult = {
  runId: string;
  total: number;
  passed: number;
  warning: number;
  failed: number;
  averageQuality: number;
  byAgent: Record<string, { count: number; quality: number }>;
  cases: Array<{
    name: string;
    suite: string;
    status: string;
    quality: number;
    accuracy: number;
    actualAgent: string;
    handoff: boolean;
  }>;
};

export async function runEvaluationSuite(params: {
  supabase: SupabaseClient;
  propertyId: string;
  suite?: string;
  limit?: number;
  /** Compara com a execução anterior do mesmo cenário (Regression Testing). */
  compareWithBaseline?: boolean;
}): Promise<EvaluationRunResult> {
  const { supabase } = params;
  const tenant = await resolveTenantByProperty(supabase, params.propertyId);
  const runId = crypto.randomUUID();

  const { data: property } = await supabase
    .from("properties")
    .select("*")
    .eq("id", params.propertyId)
    .maybeSingle();
  if (!property) throw new Error("Imóvel não encontrado para avaliação");

  const scenarios = scenariosBySuite(params.suite).slice(0, params.limit ?? 50);
  const { runHospitalityAgent } = await import("../orchestrator.server");
  const { compareWithBaseline } = await import("./regression.server");

  const cases: EvaluationRunResult["cases"] = [];
  const byAgent: Record<string, { count: number; quality: number }> = {};

  for (const scenario of scenarios) {
    const started = Date.now();
    let outcome: Awaited<ReturnType<typeof runHospitalityAgent>> | null = null;
    let error: string | null = null;
    try {
      outcome = await runHospitalityAgent({
        supabase,
        property: property as Record<string, unknown>,
        conversationId: crypto.randomUUID(),
        sessionId: `eval:${runId}:${scenario.name}`,
        guestName: "Avaliação Automatizada",
        message: scenario.input,
        history: [],
        surface: "evaluation",
        channel: "evaluation",
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const record = await scoreScenario({
      supabase,
      tenantId: tenant.tenantId,
      propertyId: params.propertyId,
      runId,
      scenario,
      outcome,
      error,
      latencyMs: Date.now() - started,
      compareWithBaseline: params.compareWithBaseline !== false ? compareWithBaseline : undefined,
    });

    cases.push(record);
    const bucket = (byAgent[record.actualAgent] ??= { count: 0, quality: 0 });
    bucket.count += 1;
    bucket.quality += record.quality;
  }

  for (const key of Object.keys(byAgent)) {
    const b = byAgent[key]!;
    b.quality = Number((b.quality / Math.max(1, b.count)).toFixed(4));
  }

  const averageQuality = cases.length
    ? Number((cases.reduce((s, c) => s + c.quality, 0) / cases.length).toFixed(4))
    : 0;

  return {
    runId,
    total: cases.length,
    passed: cases.filter((c) => c.status === "passed").length,
    warning: cases.filter((c) => c.status === "warning").length,
    failed: cases.filter((c) => c.status === "failed").length,
    averageQuality,
    byAgent,
    cases,
  };
}

type Outcome = {
  reply: string;
  handoff: boolean;
  confidence: number;
  routing: { agent: string };
  reflection: { score?: number } | null;
  toolsUsed?: Array<{ name: string }>;
  sourcesUsed?: string[];
};

async function scoreScenario(params: {
  supabase: SupabaseClient;
  tenantId: string;
  propertyId: string;
  runId: string;
  scenario: TestScenario;
  outcome: unknown;
  error: string | null;
  latencyMs: number;
  compareWithBaseline?: (args: {
    supabase: SupabaseClient;
    tenantId: string;
    testCaseName: string;
    quality: number;
  }) => Promise<{ result: string; baselineId: string | null }>;
}): Promise<EvaluationRunResult["cases"][number]> {
  const { scenario } = params;
  const outcome = params.outcome as Outcome | null;

  const actualAgent = outcome?.routing?.agent ?? "none";
  const actualTools = (outcome?.toolsUsed ?? []).map((t) => t.name);
  const actualSources = outcome?.sourcesUsed ?? [];
  const actualHandoff = !!outcome?.handoff;

  const accuracy = params.error
    ? { score: 0, breakdown: { error: 1 } }
    : accuracyScore({
        expectedAgent: scenario.expectedAgent,
        actualAgent,
        expectedTools: scenario.expectedTools,
        actualTools,
        expectedSources: scenario.expectedSources,
        actualSources,
        expectHandoff: !!scenario.expectHandoff,
        actualHandoff,
      });

  const reflectionScore = outcome?.reflection?.score ?? null;
  const quality = agentQualityScore({
    accuracy: accuracy.score,
    confidence: outcome?.confidence ?? 0,
    reflection: reflectionScore ?? undefined,
    resolutionRate: actualHandoff ? (scenario.expectHandoff ? 1 : 0) : 1,
  });
  const status = params.error ? "failed" : statusFor(quality);

  let regression = { result: "baseline" as string, baselineId: null as string | null };
  if (params.compareWithBaseline) {
    regression = await params.compareWithBaseline({
      supabase: params.supabase,
      tenantId: params.tenantId,
      testCaseName: scenario.name,
      quality,
    });
  }

  try {
    await params.supabase.from("ai_agent_evaluations").insert({
      tenant_id: params.tenantId,
      property_id: params.propertyId,
      suite: scenario.suite,
      test_case_name: scenario.name,
      input_message: scenario.input,
      expected_agent: scenario.expectedAgent,
      expected_behavior: scenario.expectedBehavior,
      expected_tools: scenario.expectedTools as never,
      expected_sources: scenario.expectedSources as never,
      actual_agent: actualAgent,
      actual_tools: actualTools as never,
      actual_sources: actualSources as never,
      generated_response: outcome?.reply ?? null,
      confidence_score: outcome?.confidence ?? null,
      reflection_score: reflectionScore,
      accuracy_score: accuracy.score,
      quality_score: quality,
      evaluation_status: status,
      regression_result: regression.result,
      regression_baseline_id: regression.baselineId,
      latency_ms: params.latencyMs,
      notes: params.error ?? JSON.stringify(accuracy.breakdown),
      run_id: params.runId,
    });
  } catch (err) {
    console.error("[eval] falha ao registrar avaliação", err);
  }

  return {
    name: scenario.name,
    suite: scenario.suite,
    status,
    quality,
    accuracy: accuracy.score,
    actualAgent,
    handoff: actualHandoff,
  };
}
