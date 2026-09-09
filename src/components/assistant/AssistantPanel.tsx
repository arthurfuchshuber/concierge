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
import { Sparkles, Send, Loader2, X, RotateCcw, Paperclip, Mic } from "lucide-react";
import {
  askAssistant,
  listAssistantThread,
  startAssistantThread,
  transcribeAssistantAudio,
} from "@/lib/assistant.functions";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import { createTask, setTaskStatus } from "@/lib/tasks.functions";
import { advanceArrival, markNoShow, upsertArrivalStatus } from "@/lib/dashboard.functions";
import type { AssistantMessage, PendingAction } from "@/lib/assistant-types";
import { AiMarkdown } from "@/components/ai/AiMarkdown";
import {
  CHAT_HEADER,
  CHAT_HEADER_BTN,
  COMPOSER_BAR,
  COMPOSER_FIELD,
  COMPOSER_ICON_BTN,
  COMPOSER_SEND_BTN,
} from "@/components/chat/composer-styles";
import { toast } from "sonner";

/** Blob → base64 puro (sem o cabeçalho data:), que é o que a transcrição espera. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Não consegui ler o áudio gravado."));
    reader.readAsDataURL(blob);
  });
}

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
  const predictionFn = useServerFn(upsertArrivalStatus);
  const advanceFn = useServerFn(advanceArrival);
  const transcribeFn = useServerFn(transcribeAssistantAudio);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Mensagens desta sessão de tela — o histórico gravado entra por baixo delas
  // na primeira carga e depois não é mais relido, pra não piscar a conversa.
  const [live, setLive] = useState<AssistantMessage[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [doneActions, setDoneActions] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Imagem anexada à PRÓXIMA pergunta. Vive só até o envio: não é
  // guardada em lugar nenhum, serve para o modelo olhar e acaba ali.
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

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
    mutationFn: (v: { text: string; imageDataUrl: string | null }) =>
      askFn({
        data: {
          threadId,
          message: v.text,
          currentPath: pathname,
          imageDataUrl: v.imageDataUrl,
        },
      }),
    onSuccess: (res) => {
      setThreadId(res.threadId);
      setLive((prev) => [...prev, res.message]);
      setPending(res.message.pendingAction);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Não consegui responder agora.");
    },
  });

  const busy = ask.isPending || transcribing;

  function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    const attached = image;
    setDraft("");
    setImage(null);
    setPending(null);
    setLive((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        // Marca a imagem na própria bolha: sem isso, a pessoa manda um print e
        // a conversa não guarda sinal nenhum de que ele foi junto.
        content: attached ? `${clean}\n\n📎 ${attached.name}` : clean,
        role: "user",
        createdAt: new Date().toISOString(),
        sources: [],
        pendingAction: null,
      },
    ]);
    ask.mutate({ text: clean, imageDataUrl: attached?.dataUrl ?? null });
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Por enquanto eu consigo olhar imagens — uma foto ou um print da tela.");
      return;
    }
    // 6 MB: acima disso o data URL passa do limite aceito pela server function.
    if (file.size > 6_000_000) {
      toast.error("Imagem muito grande. Tente uma menor que 6 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage({ dataUrl: String(reader.result), name: file.name });
    reader.onerror = () => toast.error("Não consegui ler esse arquivo.");
    reader.readAsDataURL(file);
  }

  /**
   * Áudio vira texto e segue como qualquer pergunta digitada — inclusive o
   * cartão de confirmação, quando é um pedido de ação. Falar é outra forma de
   * escrever, não um segundo caminho com regras próprias.
   */
  async function onRecorded(a: RecordedAudio) {
    setRecording(false);
    setTranscribing(true);
    try {
      const base64 = await blobToBase64(a.blob);
      const { text } = await transcribeFn({ data: { audioBase64: base64, mimeType: a.mime } });
      setTranscribing(false);
      send(text);
    } catch (err) {
      setTranscribing(false);
      toast.error(err instanceof Error ? err.message : "Não consegui transcrever o áudio.");
    }
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
            recurrenceDays: a.payload.recurrenceDays ?? undefined,
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
      if (a.kind === "create_task_bulk") {
        /**
         * UMA confirmação, N gravações — pedido explícito (08/09/2026): "crie
         * a recorrência em todos os imóveis sem me pedir para confirmar a
         * gravação de cada um deles".
         *
         * Em série, de propósito: `createTask` é a MESMA server function da
         * tela de Pendências, e disparar quarenta em paralelo só troca a
         * espera do usuário por picos no banco. Em série, um erro no meio não
         * derruba o que já entrou — o que já foi criado, fica.
         */
        const falhas: string[] = [];
        for (const prop of a.payload.properties) {
          try {
            await createTaskFn({
              data: {
                title: a.payload.base.title,
                description: a.payload.base.description ?? undefined,
                category: a.payload.base.category,
                priority: a.payload.base.priority,
                propertyId: prop.id,
                dueDate: a.payload.base.dueDate ?? undefined,
                showInCleaning: a.payload.base.showInCleaning ?? undefined,
                recurrenceDays: a.payload.base.recurrenceDays ?? undefined,
              },
            } as never);
          } catch {
            falhas.push(prop.name);
          }
        }
        if (falhas.length) {
          throw new Error(
            `Criei em ${a.payload.properties.length - falhas.length} de ${a.payload.properties.length}. Não consegui em: ${falhas.join(", ")}.`,
          );
        }
        return;
      }
            if (a.kind === "set_task_status") {
        await setStatusFn({ data: { taskId: a.payload.taskId, status: a.payload.status } } as never);
        return;
      }
      if (a.kind === "set_prediction") {
        await predictionFn({
          data: {
            logId: a.payload.logId ?? undefined,
            reservationId: a.payload.reservationId ?? undefined,
            kind: a.payload.kind,
            // `null` aqui é significativo — é como a tela LIMPA o campo. Por
            // isso não pode virar `undefined` (que o servidor lê como "não
            // mexer neste campo").
            arrivalDateOverride: a.payload.arrivalDateOverride,
            arrivalTimeOverride: a.payload.arrivalTimeOverride,
          },
        } as never);
        return;
      }
      if (a.kind === "advance") {
        await advanceFn({
          data: {
            logId: a.payload.logId ?? undefined,
            reservationId: a.payload.reservationId ?? undefined,
            from: a.payload.from,
            cleaningType: a.payload.cleaningType ?? undefined,
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
      <div className={CHAT_HEADER}>
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <span className="truncate text-sm font-medium">Assistente</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            onClick={newThread}
            title="Começar uma conversa nova"
            aria-label="Começar uma conversa nova"
            className={CHAT_HEADER_BTN}
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className={CHAT_HEADER_BTN}
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
        className="shrink-0 border-t border-border bg-surface px-3 py-2"
      >
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />

        {image && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
            <img src={image.dataUrl} alt="" className="size-8 shrink-0 rounded object-cover" />
            <span className="min-w-0 flex-1 truncate text-[11.5px]">{image.name}</span>
            <button
              type="button"
              onClick={() => setImage(null)}
              aria-label="Remover imagem"
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* Anexo à esquerda, áudio à direita — a mesma disposição do resto do
            sistema, para o gesto não mudar de lugar entre uma tela e outra. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label="Anexar imagem"
            title="Anexar uma foto ou print"
            className={COMPOSER_ICON_BTN}
          >
            <Paperclip className="size-4" />
          </button>

          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={transcribing ? "transcrevendo…" : "Pergunte alguma coisa…"}
            disabled={transcribing}
            className={`${COMPOSER_FIELD} text-sm`}
          />

          {/* Enviar só toma o lugar do microfone quando há texto — do contrário
              o botão de falar sumiria justamente de quem prefere falar. */}
          {draft.trim() || image ? (
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              aria-label="Enviar"
              className={`${COMPOSER_SEND_BTN} bg-accent text-accent-foreground`}
            >
              {ask.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          ) : transcribing ? (
            <span className="grid size-8 shrink-0 place-items-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </span>
          ) : recording ? (
            <AudioRecorderButton
              autoStart
              compact
              maxSeconds={120}
              onRecorded={onRecorded}
              onCancel={() => setRecording(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setRecording(true)}
              disabled={busy}
              aria-label="Falar"
              title="Ditar sua pergunta ou um pedido"
              className={COMPOSER_ICON_BTN}
            >
              <Mic className="size-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: AssistantMessage }) {
  const mine = message.role === "user";
  return (
    <div className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[88%] break-words rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
          mine ? "whitespace-pre-wrap bg-primary text-primary-foreground" : "border border-border bg-card"
        }`}
      >
        {/* O que a pessoa digitou é texto puro — se ela escrever asteriscos,
            deve ver asteriscos. Só a resposta da IA passa pelo Markdown. */}
        {mine ? message.content : <AiMarkdown>{message.content}</AiMarkdown>}
      </div>
      {/* Só as fontes. O "abrir tela" saiu daqui em 07/09/2026: quando a IA
          aponta um lugar do sistema, ela escreve o nome da tela como link
          dentro da própria frase — um chip repetindo a mesma coisa embaixo era
          poluição, e obrigava a ler duas vezes para entender que era um
          caminho só. */}
      {!mine && message.sources.length > 0 && (
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
