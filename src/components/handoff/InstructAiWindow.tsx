/**
 * JANELA "INSTRUIR A IA" (mockups ATD-D12/D13/D14 e M13/M14/M15, aprovados em 24–26/11/2026). Abre pela janela
 * Motivo do Encaminhamento, na MESMA janela ("‹ Voltar" volta ao motivo):
 *  - Pergunta da IA (o que ela perguntou à equipe ao encaminhar) e Sua Instrução (texto livre ou ditado);
 *  - situação regional confirmada: "Aplicar às N Conversas Afetadas" (a IA avalia em cada uma);
 *  - "Ensinar a IA para as Próximas": a instrução vira aprendizado nos imóveis escolhidos (padrão: só o imóvel
 *    desta conversa). Quem pode aprovar ativa na hora; os demais mandam para Aprendizados (apoio muda conforme a
 *    permissão). Com vários imóveis, a IA avisa de forma ESPECÍFICA quando o item físico difere entre eles;
 *  - "Enviar à IA": a IA avalia se ainda precisa responder ao hóspede e só envia o que ficou em aberto.
 * Etapa "Imóveis" na mesma janela: busca, Selecionar Todos, "N Selecionados" + X, no máximo 5 visíveis, Confirmar.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, House, Sparkles, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { AtdWindow, BTN_BRAND, CompactSwitch, WinSearch } from "./atd-window";
import {
  getConversationAiQuestion,
  getLearningApprovalRight,
  instructAi,
  listConversationAccountProperties,
  reviewInstructionScope,
  type AffectedConversation,
  type RegionalSituation,
} from "@/lib/atendimento.functions";
import { transcribeAssistantAudio } from "@/lib/assistant.functions";
import { AudioRecorderButton, type RecordedAudio } from "./AudioRecorderButton";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { joinNames } from "@/lib/regional-situation";
import { cn } from "@/lib/utils";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Não consegui ler o áudio gravado."));
    reader.readAsDataURL(blob);
  });
}

const LABEL = "text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground";

const imoveisLabel = (n: number) => `${n} ${n === 1 ? "Imóvel" : "Imóveis"}`;

export function InstructAiWindow({
  open,
  onOpenChange,
  onBack,
  conversationId,
  propertyId,
  propertyName,
  regional,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onBack: () => void;
  conversationId: string;
  propertyId: string;
  propertyName: string;
  regional: { situation: RegionalSituation; affected: AffectedConversation[] } | null;
  onDone: (message: string | null) => void;
}) {
  const questionFn = useServerFn(getConversationAiQuestion);
  const propsFn = useServerFn(listConversationAccountProperties);
  const rightFn = useServerFn(getLearningApprovalRight);
  const scopeFn = useServerFn(reviewInstructionScope);
  const instructFn = useServerFn(instructAi);
  const transcribeFn = useServerFn(transcribeAssistantAudio);

  const question = useQuery({ queryKey: ["conv-ai-question", conversationId], queryFn: () => questionFn({ data: { conversationId } }), enabled: open });
  const props = useQuery({ queryKey: ["conv-account-props", conversationId], queryFn: () => propsFn({ data: { conversationId } }), enabled: open, staleTime: 60_000 });
  const right = useQuery({ queryKey: ["learning-right", conversationId], queryFn: () => rightFn({ data: { conversationId } }), enabled: open, staleTime: 60_000 });

  const others = (regional?.affected ?? []).filter((c) => c.id !== conversationId);
  const [step, setStep] = useState<"instr" | "props">("instr");
  const [instruction, setInstruction] = useState("");
  const [teach, setTeach] = useState(true);
  const [applyAffected, setApplyAffected] = useState(true);
  // padrão: só o imóvel desta conversa; com situação regional, os imóveis afetados
  const [selected, setSelected] = useState<string[]>(() => {
    if (regional && regional.affected.length) return [...new Set([propertyId, ...regional.affected.map((c) => c.propertyId)])];
    return [propertyId];
  });
  const [draft, setDraft] = useState<string[]>(selected);
  const [search, setSearch] = useState("");
  const [transcribing, setTranscribing] = useState(false);

  // aviso específico de escopo (instrução física em vários imóveis), com espera curta depois da digitação
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => {
    if (!teach || selected.length < 2 || instruction.trim().length < 8) {
      setWarning(null);
      return;
    }
    const t = setTimeout(() => {
      scopeFn({ data: { conversationId, instruction, propertyIds: selected } })
        .then((r) => setWarning(r.warning))
        .catch(() => setWarning(null));
    }, 900);
    return () => clearTimeout(t);
  }, [teach, selected, instruction, conversationId, scopeFn]);

  const send = useMutation({
    mutationFn: () =>
      instructFn({
        data: {
          conversationId,
          instruction: instruction.trim(),
          teach,
          propertyIds: teach ? selected : [],
          alsoConversationIds: regional && applyAffected ? others.map((c) => c.id) : [],
        },
      }),
    onSuccess: (r) => {
      toast(r.message);
      onDone(r.message);
    },
    onError: (e) => toast.error(friendlyErrorMessage(e, "Não foi possível enviar à IA.")),
  });

  const list = useMemo(() => props.data ?? [], [props.data]);
  const byId = useMemo(() => new Map(list.map((p) => [p.id, p])), [list]);
  const shortName = (id: string) => {
    const n = byId.get(id)?.name ?? propertyName;
    return n.replace(/\s+(Aconchegante|Próximo|Próx\.|com|em|a)\b.*$/i, "").trim() || n;
  };
  const selectorLabel =
    regional && selected.length > 1
      ? `${imoveisLabel(selected.length)} Afetados`
      : selected.length === 1
        ? (byId.get(selected[0])?.name ?? propertyName)
        : `${shortName(selected[0] ?? propertyId)} e Mais ${imoveisLabel(selected.length - 1)}`;
  const canApprove = right.data?.canApprove === true;

  async function onDictated(a: RecordedAudio) {
    setTranscribing(true);
    try {
      const base64 = await blobToBase64(a.blob);
      const { text } = await transcribeFn({ data: { audioBase64: base64, mimeType: a.mime } });
      if (text?.trim()) setInstruction((v) => (v.trim() ? `${v.trim()} ${text.trim()}` : text.trim()));
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Não consegui transcrever o áudio."));
    } finally {
      setTranscribing(false);
    }
  }

  if (step === "props") {
    const q = search.trim().toLowerCase();
    const shown = q ? list.filter((p) => `${p.name} ${p.owner ?? ""}`.toLowerCase().includes(q)) : list;
    const allOn = shown.length > 0 && shown.every((p) => draft.includes(p.id));
    return (
      <AtdWindow
        open={open}
        onOpenChange={onOpenChange}
        onBack={() => {
          setDraft(selected);
          setStep("instr");
        }}
        title="Imóveis"
        subtitle="Onde a IA aplica esse aprendizado"
        width={360}
      >
        <WinSearch value={search} onChange={setSearch} placeholder="Buscar imóvel…" />
        <div className="flex items-center gap-2 px-4 pb-1.5 pt-1 text-[12px]">
          <button
            type="button"
            className="font-semibold text-foreground"
            onClick={() => setDraft(allOn ? draft.filter((id) => !shown.some((p) => p.id === id)) : [...new Set([...draft, ...shown.map((p) => p.id)])])}
          >
            {allOn ? "Desmarcar Todos" : "Selecionar Todos"}
          </button>
          <span className="flex-1" />
          <span className="font-semibold tabular-nums text-muted-foreground">
            {draft.length} {draft.length === 1 ? "Selecionado" : "Selecionados"}
          </span>
          <button type="button" aria-label="Remover seleção" onClick={() => setDraft([])} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06]">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="sg-elegant-scroll mx-2 flex max-h-[262px] flex-col gap-0.5 overflow-y-auto pr-2">
          {props.isLoading ? (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" /> Carregando…
            </div>
          ) : (
            shown.map((p) => {
              const on = draft.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft(on ? draft.filter((x) => x !== p.id) : [...draft, p.id])}
                  className={cn("flex min-w-0 flex-col gap-px rounded-[9px] px-3 py-2 text-left", on && "bg-foreground/[0.07]")}
                >
                  <span className={cn("truncate text-[13px] leading-[1.3]", on ? "font-bold" : "font-semibold")}>{p.name}</span>
                  {p.owner ? <span className="truncate text-[11.5px] text-muted-foreground">{p.owner}</span> : null}
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 pb-4 pt-3">
          <button
            type="button"
            disabled={draft.length === 0}
            onClick={() => {
              setSelected(draft);
              setStep("instr");
            }}
            className={`${BTN_BRAND} w-full flex-none`}
          >
            Confirmar
          </button>
        </div>
      </AtdWindow>
    );
  }

  return (
    <AtdWindow open={open} onOpenChange={onOpenChange} onBack={onBack} title="Instruir a IA" subtitle="A IA avalia se ainda precisa responder ao hóspede" width={360}>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
        {question.data?.question ? (
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Pergunta da IA</span>
            <div className="ds-well select-text px-3 py-2.5 text-[12.5px] leading-[1.45]">{question.data.question}</div>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Sua Instrução</span>
          <div className="ds-well relative min-h-[84px] py-2.5 pl-3 pr-11">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              placeholder="Escreva do seu jeito o que a IA deve dizer ao hóspede…"
              className="block min-h-[64px] w-full resize-none border-0 bg-transparent p-0 text-[12.5px] leading-[1.45] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <div className="absolute bottom-2 right-2">
              {transcribing ? (
                <span className="grid size-8 place-items-center text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                </span>
              ) : (
                <AudioRecorderButton maxSeconds={60} onRecorded={onDictated} compact />
              )}
            </div>
          </div>
        </div>
        {regional && others.length ? (
          <div className="ds-well flex items-start gap-2.5 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold leading-[18px]">
                Aplicar às {regional.affected.length} {regional.affected.length === 1 ? "Conversa Afetada" : "Conversas Afetadas"}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">{joinNames(regional.affected.map((c) => c.guestName))}</span>
            </span>
            <span className="-mt-[2px] shrink-0">
              <CompactSwitch on={applyAffected} onChange={setApplyAffected} label="Aplicar às conversas afetadas" />
            </span>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <div className="ds-well flex items-start gap-2.5 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold leading-[18px]">Ensinar a IA para as Próximas</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {canApprove ? "Vale na hora nos imóveis escolhidos" : "Vai para Aprendizados, para aprovação"}
              </span>
            </span>
            <span className="-mt-[2px] shrink-0">
              <CompactSwitch on={teach} onChange={setTeach} label="Ensinar a IA para as próximas" />
            </span>
          </div>
          {teach ? (
            <button
              type="button"
              onClick={() => {
                setDraft(selected);
                setStep("props");
              }}
              className="ds-well flex h-10 items-center gap-2 pl-3 pr-2.5 text-left"
            >
              <House className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{selectorLabel}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ) : null}
          {teach && warning ? <p className="text-[11.5px] leading-snug text-[#8a6a1a]">{warning}</p> : null}
        </div>
        <button type="button" disabled={instruction.trim().length < 3 || send.isPending} onClick={() => send.mutate()} className={`${BTN_BRAND} w-full flex-none`}>
          {send.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Enviar à IA
        </button>
      </div>
    </AtdWindow>
  );
}
