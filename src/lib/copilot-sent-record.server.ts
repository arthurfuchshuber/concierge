/**
 * Registro de ENVIO da sugestão do Copiloto (14/11/2026).
 *
 * Como o cartão de sugestão foi removido (10/11), a equipe leva o texto sugerido para o composer e envia pelo caminho
 * normal; nada marcava a sugestão como enviada (`sent_at`, `sent_by`, `sent_message_id`, `sent_channel` ficavam nulos),
 * o que impedia medir quanto da sugestão é aproveitado. Aqui, logo depois de um envio humano real, a mensagem é casada
 * com a sugestão viva mais recente da conversa e as RPCs do ator (`copilot_actor_claim_send` →
 * `copilot_actor_finish_send`, com permissão `chat_respond` conferida no banco) gravam o envio.
 *
 * Nunca atrasa nem derruba o envio: qualquer falha é engolida. Não altera texto, canal nem destinatário.
 */

type RpcResult = { data: unknown; error: unknown };
export interface SentRecordDeps {
  /** Sugestões vivas da conversa, da mais nova para a mais antiga. */
  listLive(conversationId: string): Promise<Array<{ id: string; suggested_text: string | null; edited_text: string | null }>>;
  rpc(fn: "copilot_actor_claim_send" | "copilot_actor_finish_send", args: Record<string, unknown>): PromiseLike<RpcResult>;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Semelhança por palavras (Jaccard); a equipe costuma ajustar uma ou duas palavras antes de enviar. */
export function textSimilarity(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export const SENT_MATCH_MIN_SIMILARITY = 0.6;

export async function recordCopilotSuggestionSent(
  deps: SentRecordDeps,
  input: { userId: string; conversationId: string; messageId: string; channel: string; content: string },
): Promise<{ recorded: boolean; suggestionId?: string }> {
  try {
    if (!input.content.trim() || !["web", "whatsapp", "airbnb"].includes(input.channel)) return { recorded: false };
    const live = await deps.listLive(input.conversationId);
    let best: { id: string; score: number } | null = null;
    for (const s of live) {
      const score = Math.max(
        s.suggested_text ? textSimilarity(input.content, s.suggested_text) : 0,
        s.edited_text ? textSimilarity(input.content, s.edited_text) : 0,
      );
      if (score >= SENT_MATCH_MIN_SIMILARITY && (!best || score > best.score)) best = { id: s.id, score };
    }
    if (!best) return { recorded: false };
    const claim = await deps.rpc("copilot_actor_claim_send", {
      p_actor: input.userId, p_suggestion_id: best.id, p_text: input.content,
    });
    const c = claim.data as { result?: string; send_token?: string } | null;
    if (claim.error || c?.result !== "claimed" || !c.send_token) return { recorded: false };
    const fin = await deps.rpc("copilot_actor_finish_send", {
      p_actor: input.userId, p_suggestion_id: best.id, p_send_token: c.send_token, p_outcome: "sent",
      p_message_id: input.messageId, p_provider_message_id: null, p_channel: input.channel, p_error_code: null,
    });
    const f = fin.data as { result?: string } | null;
    return f?.result === "finished" && !fin.error ? { recorded: true, suggestionId: best.id } : { recorded: false };
  } catch {
    return { recorded: false };
  }
}

export async function recordCopilotSuggestionSentLive(input: {
  userId: string; conversationId: string; messageId: string; channel: string; content: string;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as {
    from(t: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  };
  await recordCopilotSuggestionSent(
    {
      async listLive(conversationId) {
        const { data } = await db
          .from("guest_ai_copilot_suggestions")
          .select("id, suggested_text, edited_text")
          .eq("conversation_id", conversationId)
          .in("state", ["available", "edited", "send_failed"])
          .order("created_at", { ascending: false })
          .limit(5);
        return (data ?? []) as Array<{ id: string; suggested_text: string | null; edited_text: string | null }>;
      },
      rpc: (fn, args) => db.rpc(fn, args),
    },
    input,
  );
}
