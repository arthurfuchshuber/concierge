/**
 * Painel do Assistente do Painel (pedido explícito, 07/09/2026).
 *
 * A parte que merece atenção é a confirmação de ação. Quando a resposta vem
 * com uma `pendingAction`, o painel mostra o cartão com os campos exatos que
 * serão gravados e só grava no clique — chamando a MESMA server function que
 * a tela correspondente usaria (`createTask`, `setTaskStatus`, `markNoShow`).
 * Nada de um caminho de escrita paralelo: se a regra de criação de pendência
 * mudar amanhã, o assistente acompanha sem ninguém lembrar dele.
 *
 * Por isso também as queries do painel são invalidadas depois de confirmar —
 * o quadro atrás precisa refletir o que acabou de acontecer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Sparkles, Send, Loader2, X, RotateCcw, ArrowUpRight } from "lucide-react";
import { askAssistant, listAssistantThread, startAssistantThread } from "@/lib/assistant.functions";
import { createTask, setTaskStatus } from "@/lib/tasks.functions";
import { markNoShow } from "@/lib/dashboard.functions";
import type { AssistantMessage, PendingAction } from "@/lib/assistant-types";
import { toast } from "sonner";

const SUGESTOES = [
  "Como marco que o hóspede não compareceu?",
  "Quantas limpezas eu tenho amanhã?",
  "Por que a pendência de manutenção já aparece na limpeza?",
];

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const askFn = useServerFn(askAssistant);
  const listFn = useServerFn(listAssistantThread);
  const startFn = useServerFn(startAssistantThread);
  const createTaskFn = useServerFn(createTask);
  const setStatusFn = useServerFn(setTaskStatus);
  const noShowFn = useServerFn(markNoShow);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Mensagens desta sessão de tela — o histórico gravado entra por baixo delas
  // na primeira carga e depois não é mais relido, pra não piscar a conversa.
  const [live, setLive] = useState<AssistantMessage[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [doneActions, setDoneActions] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const history = useQuery({
    queryKey: ["assistant-thread"],
    queryFn: () => listFn({ data: {} }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (history.data?.threadId && !threadId) setThreadId(history.data.threadId);
  }, [history.data?.threadId, threadId]);

  const messages = useMemo(
    () => [...(history.data?.messages ?? []), ...live],
    [history.data?.messages, live],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending]);

  const ask = useMutation({
    mutationFn: (text: string) =>
      askFn({ data: { threadId, message: text, currentPath: pathname } }),
    onSuccess: (res) => {
      setThreadId(res.threadId);
      setLive((prev) => [...prev, res.message]);
      setPending(res.message.pendingAction);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Não consegui responder agora.");
    },
  });

  function send(text: string) {
    const clean = text.trim();
    if (!clean || ask.isPending) return;
    setDraft("");
    setPending(null);
    setLive((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: clean,
        createdAt: new Date().toISOString(),
        sources: [],
        route: null,
        pendingAction: null,
      },
    ]);
    ask.mutate(clean);
  }

  /** Executa a ação confirmada pela mesma porta que a interface normal usa. */
  const confirm = useMutation({
    mutationFn: async (p: PendingAction) => {
      const a = p.action;
      if (a.kind === "create_task") {
        await createTaskFn({
          data: {
            title: a.payload.title,
            description: a.payload.description ?? undefined,
            category: a.payload.category,
            priority: a.payload.priority,
            propertyId: a.payload.propertyId ?? undefined,
            ownerContactId: a.payload.ownerContactId ?? undefined,
            dueDate: a.payload.dueDate ?? undefined,
            showInCleaning: a.payload.showInCleaning ?? undefined,
          },
        } as never);
        return;
      }
      if (a.kind === "complete_task") {
        await setStatusFn({
          data: {
            taskId: a.payload.taskId,
            status: "done",
            resolutionNote: a.payload.resolutionNote,
          },
        } as never);
        return;
      }
      await noShowFn({
        data: {
          logId: a.payload.logId ?? undefined,
          reservationId: a.payload.reservationId ?? undefined,
        },
      } as never);
    },
    onSuccess: (_r, p) => {
      setDoneActions((prev) => new Set(prev).add(JSON.stringify(p.action)));
      setPending(null);
      toast.success("Feito.");
      // O quadro atrás precisa refletir a gravação — mesma lógica de
      // invalidação que as telas usam depois de qualquer mutação.
      qc.invalidateQueries();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Não consegui concluir a ação.");
    },
  });

  async function newThread() {
    const res = await startFn();
    setThreadId(res.threadId);
    setLive([]);
    setPending(null);
    qc.setQueryData(["assistant-thread"], { threadId: res.threadId, messages: [] });
  }

  const empty = !messages.length && !history.isLoading;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-secondary/40 px-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <span className="truncate text-sm font-medium">Assistente</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            onClick={newThread}
            title="Começar uma conversa nova"
            aria-label="Começar uma conversa nova"
            className="grid size-7 place-items-center rounded-md hover:bg-secondary"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-7 place-items-center rounded-md hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {empty && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Pergunte como algo funciona, consulte a sua operação ou peça para eu preparar uma ação.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-left text-[12.5px] hover:bg-secondary/50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {ask.isPending && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> pensando…
          </div>
        )}

        {pending && !doneActions.has(JSON.stringify(pending.action)) && (
          <ActionCard
            pending={pending}
            busy={confirm.isPending}
            onConfirm={() => confirm.mutate(pending)}
            onCancel={() => setPending(null)}
          />
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-3 py-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Pergunte alguma coisa…"
          className="h-8 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-sm outline-none focus:ring-0"
        />
        <button
          type="submit"
          disabled={!draft.trim() || ask.isPending}
          aria-label="Enviar"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"
        >
          {ask.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: AssistantMessage }) {
  const mine = message.role === "user";
  return (
    <div className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
          mine ? "bg-primary text-primary-foreground" : "border border-border bg-card"
        }`}
      >
        {message.content}
      </div>
      {!mine && (message.sources.length > 0 || message.route) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {message.sources.slice(0, 3).map((s, i) => (
            <span
              key={`${s.label}-${i}`}
              className="rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-[10px] text-muted-foreground"
              title={s.kind}
            >
              {s.label}
            </span>
          ))}
          {message.route && (
            <a
              href={message.route.path}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium hover:bg-secondary/50"
            >
              Abrir {message.route.label} <ArrowUpRight className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function ActionCard({
  pending,
  busy,
  onConfirm,
  onCancel,
}: {
  pending: PendingAction;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-border border-l-[3px] border-l-accent bg-card p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-accent">Confirmar antes de gravar</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {pending.preview.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="m-0 font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy && <Loader2 className="size-3 animate-spin" />}
          {pending.confirmLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[11.5px] font-semibold hover:bg-secondary/50 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
