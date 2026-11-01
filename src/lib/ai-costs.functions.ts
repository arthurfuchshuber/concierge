import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summarizeAiCosts, type AiCostRow } from "@/lib/ai-cost-report";

const Input = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  propertyId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

/**
 * Custo das respostas da IA no período (só LEITURA/registro — sem limite de uso).
 * Respeita as regras de acesso do banco: cada conta só enxerga as próprias execuções.
 */
export const getAiCostReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("ai_agent_logs")
      .select("created_at, property_id, conversation_id, surface, channel_origin, cost_estimate, tokens, models")
      .gte("created_at", `${data.from}T00:00:00Z`)
      .lte("created_at", `${data.to}T23:59:59Z`)
      .order("created_at", { ascending: false })
      .limit(20000);
    if (data.propertyId) q = q.eq("property_id", data.propertyId);
    if (data.conversationId) q = q.eq("conversation_id", data.conversationId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return summarizeAiCosts((rows ?? []) as AiCostRow[]);
  });
