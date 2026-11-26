import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, CircleCheck, LoaderCircle } from "lucide-react";
import { useMemo } from "react";
import { format } from "date-fns";
import {
  decideHumanDecisionFn,
  listConversationDecisions,
  type ConversationDecision,
} from "@/lib/guest-ai-decision.functions";
import {
  decisionBusyLabel,
  decisionRecordText,
  decisionTextParts,
  visibleDecisionOptions,
  type DecisionOption,
} from "@/lib/guest-ai-decision";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { toast } from "sonner";

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

/** A IA ainda está levando ao hóspede a resposta escolhida (o campo de mensagem fica bloqueado). */
export function decisionSending(d: ConversationDecision): boolean {
  if (d.status !== "decided" || d.ai_reply_status !== "pending") return false;
  const opt = d.options.find((o) => o.id === d.decided_option_id);
  return !!opt && opt.ai_intent !== "assume";
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {decisionTextParts(text).map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-bold">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const PRI =
  "inline-flex h-8 shrink-0 whitespace-nowrap items-center justify-center gap-1.5 rounded-[8px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-3 text-[12px] font-bold text-white";
const SEC =
  "inline-flex h-8 shrink-0 whitespace-nowrap items-center justify-center rounded-[8px] bg-sky-100 px-3 text-[12px] font-bold text-sky-900 transition-colors hover:bg-sky-200/70 dark:bg-sky-400/20 dark:text-sky-100";

/**
 * FAIXA DA DECISÃO DA EQUIPE (25/11/2026, mockups ATD-D09/M10/D18/M21): de ponta a ponta, no formato da faixa do
 * motivo e da nota interna, em azul suave, logo ABAIXO da mensagem do hóspede que originou o pedido — corre junto
 * com a conversa (mensagens novas entram abaixo dela). Texto com o fato (negritos), sem cabeçalho nem pergunta;
 * botões pequenos, o que mais beneficia o anfitrião em destaque e primeiro; sem "Eu Assumo a Conversa".
 * Ao clicar: o botão escolhido mostra o envio ("Cobrando Meia Diária…"), os demais apagam e o campo de mensagem
 * bloqueia (`onSendingChange`) até a IA entregar a resposta; então a faixa sai e fica a linha de registro.
 */
export function DecisionStrip({
  decision,
  conversationId,
  compact,
  pendingOptionId,
  onPick,
}: {
  decision: ConversationDecision;
  conversationId: string;
  /** Celular: botões em grade de 2 colunas, o destaque na linha inteira. */
  compact?: boolean;
  /** Opção clicada agora (antes do banco confirmar). */
  pendingOptionId: string | null;
  onPick: (optionId: string | null) => void;
}) {
  const qc = useQueryClient();
  const decideFn = useServerFn(decideHumanDecisionFn);
  const decide = useMutation({
    mutationFn: (optionId: string) => decideFn({ data: { decisionId: decision.id, optionId } }),
    onSuccess: (r) => {
      if (r.ok) {
        if (r.message) toast(r.message);
      } else if (r.alreadyDecided) {
        toast(
          `Já decidido${r.alreadyDecided.by ? ` por ${r.alreadyDecided.by}` : ""}${r.alreadyDecided.at ? ` às ${hhmm(r.alreadyDecided.at)}` : ""}`,
        );
      } else toast.error(r.message);
    },
    onError: (e) => toast.error(friendlyErrorMessage(e, "Não foi possível concluir a decisão.")),
    onSettled: () => {
      onPick(null);
      void qc.invalidateQueries({ queryKey: ["conv-decisions", conversationId] });
      void qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      void qc.invalidateQueries({ queryKey: ["handoff-list"] });
    },
  });
  const sendingId = pendingOptionId ?? (decisionSending(decision) ? decision.decided_option_id : null);
  const busy = !!sendingId || decide.isPending;
  const options = visibleDecisionOptions(decision.options);
  const click = (o: DecisionOption) => {
    if (busy || decision.status !== "pending") return; // trava local; a do banco é a definitiva
    onPick(o.id);
    decide.mutate(o.id);
  };
  const btn = (o: DecisionOption, extra = "") => {
    const sending = sendingId === o.id;
    const primary = o.variant === "primary";
    return (
      <button
        key={o.id}
        type="button"
        aria-busy={sending}
        disabled={busy}
        onClick={() => click(o)}
        className={`${primary ? PRI : SEC} ${busy ? (sending ? "pointer-events-none" : "pointer-events-none opacity-45") : ""} ${extra}`}
      >
        {sending ? (
          <>
            <span className="inline-flex animate-spin">
              <LoaderCircle className="size-3.5" />
            </span>
            {decisionBusyLabel(o)}
          </>
        ) : (
          <>
            {primary ? <Check className="size-3.5" /> : null}
            {o.label}
          </>
        )}
      </button>
    );
  };
  const secondaries = options.filter((o) => o.variant !== "primary");
  return (
    <div
      data-testid="decision-strip"
      className={`${compact ? "-mx-[14px] px-[14px]" : "-mx-4 px-4"} bg-sky-50 py-2.5 text-[12px] text-sky-950 dark:bg-sky-400/[0.08] dark:text-sky-100`}
    >
      <p className="leading-[1.45]">
        <Rich text={decision.question_text} />
      </p>
      {compact ? (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {options.map((o) => btn(o, o.variant === "primary" || secondaries.length === 1 ? "col-span-2" : ""))}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">{options.map((o) => btn(o))}</div>
      )}
    </div>
  );
}

/** Linha discreta de registro no lugar da faixa: o que foi decidido, por quem e quando. */
export function DecisionRecord({ decision }: { decision: ConversationDecision }) {
  const who = decision.decidedByName ?? "Equipe";
  const when = decision.decided_at ? hhmm(decision.decided_at) : "";
  const tail = decision.status === "decided" ? ` · ${who}${when ? ` · ${when}` : ""}` : "";
  return (
    <div data-testid="decision-record" className="flex flex-col items-center gap-0.5 py-1">
      <div className="flex max-w-full items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
        <CircleCheck className="size-3.5 shrink-0" />
        <span className="truncate">
          <RecordRich text={decisionRecordText(decision)} />
          {tail}
        </span>
      </div>
      {decision.status === "decided" && decision.ai_reply_status === "error" ? (
        <span className="text-[11px] font-semibold" style={{ color: "#c98c8c" }}>
          A IA não enviou a resposta: responda manualmente.
        </span>
      ) : null}
    </div>
  );
}

function RecordRich({ text }: { text: string }) {
  return (
    <>
      {decisionTextParts(text).map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-semibold text-foreground/80">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
