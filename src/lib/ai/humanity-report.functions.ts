/**
 * RELATÓRIO DE HUMANIDADE (17/10/2026): quanto a IA soa robótica? Lê o que
 * cada resposta gravou em `ai_agent_logs.root_cause.humanity` e resume:
 * repetição, emoji fora da regra, reescritas, espelhamento de tamanho e
 * reconhecimentos. Só números — nenhum texto de conversa. Apenas a função de
 * dados; a tela depende de mockup aprovado.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summarizeHumanity, type Humanity } from "@/lib/ai/voice";

const Input = z.object({
  days: z.number().int().min(1).max(90).default(14),
  propertyId: z.string().uuid().nullable().optional(),
});

export const getHumanityReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    let q = (context.supabase as any)
      .from("ai_agent_logs")
      .select("root_cause, created_at")
      .gte("created_at", since)
      .not("root_cause", "is", null)
      .order("created_at", { ascending: false })
      .limit(3000);
    if (data.propertyId) q = q.eq("property_id", data.propertyId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = ((rows ?? []) as Array<{ root_cause: { humanity?: Humanity } | null }>)
      .map((r) => r.root_cause?.humanity)
      .filter((h): h is Humanity => !!h);
    return { days: data.days, ...summarizeHumanity(list) };
  });
