/**
 * MODO COPILOTO (diretriz definitiva de 05/11/2026) — server functions da tela de Atendimento.
 *
 * Só a casca: autenticação (`requireSupabaseAuth` → cliente da SESSÃO, RLS + `auth.uid()`), validação de
 * entrada e import dinâmico do corpo no servidor. Cada corpo confere a SUA chave antes de qualquer efeito:
 *  - `getCopilotSuggestion`, `editCopilotSuggestion`, `discardCopilotSuggestion` ⇒ `GUEST_AI_COPILOT_UI`
 *    (`copilot-actions.server.ts`);
 *  - `ensureCopilotSuggestion` ⇒ `GUEST_AI_COPILOT_UI` + `GUEST_AI_COPILOT_GENERATION`;
 *  - `sendCopilotSuggestion` ⇒ `GUEST_AI_COPILOT_SEND` (`copilot-send.server.ts`), antes da reivindicação.
 * Nenhum schema aceita id de usuário; a IA nunca envia nada por conta própria.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = z.string().uuid();
const TEXT = z.string().trim().min(1).max(4000);

// -------- Sugestão vigente da conversa (+ estado das chaves, para a interface se adaptar) --------

export const getCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ conversationId: UUID }).parse(raw))
  .handler(async ({ data, context }) => {
    const { readCopilotSuggestion } = await import("@/lib/copilot-actions.server");
    return await readCopilotSuggestion(context.supabase, data.conversationId);
  });

// -------- Pedido explícito de geração (idempotente com o disparo dos canais) --------

export const ensureCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ conversationId: UUID }).parse(raw))
  .handler(async ({ data, context }) => {
    const { ensureCopilotSuggestionCore } = await import("@/lib/copilot-actions.server");
    return await ensureCopilotSuggestionCore(context.supabase, context.userId, data.conversationId);
  });

// -------- Editar / descartar --------

export const editCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ suggestionId: UUID, text: TEXT }).parse(raw))
  .handler(async ({ data, context }) => {
    const { editCopilotSuggestionCore } = await import("@/lib/copilot-actions.server");
    return await editCopilotSuggestionCore(context.supabase, data);
  });

export const discardCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ suggestionId: UUID }).parse(raw))
  .handler(async ({ data, context }) => {
    const { discardCopilotSuggestionCore } = await import("@/lib/copilot-actions.server");
    return await discardCopilotSuggestionCore(context.supabase, data);
  });

// -------- Enviar ao hóspede (pela rotina humana do canal) --------

export const sendCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ suggestionId: UUID, text: TEXT.optional() }).parse(raw))
  .handler(async ({ data, context }) => {
    const [{ sendCopilotSuggestionCore }, { suggestionById }] = await Promise.all([
      import("@/lib/copilot-send.server"),
      import("@/lib/copilot-actions.server"),
    ]);
    const outcome = await sendCopilotSuggestionCore(context.supabase, context.userId, data);
    return { outcome, suggestion: await suggestionById(context.supabase, data.suggestionId) };
  });
