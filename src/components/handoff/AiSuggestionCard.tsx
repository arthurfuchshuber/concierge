/**
 * MODO COPILOTO (diretriz definitiva de 05/11/2026) — cartão "Sugestão da IA" da tela de Atendimento.
 *
 * Vive logo acima do campo de resposta de `ConversationView`. É um RASCUNHO: nunca aparece na lista de
 * mensagens, tem rótulo "IA" e selo "não enviado", e só vira mensagem quando o atendente clica em
 * "Enviar ao Hóspede" — que invoca a rotina humana de envio do canal (backend). A geração acontece em segundo
 * plano quando chega mensagem do hóspede; este cartão só a acompanha (consulta periódica: 3 s gerando/enviando, 15 s parado) e, se a mensagem
 * mais recente ainda não tem sugestão, pede uma (idempotente no banco).
 * Estados: Gerando · Disponível · Editada · Enviando · Enviada · Falha no envio · Descartada (+ "sem sugestão"
 * e "não foi possível gerar", informativos).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  discardCopilotSuggestion,
  editCopilotSuggestion,
  ensureCopilotSuggestion,
  getCopilotSuggestion,
  sendCopilotSuggestion,
} from "@/lib/copilot.functions";
import type { CopilotSendOutcome } from "@/lib/copilot-send.server";
import {
  copilotFinalText,
  isCopilotActionable,
  type CopilotState,
  type CopilotSuggestionRow,
} from "@/lib/guest-ai/copilot/contracts";
import { friendlyErrorMessage } from "@/lib/friendly-error";

export const STATE_LABEL: Record<CopilotState, string> = {
  generating: "Gerando",
  available: "Disponível",
  edited: "Editada",
  sending: "Enviando",
  sent: "Enviada",
  send_failed: "Falha no envio",
  discarded: "Descartada",
  no_suggestion: "Sem sugestão",
  generation_failed: "Não gerada",
  superseded: "Desatualizada",
};

const INTENT_LABEL: Record<string, string> = {
  acknowledgment: "agradecimento",
  informational_query: "dúvida",
  operational_request: "pedido operacional",
  problem_report: "problema",
  emergency: "emergência",
  formal_change_request: "alteração de reserva",
  arrival_confirmation: "chegada",
  departure_confirmation: "saída",
  other: "outro",
};

const WARNING_LABEL: Record<string, string> = {
  unknown_facts: "A IA não encontrou toda a informação; confira antes de enviar.",
  source_conflicts: "Fontes divergentes no cadastro; confira o dado citado.",
  credential_request_denied:
    "O hóspede pediu códigos/senhas: a IA não os revela. Confira a política antes.",
  unauthorized_commitment: "Compromisso sem autorização registrado foi removido da sugestão.",
  handoff_recommended: "A IA recomenda atenção humana neste assunto.",
  emergency: "Possível emergência: priorize o contato direto.",
  sender_identity_unresolved:
    "Conta remetente do Airbnb não confirmada: o envio será bloqueado até resolver.",
  human_in_command: "Equipe no comando desta conversa (IA pausada): a sugestão é só para você.",
  reservation_not_linked:
    "Conversa sem reserva vinculada: horários e credenciais não foram prometidos.",
  dossier_unavailable: "Dossiê do imóvel indisponível na geração.",
  history_unavailable: "Histórico da conversa indisponível na geração.",
  formal_change_request: "Alteração de reserva: só pela fonte oficial (Airbnb/plataforma).",
};

const OUTCOME_LABEL: Record<string, string> = {
  silence: "A IA entendeu que não há o que responder agora.",
  human_action: "A IA precisa de uma decisão da equipe antes de responder.",
  human_pause_active: "Equipe no comando: a IA não propôs resposta.",
  urgent_internal_alert: "Possível emergência: a IA pediu atenção urgente da equipe.",
  budget_daily_exceeded: "Limite diário de uso da IA atingido; volta amanhã (UTC).",
  budget_turn_exceeded: "Conversa longa demais para o limite de custo por resposta.",
  superseded: "Chegou uma mensagem mais nova do hóspede.",
  deadline_expired: "A geração passou do prazo.",
  gateway_failed: "O serviço de IA não respondeu.",
  model_call_failed: "O serviço de IA não respondeu.",
  internal_error: "Erro interno na geração.",
  template_tag_in_output:
    "A IA tentou usar marcas do guia ([[info:…]]); a sugestão foi bloqueada por segurança.",
};

const SEND_ERROR_LABEL: Record<string, string> = {
  assigned_to_other: "Outro membro está atendendo esta conversa.",
  permission_denied: "Você não tem permissão para responder nesta conta.",
  guest_phone_missing: "Este hóspede ainda não informou telefone.",
  whatsapp_not_configured: "WhatsApp Business não está configurado nesta conta.",
  whatsapp_send_failed: "O WhatsApp não aceitou a mensagem.",
  airbnb_rejected: "O Airbnb recusou a mensagem.",
  preferred_sender_failed:
    "A conta remetente configurada não pôde enviar. Nada saiu por outra conta.",
  sender_mismatch: "A conta que enviaria não é a configurada para este anúncio. Nada foi enviado.",
  unknown_result:
    "Resultado desconhecido: confira no histórico se a mensagem saiu antes de reenviar.",
  claim_incomplete: "Não foi possível preparar o envio.",
  send_failed: "Não foi possível enviar.",
};

const sendErrorLabel = (code: string | null): string => {
  if (!code) return SEND_ERROR_LABEL.send_failed;
  if (code.startsWith("sender_identity_"))
    return (
      "Conta remetente do Airbnb não confirmada (" +
      code.slice("sender_identity_".length).replace(/_/g, " ") +
      "). Nada foi enviado."
    );
  if (code.startsWith("scope_")) return "A conversa mudou e a sugestão não pôde ser enviada.";
  return SEND_ERROR_LABEL[code] ?? SEND_ERROR_LABEL.send_failed;
};

const PHASE_LABEL: Record<string, string> = {
  inquiry: "consulta",
  pre_stay: "pré-estadia",
  in_stay: "em estadia",
  post_checkout: "pós-checkout",
  cancelled: "cancelada",
  no_show: "no-show",
  unknown: "fase desconhecida",
};

export function contextSummary(s: CopilotSuggestionRow): string[] {
  const out: string[] = [];
  if (s.context_stay_phase) out.push(PHASE_LABEL[s.context_stay_phase] ?? s.context_stay_phase);
  if (s.context_reservation_linked === true) out.push("reserva vinculada");
  if (s.context_reservation_linked === false) out.push("sem reserva");
  if (typeof s.context_history_messages === "number")
    out.push(`${s.context_history_messages} msg de histórico`);
  if (typeof s.context_dossier_entries === "number")
    out.push(`${s.context_dossier_entries} itens do Dossiê`);
  if (s.context_credential_policy)
    out.push(
      s.context_credential_policy === "allow"
        ? "credenciais liberáveis (não reveladas)"
        : "credenciais bloqueadas",
    );
  if (s.surface === "airbnb" && s.context_sender_identity)
    out.push(
      s.context_sender_identity === "resolved"
        ? "remetente Airbnb confirmado"
        : "remetente Airbnb não confirmado",
    );
  if (s.context_human_in_command) out.push("equipe no comando");
  return out;
}

export interface AiSuggestionCardProps {
  conversationId: string;
  /** Id da mensagem mais recente do HÓSPEDE (para pedir sugestão quando ainda não há uma para ela). */
  latestGuestMessageId: string | null;
  /** O usuário pode enviar nesta conversa (responsável ou anfitrião no comando). */
  canSend: boolean;
  /** Depois de um envio bem-sucedido (a conversa deve ser recarregada). */
  onSent?: () => void;
}

/** Mensagens que já pediram geração automática nesta sessão do navegador (chave: conversa + mensagem). */
const autoRequested = new Set<string>();
const AUTO_REQUESTED_MAX = 500;
/** Marca a mensagem; devolve `false` se ela já tinha pedido geração antes (nesta sessão). */
export function markAutoRequested(conversationId: string, messageId: string): boolean {
  const key = `${conversationId}:${messageId}`;
  if (autoRequested.has(key)) return false;
  if (autoRequested.size >= AUTO_REQUESTED_MAX) autoRequested.delete(autoRequested.values().next().value as string);
  autoRequested.add(key);
  return true;
}

export function AiSuggestionCard({
  conversationId,
  latestGuestMessageId,
  canSend,
  onSent,
}: AiSuggestionCardProps) {
  const qc = useQueryClient();
  const getFn = useServerFn(getCopilotSuggestion);
  const ensureFn = useServerFn(ensureCopilotSuggestion);
  const editFn = useServerFn(editCopilotSuggestion);
  const discardFn = useServerFn(discardCopilotSuggestion);
  const sendFn = useServerFn(sendCopilotSuggestion);
  const queryKey = useMemo(() => ["copilot-suggestion", conversationId] as const, [conversationId]);

  const q = useQuery({
    queryKey,
    queryFn: () => getFn({ data: { conversationId } }),
    refetchInterval: (query) => {
      const st = query.state.data?.suggestion?.state;
      return st === "generating" || st === "sending" ? 3000 : 15000;
    },
  });
  // estado das três chaves, lido no SERVIDOR; aqui só adapta a tela (os bloqueios são do backend)
  const flags = q.data?.flags ?? { ui: false, generation: false, send: false };
  const enabled = flags.ui;
  const suggestion = q.data?.suggestion ?? null;

  // mensagem nova do hóspede sem sugestão ⇒ pede UMA vez por mensagem (o banco é idempotente com o disparo do canal).
  // DISJUNTOR (10/11/2026): a marca vale para a sessão inteira (não só para esta montagem do cartão) e nunca é
  // limpa por erro — trocar de conversa e voltar, reabrir a tela ou um erro transitório NÃO pedem de novo. Só uma
  // NOVA mensagem do hóspede (outro id) dispara geração automática; "Gerar sugestão" continua manual.
  const requested = useRef<string | null>(null);
  const ensure = useMutation({
    mutationFn: () => ensureFn({ data: { conversationId } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["copilot-suggestion", conversationId] }),
  });
  useEffect(() => {
    if (!enabled || !flags.generation || !latestGuestMessageId || q.isLoading) return;
    if (suggestion && suggestion.trigger_message_id === latestGuestMessageId) return;
    if (requested.current === latestGuestMessageId) return;
    requested.current = latestGuestMessageId;
    if (!markAutoRequested(conversationId, latestGuestMessageId)) return;
    ensure.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    flags.generation,
    latestGuestMessageId,
    suggestion?.trigger_message_id,
    q.isLoading,
  ]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastSend, setLastSend] = useState<CopilotSendOutcome | null>(null);
  useEffect(() => {
    // sugestão nova ⇒ sai do modo de edição e limpa avisos da anterior
    setEditing(false);
    setError(null);
    setLastSend(null);
  }, [suggestion?.id]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["copilot-suggestion", conversationId] });
  const edit = useMutation({
    mutationFn: (text: string) => editFn({ data: { suggestionId: suggestion!.id, text } }),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (e) => setError(friendlyErrorMessage(e, "Não foi possível salvar a edição.")),
  });
  const discard = useMutation({
    mutationFn: () => discardFn({ data: { suggestionId: suggestion!.id } }),
    onSuccess: invalidate,
    onError: (e) => setError(friendlyErrorMessage(e, "Não foi possível descartar.")),
  });
  // trava SÍNCRONA contra clique duplo: `isPending` do React Query só atualiza no próximo ciclo, então dois
  // cliques rápidos disparariam dois pedidos (o banco recusaria o segundo, mas ele nem deve sair daqui)
  const sendingRef = useRef(false);
  const send = useMutation({
    mutationFn: async (text?: string) => {
      try {
        return await sendFn({ data: { suggestionId: suggestion!.id, ...(text ? { text } : {}) } });
      } finally {
        sendingRef.current = false;
      }
    },
    onSuccess: (r) => {
      setLastSend(r.outcome);
      setEditing(false);
      invalidate();
      if (r.outcome.status === "sent" || r.outcome.status === "reconciled_sent") onSent?.();
    },
    onError: (e) => setError(friendlyErrorMessage(e, "Não foi possível enviar.")),
  });

  if (!q.data || !enabled) return null;
  if (!suggestion) {
    if (!latestGuestMessageId) return null;
    return (
      <div
        data-testid="ai-suggestion-card"
        className="shrink-0 border-t border-border bg-surface px-3 pt-2"
      >
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-secondary px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
          <Sparkles className="size-3" />
          <span>Sugestão da IA</span>
          {!flags.generation ? (
            <span data-testid="ai-suggestion-generation-off" className="ml-auto">
              geração desativada nesta fase
            </span>
          ) : ensure.isPending ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> gerando…
            </span>
          ) : (
            <button
              type="button"
              onClick={() => ensure.mutate()}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10.5px] hover:bg-surface-elevated"
            >
              <RefreshCw className="size-3" /> Gerar sugestão
            </button>
          )}
        </div>
      </div>
    );
  }

  const state = suggestion.state;
  const finalText = copilotFinalText(suggestion);
  const actionable = isCopilotActionable(state);
  const busy = send.isPending || edit.isPending || discard.isPending || state === "sending";
  const stale =
    latestGuestMessageId !== null && suggestion.trigger_message_id !== latestGuestMessageId;
  const warnings: string[] = [...suggestion.warnings];
  if (stale && actionable) warnings.unshift("newer_guest_message");

  const startEdit = () => {
    setDraft(finalText ?? "");
    setEditing(true);
    setError(null);
  };

  return (
    <div
      data-testid="ai-suggestion-card"
      data-state={state}
      className="shrink-0 border-t border-border bg-surface px-3 pt-2"
    >
      <div
        className={`rounded-lg border border-dashed px-2.5 py-2 text-[12px] ${state === "send_failed" ? "border-destructive/50 bg-destructive/5" : "border-primary/40 bg-primary/5"}`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <Sparkles className="size-3.5 text-primary" /> Sugestão da IA
          </span>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            IA
          </span>
          <span
            data-testid="ai-suggestion-state"
            className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {state === "generating" || state === "sending" ? (
              <Loader2 className="mr-1 inline size-2.5 animate-spin" />
            ) : null}
            {STATE_LABEL[state]}
          </span>
          {state !== "sent" && (
            <span className="text-[10px] text-muted-foreground">rascunho — não enviado</span>
          )}
          {suggestion.intents.length > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              intenção: {suggestion.intents.map((i) => INTENT_LABEL[i] ?? i).join(", ")}
            </span>
          )}
        </div>

        {state === "generating" && (
          <p className="mt-1.5 text-muted-foreground">
            A IA está lendo a conversa, o Dossiê e a reserva para propor uma resposta…
          </p>
        )}

        {(state === "no_suggestion" || state === "generation_failed" || state === "superseded") && (
          <p className="mt-1.5 text-muted-foreground">
            {OUTCOME_LABEL[suggestion.outcome_code ?? ""] ??
              (state === "generation_failed"
                ? `Não foi possível gerar a sugestão (${suggestion.gateway_error ?? suggestion.outcome_code ?? "erro"}).`
                : "A IA não propôs resposta para esta mensagem.")}
          </p>
        )}
        {suggestion.internal_question && (
          <p className="mt-1.5 rounded border border-border bg-background px-2 py-1 text-[11.5px]">
            <span className="font-medium">Pergunta da IA para a equipe:</span>{" "}
            {suggestion.internal_question}
          </p>
        )}

        {finalText && !editing && (
          <p
            data-testid="ai-suggestion-text"
            className={`mt-1.5 whitespace-pre-wrap break-words rounded border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground ${state === "discarded" ? "line-through opacity-60" : ""}`}
          >
            {finalText}
          </p>
        )}
        {editing && (
          <div className="mt-1.5">
            <textarea
              data-testid="ai-suggestion-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              maxLength={4000}
              className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary"
            />
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                disabled={busy || !draft.trim()}
                onClick={() => edit.mutate(draft.trim())}
                className="rounded-md bg-primary px-2 py-0.5 text-[11px] text-primary-foreground disabled:opacity-50"
              >
                {edit.isPending ? (
                  <Loader2 className="inline size-3 animate-spin" />
                ) : (
                  "Salvar edição"
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
                className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-surface-elevated"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {warnings.length > 0 && state !== "discarded" && (
          <ul data-testid="ai-suggestion-warnings" className="mt-1.5 space-y-0.5">
            {warnings.map((w) => (
              <li key={w} className="inline-flex items-start gap-1 text-[11px] text-amber-700">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  {w === "newer_guest_message"
                    ? "O hóspede enviou mensagem mais nova: releia antes de enviar."
                    : (WARNING_LABEL[w] ?? w)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {contextSummary(suggestion).length > 0 && (
          <p
            data-testid="ai-suggestion-context"
            className="mt-1.5 text-[10.5px] text-muted-foreground"
          >
            Contexto usado: {contextSummary(suggestion).join(" · ")}
          </p>
        )}

        {state === "send_failed" && (
          <p
            data-testid="ai-suggestion-send-error"
            className="mt-1.5 inline-flex items-start gap-1 text-[11px] text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />{" "}
            {sendErrorLabel(suggestion.send_error)}
          </p>
        )}
        {state === "sent" && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-emerald-700">
            <CheckCircle2 className="size-3" /> Enviada ao hóspede pela equipe
            {suggestion.sent_at
              ? ` · ${new Date(suggestion.sent_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </p>
        )}
        {lastSend?.status === "send_in_progress" && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Envio já em andamento (outra aba ou clique repetido).
          </p>
        )}
        {lastSend?.status === "send_disabled" && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Envio pela sugestão desativado no servidor.
          </p>
        )}
        {lastSend?.status === "unknown_result" && (
          <p className="mt-1.5 text-[11px] text-destructive">{SEND_ERROR_LABEL.unknown_result}</p>
        )}
        {error && (
          <p className="mt-1.5 inline-flex items-start gap-1 text-[11px] text-destructive">
            <X className="mt-0.5 size-3 shrink-0" /> {error}
          </p>
        )}

        {actionable && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!editing && (
              <button
                type="button"
                data-testid="ai-suggestion-edit"
                disabled={busy}
                onClick={startEdit}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-surface-elevated disabled:opacity-50"
              >
                <Pencil className="size-3" /> Editar
              </button>
            )}
            <button
              type="button"
              data-testid="ai-suggestion-discard"
              disabled={busy}
              onClick={() => discard.mutate()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-surface-elevated disabled:opacity-50"
            >
              <Trash2 className="size-3" /> Descartar
            </button>
            <button
              type="button"
              data-testid="ai-suggestion-send"
              disabled={busy || !canSend || !flags.send || !(editing ? draft.trim() : finalText)}
              title={
                !flags.send
                  ? "Envio pela sugestão desativado nesta fase"
                  : canSend
                    ? undefined
                    : "Assuma a conversa para enviar"
              }
              onClick={() => {
                if (sendingRef.current) return;
                sendingRef.current = true;
                send.mutate(editing ? draft.trim() : undefined);
              }}
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
            >
              {send.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Send className="size-3" />
              )}
              {state === "send_failed" ? "Tentar novamente" : "Enviar ao Hóspede"}
            </button>
            {!flags.send ? (
              <span
                data-testid="ai-suggestion-send-off"
                className="w-full text-[10.5px] text-muted-foreground"
              >
                Envio pela sugestão desativado nesta fase.
              </span>
            ) : (
              !canSend && (
                <span className="w-full text-[10.5px] text-muted-foreground">
                  Assuma a conversa para poder enviar a sugestão.
                </span>
              )
            )}
          </div>
        )}
        {state === "sending" && !send.isPending && (
          <div className="mt-2">
            <button
              type="button"
              disabled={send.isPending}
              onClick={() => {
                if (sendingRef.current) return;
                sendingRef.current = true;
                send.mutate(undefined);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-surface-elevated"
            >
              <RefreshCw className="size-3" /> Verificar envio
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
