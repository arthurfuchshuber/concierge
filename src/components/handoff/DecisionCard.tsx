import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Hourglass, Loader2, VolumeX } from "lucide-react";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  decideHumanDecisionFn,
  listConversationDecisions,
  type ConversationDecision,
} from "@/lib/guest-ai-decision.functions";
import { DECISION_KIND_LABEL, decidedHeadline, type DecisionOption } from "@/lib/guest-ai-decision";
import { friendlyErrorMessage } from "@/lib/friendly-error";

/** Decisões da conversa, por mensagem do hóspede que as originou. Falha de leitura ⇒ nenhuma. */
export function useConversationDecisions(conversationId: string): {
  byMessage: Map<string, ConversationDecision>;
  list: ConversationDecision[];
} {
  const fn = useServerFn(listConversationDecisions);
  const q = useQuery({
    queryKey: ["conv-decisions", conversationId],
    queryFn: () => fn({ data: { conversationId } }),
    retry: false,
    refetchInterval: 4000,
  });
  return useMemo(() => {
    const list = q.data ?? [];
    return { list, byMessage: new Map(list.map((d) => [d.trigger_message_id, d])) };
  }, [q.data]);
}

const hhmm = (iso: string | null) => (iso ? format(new Date(iso), "HH:mm") : "");

const BTN =
  "flex min-h-10 w-full items-center justify-center gap-2 rounded-xl px-3 text-[13px] font-semibold leading-tight text-center transition-colors disabled:cursor-not-allowed";
const VARIANT: Record<DecisionOption["variant"], string> = {
  primary: "bg-foreground text-background hover:opacity-90 disabled:opacity-40",
  secondary:
    "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_18%,transparent)] hover:bg-secondary disabled:opacity-40",
  neutral:
    "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_18%,transparent)] hover:bg-secondary disabled:opacity-40",
  assume: "",
};

/**
 * CARTÃO DE DECISÃO HUMANA COM 1 CLIQUE (mockup aprovado em 10/11/2026). Largura total da coluna do chat,
 * botões empilhados (sem quebra feia a 360–390px), superfície neutra (âmbar só no ícone de pendente).
 * Pendente → clique (carregando no botão escolhido, demais desativados na hora) → decidido (carimbo de quem e
 * quando). Clique concorrente: "Já decidido por [Nome] às [Horário]".
 */
export function DecisionCard({
  decision,
  conversationId,
  guestName,
  propertyName,
}: {
  decision: ConversationDecision;
  conversationId: string;
  guestName?: string | null;
  propertyName?: string | null;
}) {
  const qc = useQueryClient();
  const decideFn = useServerFn(decideHumanDecisionFn);
  const [chosen, setChosen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (optionId: string) => decideFn({ data: { decisionId: decision.id, optionId } }),
    onSuccess: (r) => {
      if (r.ok) setNotice(r.message);
      else if (r.alreadyDecided)
        setNotice(
          `Já decidido${r.alreadyDecided.by ? ` por ${r.alreadyDecided.by}` : ""}${r.alreadyDecided.at ? ` às ${hhmm(r.alreadyDecided.at)}` : ""}`,
        );
      else {
        setNotice(r.message);
        setChosen(null);
      }
    },
    onError: (e) => {
      setNotice(friendlyErrorMessage(e, "Não foi possível concluir a decisão."));
      setChosen(null);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["conv-decisions", conversationId] });
      void qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      void qc.invalidateQueries({ queryKey: ["handoff-list"] });
    },
  });
  const busy = decide.isPending || chosen !== null;
  const click = (id: string) => {
    if (busy || decision.status !== "pending") return; // trava local; a do banco é a definitiva
    setChosen(id);
    setNotice(null);
    decide.mutate(id);
  };

  const shell =
    "w-full rounded-2xl bg-card px-3.5 py-3 text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]";

  if (decision.status !== "pending") {
    const who = decision.decidedByName ?? "Equipe";
    const opt = decision.options.find((o) => o.id === decision.decided_option_id);
    const assume = opt?.ai_intent === "assume";
    return (
      <div className={shell} data-testid="decision-card" data-state={decision.status}>
        <div className="flex items-start gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold leading-snug">
              {decision.status === "expired" ? "Decisão encerrada sem clique" : decidedHeadline(decision, who)}
            </div>
            {decision.status === "decided" ? (
              <div className="text-[12px] text-muted-foreground">
                {assume ? "IA em silêncio (sem envio)" : `Por ${who} · ${hhmm(decision.decided_at)}`}
              </div>
            ) : null}
            {decision.status === "decided" && !assume ? (
              <div className="text-[12px] text-muted-foreground">
                {decision.ai_reply_status === "sent"
                  ? "IA respondeu ao hóspede ✓"
                  : decision.ai_reply_status === "error"
                    ? "A IA não enviou resposta — responda manualmente"
                    : "IA respondendo ao hóspede…"}
              </div>
            ) : null}
            {notice ? (
              <div role="status" className="mt-1 text-[12px] text-muted-foreground">
                {notice}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const buttons = decision.options.filter((o) => o.ai_intent !== "assume");
  const assume = decision.options.find((o) => o.ai_intent === "assume");
  return (
    <div className={shell} data-testid="decision-card" data-state="pending">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        <Hourglass className="size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
        <span className="truncate">Decisão da equipe · {DECISION_KIND_LABEL[decision.kind]}</span>
      </div>
      {guestName || propertyName ? (
        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {[guestName ? `Hóspede: ${guestName.trim().split(/\s+/)[0]}` : null, propertyName].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      <p className="mt-2 text-[13.5px] leading-[19px] text-foreground/90">{decision.question_text}</p>
      <div className="mt-3 flex flex-col gap-2">
        {buttons.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy}
            aria-busy={chosen === o.id}
            onClick={() => click(o.id)}
            className={`${BTN} ${VARIANT[o.variant]}`}
          >
            {chosen === o.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            <span className="min-w-0 truncate">{chosen === o.id ? `${o.label}…` : o.label}</span>
          </button>
        ))}
        {assume ? (
          <button
            type="button"
            disabled={busy}
            aria-busy={chosen === assume.id}
            onClick={() => click(assume.id)}
            className="mx-auto inline-flex min-h-9 items-center gap-1.5 px-2 text-[12.5px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-40"
          >
            {chosen === assume.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {assume.label}
          </button>
        ) : null}
      </div>
      {notice ? (
        <div role="alert" className="mt-2 text-[12px] text-destructive">
          {notice}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5 border-t border-[color-mix(in_oklab,var(--foreground)_8%,transparent)] pt-2 text-[11.5px] text-muted-foreground">
        <VolumeX className="size-3.5 shrink-0" aria-hidden="true" />
        IA em silêncio até a decisão
      </div>
    </div>
  );
}
