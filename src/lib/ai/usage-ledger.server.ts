/**
 * LIVRO-CAIXA DA IA (31/10/2026): TODA chamada paga ao gateway (chat, agente, embeddings) deixa uma linha em
 * `ai_usage_events` — tarefa, modelo, tokens, custo estimado e, quando há contexto, conta/imóvel/conversa.
 * É só REGISTRO: nada aqui limita ou bloqueia uso. Falha ao gravar nunca derruba a resposta ao hóspede
 * (se a tabela ainda não existir, o erro é ignorado).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Usage } from "./gateway.server";

export type UsageContext = { ownerId?: string | null; propertyId?: string | null; conversationId?: string | null; surface?: string | null };

const store = new AsyncLocalStorage<UsageContext>();

/** Tudo que o gateway gastar dentro de `fn` é atribuído a este contexto. */
export function withUsageContext<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return store.run({ ...(store.getStore() ?? {}), ...ctx }, fn);
}

export type UsageEventRow = {
  task: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  owner_id: string | null;
  property_id: string | null;
  conversation_id: string | null;
  surface: string | null;
};

export function buildUsageEvent(task: string, model: string, usage: Usage, ctx: UsageContext = {}): UsageEventRow {
  return {
    task,
    model,
    tokens_in: usage.inputTokens,
    tokens_out: usage.outputTokens,
    cost_usd: Number(usage.costUsd.toFixed(6)),
    owner_id: ctx.ownerId ?? null,
    property_id: ctx.propertyId ?? null,
    conversation_id: ctx.conversationId ?? null,
    surface: ctx.surface ?? null,
  };
}

/** Grava sem esperar (fire-and-forget). */
export function recordUsageEvent(task: string, model: string, usage: Usage): void {
  if (!usage.inputTokens && !usage.outputTokens && !usage.costUsd) return;
  const row = buildUsageEvent(task, model, usage, store.getStore());
  void (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { untypedTable } = await import("@/lib/untyped-table");
      const { error } = await untypedTable(supabaseAdmin, "ai_usage_events").insert(row);
      if (error) console.debug("[ai-usage] registro ignorado:", error.message);
    } catch {
      /* registro de custo nunca derruba a resposta */
    }
  })();
}
