import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summarizeAiCosts, type AiUsageEventRow } from "@/lib/ai-cost-report";

const Input = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  propertyId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

/**
 * Custo da IA no período, lido do livro-caixa `ai_usage_events` (só LEITURA — sem limite de uso).
 * A tabela não tem acesso direto para usuários; o servidor lê e filtra SEMPRE pela conta de quem pede.
 */
export const getAiCostReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { untypedTable } = await import("@/lib/untyped-table");
    let q = untypedTable(supabaseAdmin, "ai_usage_events")
      .select("created_at, task, model, tokens_in, tokens_out, cost_usd, owner_id, property_id, conversation_id, surface")
      .eq("owner_id", context.userId)
      .gte("created_at", `${data.from}T00:00:00Z`)
      .lte("created_at", `${data.to}T23:59:59Z`)
      .order("created_at", { ascending: false })
      .limit(50000);
    if (data.propertyId) q = q.eq("property_id", data.propertyId);
    if (data.conversationId) q = q.eq("conversation_id", data.conversationId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return summarizeAiCosts((rows ?? []) as AiUsageEventRow[]);
  });
