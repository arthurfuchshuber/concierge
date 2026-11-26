/**
 * CONVERSA DO ATENDIMENTO (mockups ATD-D02…D18 / ATD-M03…M21, CANC, REG-D01/M01, aprovados em 23–26/11/2026).
 *
 * Layouts INDIVIDUAIS por visão (25/11/2026: o que muda no celular não replica no desktop e vice-versa):
 *  - desktop: cabeçalho de painel (título 17px + ações no canto, proprietário, e a reserva numa única linha num
 *    quadrante sem fundo próprio);
 *  - celular: tela cheia com a barra do sistema; título com "‹ Voltar" na mesma linha, proprietário e o quadrante
 *    da reserva em três linhas com as ações. Com o teclado aberto o quadrante SEMPRE recua para uma linha (hóspede
 *    com reticências + período) e volta ao fechar; tocar no quadrante alterna recolher/expandir (aberto ou fechado).
 * Faixas de ponta a ponta: Motivo (rosa, abre a janela Motivo do Encaminhamento), Decisão da Equipe (azul, presa
 * abaixo da mensagem do hóspede, corre com a conversa), Nota Interna (bege, a mais recente, "Ver (n)") e a pausa
 * da IA (âmbar). Ao clicar numa opção da decisão o campo bloqueia até a IA entregar a resposta.
 * Sem logo do Airbnb ou ícone de canal ao lado do nome do hóspede (25/11/2026). Tema do app (sem tema fixo).
 */
import { relativeDayWord } from "@/lib/relative-day";
import {
  CopyCode,
  StayGuestLine,
  StayNightsLine,
  StayPeriodLine,
  RelDay,
  buildStayView,
  guestsLabel,
  nightsLabel,
  shortAgo,
  stayBarClass,
  stayToneText,
  type StayView,
} from "./stay-view";
import { channelOf } from "./ChannelLogo";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { ComposerPlusMenu } from "@/components/handoff/ComposerPlusMenu";
import { LearnedBadge, useConversationLearnings } from "@/components/handoff/LearnedBadge";
import { DecisionRecord, DecisionStrip, decisionSending, useConversationDecisions } from "@/components/handoff/DecisionCard";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getHandoffConversation,
  sendHandoffMessage,
  claimHandoffConversation,
  releaseHandoffConversation,
  resolveHandoffConversation,
  requestHandoffClaim,
  cancelHandoffClaimRequest,
  transferHandoffConversation,
  listConversationTransferTargets,
  editHandoffMessage,
  deleteHandoffMessage,
  reopenHandoffConversation,
} from "@/lib/handoff.functions";
import { getConversationRegional, closeRegionalSituation } from "@/lib/atendimento.functions";
import { MessageText } from "@/components/handoff/MessageText";
import { attachStaffMessage } from "@/lib/chat-attachments.functions";
import { isPausedNow, minutesLeft } from "@/lib/chat/pause";
import { messageActions } from "@/lib/chat/message-actions";
import {
  ArrowRightLeft,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Copy,
  EllipsisVertical,
  Languages,
  LoaderCircle,
  Lock,
  Menu,
  MessageCircle,
  MessageSquare,
  Pause,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  UserCheck,
  UserPlus2,
  X,
  Zap,
  ChevronLeft,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { sendWhatsappFromConversation } from "@/lib/whatsapp.functions";
import { WHATSAPP_STANDBY_MESSAGE } from "@/lib/whatsapp-standby";
import { translateMessage } from "@/lib/translate.functions";
import { detectLanguage, userLanguage, LANG_NAMES } from "@/lib/lang-detect";
import { TagMentionTextarea, type TagMentionItem } from "@/components/tags/TagMentionTextarea";
import { getTagItemsForConversation } from "@/lib/guide-tag-items.functions";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import { COMPOSER_INPUT } from "@/components/chat/composer-styles";
import { AttachmentBubble, type AttachmentInfo } from "@/components/handoff/AttachmentBubble";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { AtdWindow, BTN_BRAND, BTN_SOFT, WinRow, WinSearch } from "./atd-window";
import { InstructAiWindow } from "./InstructAiWindow";
import { RegionalWindow } from "./RegionalWindow";
import { formatIntlPhone } from "@/lib/masks";
import conciergeLogo from "@/assets/concierge-logo.png";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ABRIR_MENU_EVENT } from "@/components/ui/tela-cheia-top";
import { isDecisionHandoffReason } from "@/lib/guest-ai-decision";
import { conversationsLabel, regionalTitle } from "@/lib/regional-situation";

/** Mensagem selecionada para a janela Opções da Mensagem (as ações dependem do canal de destino). */
type ActionMsg = {
  id: string;
  content: string;
  channel: string | null;
  isNote: boolean;
  isGuest: boolean;
  senderType: string | null;
  createdAt: string;
};
const NO_MESSAGE_ACTIONS = { copy: true, edit: false, delete: false } as const;
function toActionMsg(m: {
  id: string;
  content: string | null;
  sender_type: string | null;
  is_internal_note: boolean | null;
  created_at: string;
}): ActionMsg {
  return {
    id: m.id,
    content: m.content ?? "",
    channel: (m as { channel?: string | null }).channel ?? null,
    isNote: !!m.is_internal_note,
    isGuest: m.sender_type === "guest",
    senderType: m.sender_type ?? null,
    createdAt: m.created_at,
  };
}

type Props = {
  conversationId: string;
  /** Mini-chat das bolhas: só a conversa, sem o cabeçalho completo. */
  compact?: boolean;
  myUserId: string | null;
  /** Dados da reserva da conversa (vêm da lista): período, estadia, código, fase. */
  stay?: StayView | null;
  /** Proprietário do imóvel (mesma fonte da lista). */
  owner?: { name: string | null; phone: string | null; phoneCountry: string | null } | null;
  /** Visão: o layout de cada uma é individual. */
  layout?: "desktop" | "mobile";
  /** Celular: "‹ Voltar" na linha do título. */
  onBack?: () => void;
};

/**
 * Tiques de entrega (só nas MINHAS mensagens): ✓ enviada · ✓✓ entregue · ✓✓ azul lida · ! falhou.
 * Sem recibo (chat do guia), nada é desenhado.
 */
function DeliveryTicks({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  if (status === "failed")
    return (
      <span className="inline-flex items-center" title="Não entregue" style={{ color: "#c98c8c" }}>
        <CircleAlert className="size-3" />
      </span>
    );
  if (status === "sent")
    return (
      <span className="inline-flex items-center" title="Enviada">
        <Check className="size-3" />
      </span>
    );
  if (status === "delivered" || status === "read")
    return (
      <span className={`inline-flex items-center ${status === "read" ? "text-sky-600" : ""}`} title={status === "read" ? "Lida" : "Entregue"}>
        <CheckCheck className="size-3" />
      </span>
    );
  return null;
}

/** Rótulo do dia na conversa ("HOJE", "20 DE NOVEMBRO"): palavra relativa quando couber. */
function dayLabel(iso: string): string {
  const day = iso.slice(0, 10);
  const word = relativeDayWord(day);
  if (word) return word;
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? "d 'de' MMMM" : "d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-l from-[color-mix(in_oklab,var(--foreground)_14%,transparent)] to-transparent" />
      <span className="ds-eyebrow ds-faint shrink-0 text-[10px] tracking-[0.18em]">{text}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-[color-mix(in_oklab,var(--foreground)_14%,transparent)] to-transparent" />
    </div>
  );
}

/** Faixa de ponta a ponta (Motivo, Nota interna, Pausa da IA). */
function Strip({ tone, px, children, action }: { tone: "motive" | "note" | "pause"; px: string; children: ReactNode; action?: ReactNode }) {
  const bg =
    tone === "motive"
      ? "bg-fuchsia-50 dark:bg-fuchsia-400/[0.08]"
      : tone === "note"
        ? "bg-[#c9a962]/15"
        : "bg-amber-100/65 dark:bg-amber-400/[0.11]";
  return (
    <div className="shrink-0">
      <div className={`flex items-center gap-2.5 py-1.5 text-[12px] ${px} ${bg}`}>
        {children}
        {action}
      </div>
    </div>
  );
}

const STRIP_BTN: Record<"motive" | "note" | "pause", string> = {
  motive:
    "inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] bg-fuchsia-100 px-2.5 text-[11.5px] font-bold text-[#7a2f86] dark:bg-fuchsia-400/20 dark:text-fuchsia-200",
  note: "inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] bg-[#c9a962]/25 px-2.5 text-[11.5px] font-bold text-[#6b5214] dark:text-[#e3cf9a]",
  pause:
    "inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] bg-amber-200/45 px-2.5 text-[11.5px] font-bold text-amber-900/85 disabled:opacity-50 dark:bg-amber-400/20 dark:text-amber-200",
};

const BUBBLE_BG = "bg-[color-mix(in_oklab,var(--secondary)_40%,var(--card))] text-foreground";

/** Barra do sistema (celular): menu, marca e tema — a mesma do topo das telas cheias. */
function SystemBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-background px-3">
      <button type="button" aria-label="Abrir menu" onClick={onMenu} className="grid size-11 place-items-center rounded-xl text-foreground transition-colors hover:bg-secondary/60">
        <Menu className="size-5" />
      </button>
      <span className="inline-flex items-center gap-2.5">
        <img src={conciergeLogo} alt="" className="size-9 shrink-0 rounded-lg object-contain" />
        <span className="font-display text-[18px] font-bold leading-none tracking-[-0.01em]">ConciergeIA</span>
      </span>
      <ThemeToggle />
    </div>
  );
}

const VOLTAR =
  "inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-0.5 rounded-[8px] bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)] pl-1.5 pr-2.5 text-[12px] font-bold text-foreground/80 transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_16%,transparent)] hover:text-foreground";

export function ConversationView({ conversationId, compact, myUserId, stay, owner, layout = "desktop", onBack }: Props) {
  const mobile = layout === "mobile";
  const px = mobile ? "px-[14px]" : "px-4";
  const stripPx = mobile ? "pl-3.5 pr-3" : "px-4";
  // selo "IA aprendeu" nas mensagens da equipe que ensinaram um fato do imóvel (10/11/2026)
  const learnedByMessage = useConversationLearnings(conversationId);
  const decisions = useConversationDecisions(conversationId);
  const { can, isOwner } = useMyPermissions();
  const canChat = isOwner || can("chat_respond");
  const getFn = useServerFn(getHandoffConversation);
  const sendFn = useServerFn(sendHandoffMessage);
  const claimFn = useServerFn(claimHandoffConversation);
  const releaseFn = useServerFn(releaseHandoffConversation);
  const resolveFn = useServerFn(resolveHandoffConversation);
  const requestFn = useServerFn(requestHandoffClaim);
  const cancelReqFn = useServerFn(cancelHandoffClaimRequest);
  const transferFn = useServerFn(transferHandoffConversation);
  const targetsFn = useServerFn(listConversationTransferTargets);
  const attachFn = useServerFn(attachStaffMessage);
  const regionalFn = useServerFn(getConversationRegional);
  const closeRegionalFn = useServerFn(closeRegionalSituation);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["handoff-conv", conversationId],
    queryFn: () => getFn({ data: { conversationId } }),
    // Todos os membros acompanham em tempo real, mesmo sem assumir a conversa.
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });
  const regional = useQuery({
    queryKey: ["conv-regional", conversationId],
    queryFn: () => regionalFn({ data: { conversationId } }),
    refetchInterval: 15_000,
    retry: false,
  });

  const tagItemsFn = useServerFn(getTagItemsForConversation);
  const { data: tagItemsData } = useQuery({
    queryKey: ["tag-items", "conv", conversationId],
    queryFn: () => tagItemsFn({ data: { conversationId } }),
    staleTime: 60_000,
  });
  const tagItems = useMemo<TagMentionItem[]>(
    () => (tagItemsData?.items ?? []).map((i) => ({ key: i.key, param: i.param, label: i.label, hint: i.hint, kind: i.kind })),
    [tagItemsData],
  );

  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSearch, setTransferSearch] = useState("");
  const [channel, setChannel] = useState<"chat" | "whatsapp">("chat");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [instructOpen, setInstructOpen] = useState(false);
  const [regionalWin, setRegionalWin] = useState<null | { mode: "new" | "edit" }>(null);
  // opção da decisão clicada agora (bloqueia o campo antes mesmo do banco confirmar)
  const [pickedOption, setPickedOption] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<ActionMsg | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLongPress = (m: ActionMsg) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => setActionMsg(m), 450);
  };
  const cancelLongPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const editFn = useServerFn(editHandoffMessage);
  const deleteFn = useServerFn(deleteHandoffMessage);
  const reopenFn = useServerFn(reopenHandoffConversation);
  const sendWaFn = useServerFn(sendWhatsappFromConversation);
  // WhatsApp em STANDBY (10/11/2026): sem integração ativa até a Cloud API oficial da Meta.
  const waIntegrated = false;

  // Tradução de mensagens do hóspede para o idioma do sistema do atendente.
  const myLang = useMemo(() => userLanguage(), []);
  const translateFn = useServerFn(translateMessage);
  const [translations, setTranslations] = useState<Record<string, { text: string | null; loading: boolean; showing: boolean }>>({});
  const toggleTranslation = async (id: string, content: string) => {
    const current = translations[id];
    if (current?.text) {
      setTranslations((p) => ({ ...p, [id]: { ...current, showing: !current.showing } }));
      return;
    }
    setTranslations((p) => ({ ...p, [id]: { text: null, loading: true, showing: false } }));
    try {
      const r = await translateFn({ data: { text: content.slice(0, 2000), targetLang: myLang } });
      setTranslations((p) => ({ ...p, [id]: { text: r.translated, loading: false, showing: true } }));
    } catch (e) {
      setTranslations((p) => ({ ...p, [id]: { text: null, loading: false, showing: false } }));
      setErrorMsg(friendlyErrorMessage(e, "Não consegui traduzir agora."));
    }
  };

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // TECLADO (celular, 26/11/2026): o quadrante da reserva recua ao abrir e volta ao fechar; tocar alterna.
  const vv = useVisualViewport();
  const [composerFocused, setComposerFocused] = useState(false);
  const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  const keyboardOpen = mobile && (vv.keyboardOpen || (coarse && composerFocused));
  const [stayOverride, setStayOverride] = useState<boolean | null>(null);
  useEffect(() => setStayOverride(null), [keyboardOpen]);
  const stayCollapsed = stayOverride ?? keyboardOpen;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [q.data?.messages?.length, decisions.list.length, keyboardOpen]);

  useEffect(() => {
    // Nome único por montagem evita "cannot add postgres_changes callbacks after subscribe()".
    const channelName = `conv-${conversationId}-${Math.random().toString(36).slice(2)}`;
    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "property_chat_messages", filter: `conversation_id=eq.${conversationId}` }, () => {
        qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "property_chat_conversations", filter: `id=eq.${conversationId}` }, () => {
        qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
        // o vínculo com a reserva pode ter mudado: o cabeçalho se atualiza na hora
        qc.invalidateQueries({ queryKey: ["handoff-stay", conversationId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_ai_human_decisions", filter: `conversation_id=eq.${conversationId}` }, () => {
        qc.invalidateQueries({ queryKey: ["conv-decisions", conversationId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, qc]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
    qc.invalidateQueries({ queryKey: ["handoff-list"] });
    qc.invalidateQueries({ queryKey: ["handoff-queue-counts"] });
    qc.invalidateQueries({ queryKey: ["handoff-pending-count"] });
  };

  const send = useMutation({
    mutationFn: async () => {
      if (channel === "whatsapp" && !note) {
        // standby: nada é enviado; avisa em vez de falhar em silêncio
        const r = await sendWaFn({ data: { conversationId, text: text.trim() } });
        if (!r.ok) throw new Error(WHATSAPP_STANDBY_MESSAGE);
        return r;
      }
      return sendFn({ data: { conversationId, content: text.trim(), internalNote: note } });
    },
    onSuccess: () => {
      setText("");
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["conv-decisions", conversationId] });
      qc.invalidateQueries({ queryKey: ["conv-regional", conversationId] });
    },
    onError: (e) => setErrorMsg((e as Error).message),
  });
  const reopen = useMutation({
    mutationFn: async (ch: "chat" | "whatsapp") => {
      await reopenFn({ data: { conversationId } });
      return ch;
    },
    onSuccess: (ch) => {
      setChannel(ch);
      setReopenOpen(false);
      invalidateAll();
    },
    onError: (e) => setErrorMsg((e as Error).message),
  });
  const claim = useMutation({
    mutationFn: async () => claimFn({ data: { conversationId } }),
    onSuccess: invalidateAll,
    onError: (e) => setErrorMsg((e as Error).message),
  });
  const requestClaim = useMutation({
    mutationFn: async () => requestFn({ data: { conversationId } }),
    onSuccess: invalidateAll,
    onError: (e) => setErrorMsg((e as Error).message),
  });
  const cancelRequest = useMutation({
    mutationFn: async () => cancelReqFn({ data: { conversationId } }),
    onSuccess: invalidateAll,
  });
  const release = useMutation({
    mutationFn: async () => releaseFn({ data: { conversationId } }),
    onSuccess: invalidateAll,
  });
  const resolve = useMutation({
    mutationFn: async () => resolveFn({ data: { conversationId } }),
    onSuccess: invalidateAll,
  });
  const transfer = useMutation({
    mutationFn: async (toUserId: string) => transferFn({ data: { conversationId, toUserId } }),
    onSuccess: () => {
      setTransferOpen(false);
      invalidateAll();
    },
    onError: (e) => setErrorMsg((e as Error).message),
  });
  const editMsg = useMutation({
    mutationFn: async (v: { messageId: string; content: string }) => editFn({ data: { conversationId, messageId: v.messageId, content: v.content } }),
    onSuccess: () => {
      setEditingId(null);
      setEditingText("");
      invalidateAll();
    },
    onError: (e) => setErrorMsg((e as Error).message),
  });
  const deleteMsg = useMutation({
    mutationFn: async (messageId: string) => deleteFn({ data: { conversationId, messageId } }),
    onSuccess: invalidateAll,
    onError: (e) => setErrorMsg((e as Error).message),
  });
  const dismissRegional = useMutation({
    mutationFn: async (id: string) => closeRegionalFn({ data: { id, action: "dismiss" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conv-regional", conversationId] }),
    onError: (e) => setErrorMsg((e as Error).message),
  });

  function inferAttachmentType(mime: string): "image" | "audio" | "video" | "document" | null {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    if (mime === "application/pdf") return "document";
    return null;
  }

  async function uploadAndAttach(file: Blob, opts: { name?: string; mime?: string; durationMs?: number }) {
    if (!conv?.property_id) return;
    const MAX = 20 * 1024 * 1024;
    if (file.size > MAX) {
      setErrorMsg("Arquivo maior que 20 MB.");
      return;
    }
    const mime = opts.mime ?? (file as File).type ?? "application/octet-stream";
    const type = inferAttachmentType(mime);
    if (!type) {
      setErrorMsg("Tipo de arquivo não suportado.");
      return;
    }
    setUploading(true);
    try {
      const ext =
        type === "image"
          ? (mime.split("/")[1] ?? "jpg").replace("jpeg", "jpg")
          : type === "audio"
            ? mime.includes("mp4")
              ? "m4a"
              : mime.includes("mpeg")
                ? "mp3"
                : "webm"
            : type === "video"
              ? (mime.split("/")[1] ?? "mp4")
              : "pdf";
      const objectId = crypto.randomUUID();
      const path = `${conv.property_id}/${conversationId}/staff-${objectId}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, file, { contentType: mime, upsert: false });
      if (upErr) throw new Error(upErr.message);
      await attachFn({
        data: {
          conversationId,
          path,
          attachmentType: type,
          mime,
          sizeBytes: file.size,
          durationMs: opts.durationMs ?? null,
          name: opts.name ?? null,
          caption: null,
          internalNote: note,
        },
      });
      invalidateAll();
    } catch (e) {
      setErrorMsg((e as Error).message || "Falha ao enviar anexo.");
    } finally {
      setUploading(false);
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    await uploadAndAttach(f, { name: f.name, mime: f.type });
  }

  async function onAudioRecorded(audio: RecordedAudio) {
    const filename = `audio-${Date.now()}.${audio.mime.includes("mp4") ? "m4a" : "webm"}`;
    await uploadAndAttach(audio.blob, { name: filename, mime: audio.mime, durationMs: audio.durationMs });
  }

  const targetsQ = useQuery({
    queryKey: ["handoff-transfer-targets", conversationId],
    queryFn: () => targetsFn({ data: { conversationId } }),
    enabled: transferOpen,
    staleTime: 30_000,
  });

  const conv = q.data?.conversation;
  const actionAllowed = actionMsg
    ? messageActions({ channel: actionMsg.channel, sessionId: conv?.guest_session_id ?? null, isNote: actionMsg.isNote, isGuest: actionMsg.isGuest })
    : NO_MESSAGE_ACTIONS;
  const allMsgs = q.data?.messages ?? [];
  // NOTA INTERNA (25/11/2026): não vira balão — fica na faixa do rodapé (a mais recente) e na janela Notas Internas.
  const msgs = allMsgs.filter((m) => !m.is_internal_note);
  const notes = allMsgs.filter((m) => m.is_internal_note);
  const guestNameByConversation =
    (q.data as { guestNameByConversation?: Record<string, string> } | undefined)?.guestNameByConversation ?? {};
  const guest = q.data?.guestDetails;
  const claimReq = q.data?.claimRequester;
  const assignedProfile = q.data?.assignedProfile;
  const senderProfiles =
    (q.data as { senderProfiles?: Record<string, { displayName: string | null }> } | undefined)?.senderProfiles ?? {};
  const propertyName = (conv?.properties as { name?: string } | null)?.name ?? "Guia";
  const propertyOwnerName = (q.data as { propertyOwnerName?: string | null } | undefined)?.propertyOwnerName ?? null;
  const ownerName = (owner?.name ?? propertyOwnerName)?.trim() || null;

  const isMine = !!(conv?.assigned_to && myUserId && conv.assigned_to === myUserId);
  const pausaMinutos = minutesLeft(conv);
  const isLockedByOther = !!(conv?.assigned_to && myUserId && conv.assigned_to !== myUserId);
  const isUnassigned = !conv?.assigned_to;
  /* ANFITRIÃO NO COMANDO (Airbnb): ele respondeu direto no app ⇒ IA pausada e conversa em "Humano" sem
   * responsável. O campo fica liberado (o envio atribui a conversa a quem responde). */
  const hostInCommand = !isLockedByOther && isUnassigned && isPausedNow(conv);
  const canCompose = isMine || hostInCommand;
  const iRequested = !!(conv?.claim_requested_by && myUserId && conv.claim_requested_by === myUserId);
  const someoneRequestedFromMe = !!(isMine && conv?.claim_requested_by && conv.claim_requested_by !== myUserId);
  const status = conv?.status;
  const guestName = guest?.name ?? conv?.guest_name ?? "Hóspede anônimo";
  const session = String(conv?.guest_session_id ?? "");

  // reserva do cabeçalho (vem da lista; sem ela, monta com os detalhes da própria conversa)
  const stayView: StayView | null = stay ?? (guest ? buildStayView({ detail: guest as never, res: null }) : null);

  // DECISÃO: enviando ⇒ campo bloqueado até a IA entregar a resposta
  const sendingDecision = !!pickedOption || decisions.list.some(decisionSending);
  const reason = conv?.handoff_reason ?? null;
  const showMotive = !!reason && status !== "resolved" && status !== "ai" && !isDecisionHandoffReason(reason);
  const reg = regional.data;

  function handleClaim() {
    if (isLockedByOther) {
      const who = assignedProfile?.displayName ?? "outro membro";
      const ok = typeof window !== "undefined" && window.confirm(`Esta conversa está sendo atendida por ${who}. Tem certeza que deseja assumir?`);
      if (!ok) return;
    }
    claim.mutate();
  }

  // ── Ações do cabeçalho (nota interna + menu ⋮, sem rótulo de título) ──
  const showNoteBtn = canChat && (isMine || hostInCommand) && status !== "resolved";
  const actionItems: ReactNode[] = [];
  if (status === "resolved" && canChat)
    actionItems.push(
      <DropdownMenuItem key="reopen" onSelect={() => setReopenOpen(true)}>
        <RotateCcw /> Reabrir Conversa
      </DropdownMenuItem>,
    );
  if ((isUnassigned || isLockedByOther) && status !== "resolved")
    actionItems.push(
      <DropdownMenuItem key="claim" onSelect={() => handleClaim()}>
        <UserCheck /> Assumir
      </DropdownMenuItem>,
    );
  if (isLockedByOther && !iRequested && status !== "resolved")
    actionItems.push(
      <DropdownMenuItem key="req" onSelect={() => requestClaim.mutate()}>
        <UserPlus2 /> Solicitar Acesso
      </DropdownMenuItem>,
    );
  if (isLockedByOther && iRequested)
    actionItems.push(
      <DropdownMenuItem key="cancel" onSelect={() => cancelRequest.mutate()}>
        <X /> Cancelar Solicitação
      </DropdownMenuItem>,
    );
  if (isMine && status !== "resolved") {
    actionItems.push(
      <DropdownMenuItem key="transfer" onSelect={() => setTransferOpen(true)}>
        <ArrowRightLeft /> Transferir
      </DropdownMenuItem>,
      <DropdownMenuItem key="release" onSelect={() => release.mutate()}>
        <RotateCcw /> Devolver à IA
      </DropdownMenuItem>,
    );
  }
  if (status !== "resolved" && (isMine || !conv?.assigned_to)) {
    if (actionItems.length) actionItems.push(<DropdownMenuSeparator key="sep" />);
    actionItems.push(
      <DropdownMenuItem key="resolve" onSelect={() => resolve.mutate()}>
        <CircleCheck /> Resolver
      </DropdownMenuItem>,
    );
  }

  const headerActions = (
    <div className="flex shrink-0 items-center gap-1.5">
      {showNoteBtn ? (
        <button
          type="button"
          onClick={() => setNote((v) => !v)}
          aria-label="Nota interna"
          aria-pressed={note}
          title="Nota interna"
          className={`grid size-7 place-items-center rounded-[7px] transition-colors ${note ? "bg-[#c9a962]/20 text-[#8a6a1a]" : "text-muted-foreground hover:bg-foreground/[0.06]"}`}
        >
          <StickyNote className="size-[14px]" />
        </button>
      ) : null}
      {actionItems.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Ações da conversa" title="Ações da conversa" className="grid size-7 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-foreground/[0.06]">
              <EllipsisVertical className="size-[14px]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="!border-0 z-[2147483600] w-[208px]">
            {actionItems}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  // ── Cabeçalho ──
  const desktopHeader = (
    <div className={`shrink-0 ${px} pt-3.5 pb-3 border-b border-[color-mix(in_oklab,var(--foreground)_7%,transparent)]`}>
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="min-w-0 flex-1 truncate font-display text-[17px] font-bold leading-tight text-foreground" title={propertyName}>
              {propertyName}
            </h2>
            {headerActions}
          </div>
          {ownerName ? <p className="mt-1 truncate text-[12.5px] font-semibold text-foreground/80">{ownerName}</p> : null}
        </div>
        {stayView ? (
          <div className="ds-well flex min-w-0 items-center gap-6 py-2.5 px-3.5 text-[12.5px] font-medium tabular-nums">
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
              <StayGuestIcon />
              <span>{guestName}</span>
            </span>
            {stayView.checkin ? (
              <span className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap ${stayToneText(stayView)}`}>
                <StayPeriodLine stay={stayView} size="text-[12.5px]" />
              </span>
            ) : null}
            <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
              <StayNightsLine stay={stayView} size="text-[12.5px]" />
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );

  const mobileStay = stayView ? (
    stayCollapsed ? (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={false}
        aria-label="Mostrar todas as informações da reserva"
        onClick={() => setStayOverride(false)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setStayOverride(false)}
        className="ds-well flex min-w-0 cursor-pointer items-center gap-2 py-1.5 pl-3 pr-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 whitespace-nowrap text-[12px] font-medium">
          <StayGuestLine name={guestName} />
          {stayView.checkin ? (
            <div className="shrink-0">
              <StayPeriodLine stay={stayView} />
            </div>
          ) : null}
        </div>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {headerActions}
        </div>
      </div>
    ) : (
      <div
        role="button"
        tabIndex={0}
        aria-expanded
        aria-label="Recolher as informações da reserva"
        onClick={() => setStayOverride(true)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setStayOverride(true)}
        className="ds-well flex min-w-0 cursor-pointer items-start gap-2 py-2.5 pl-3 pr-2"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <StayGuestLine name={guestName} />
          <StayPeriodLine stay={stayView} />
          <StayNightsLine stay={stayView} />
        </div>
        <div className="-my-[5px] shrink-0" onClick={(e) => e.stopPropagation()}>
          {headerActions}
        </div>
      </div>
    )
  ) : (
    <div className="ds-well flex min-w-0 items-center gap-2 py-2.5 pl-3 pr-2">
      <div className="min-w-0 flex-1">
        <StayGuestLine name={guestName} />
      </div>
      {headerActions}
    </div>
  );

  const mobileHeader = (
    <>
      <SystemBar
        onMenu={() => {
          onBack?.();
          window.setTimeout(() => window.dispatchEvent(new Event(ABRIR_MENU_EVENT)), 0);
        }}
      />
      <div className="relative shrink-0 border-b border-[color-mix(in_oklab,var(--foreground)_7%,transparent)] bg-background px-[14px] pt-3.5 pb-3">
        <div className="flex flex-col gap-2">
          <div className="ds-card-lines min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="ds-card-title min-w-0 flex-1 truncate leading-tight" title={propertyName}>
                {propertyName}
              </span>
              {onBack ? (
                <button type="button" onClick={onBack} className={VOLTAR}>
                  <ChevronLeft className="size-[15px]" strokeWidth={2.4} />
                  Voltar
                </button>
              ) : null}
            </div>
            {ownerName ? (
              <div className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden text-xs">
                <span className="min-w-0 truncate font-semibold text-foreground">{ownerName}</span>
              </div>
            ) : null}
          </div>
          {mobileStay}
        </div>
      </div>
    </>
  );

  const extraBanners = (
    <>
      {isLockedByOther ? (
        <Strip tone="note" px={stripPx}>
          <Lock className="size-3 shrink-0 text-[#6b5214] dark:text-[#e3cf9a]" />
          <span className="min-w-0 flex-1 truncate text-[#6b5214] dark:text-[#e3cf9a]">
            Em atendimento por <strong className="font-bold">{assignedProfile?.displayName ?? "outro membro"}</strong>
          </span>
        </Strip>
      ) : null}
      {someoneRequestedFromMe ? (
        <Strip
          tone="note"
          px={stripPx}
          action={
            <button type="button" className={STRIP_BTN.note} onClick={() => claimReq?.userId && transfer.mutate(claimReq.userId)}>
              Transferir
            </button>
          }
        >
          <span className="min-w-0 flex-1 truncate text-[#6b5214] dark:text-[#e3cf9a]">
            <strong className="font-bold">{claimReq?.displayName ?? "Um membro"}</strong> pediu acesso à conversa
          </span>
        </Strip>
      ) : null}
      {channel === "whatsapp" ? (
        <Strip
          tone="note"
          px={stripPx}
          action={
            <button type="button" className={STRIP_BTN.note} onClick={() => setChannel("chat")}>
              Usar Chat
            </button>
          }
        >
          <span className="min-w-0 flex-1 truncate text-[#6b5214] dark:text-[#e3cf9a]">Enviando pelo WhatsApp do hóspede</span>
        </Strip>
      ) : null}
      {errorMsg ? (
        <Strip
          tone="motive"
          px={stripPx}
          action={
            <button type="button" aria-label="Fechar aviso" className={STRIP_BTN.motive} onClick={() => setErrorMsg(null)}>
              <X className="size-3.5" />
            </button>
          }
        >
          <span className="min-w-0 flex-1 text-[#6f2f78] dark:text-fuchsia-200">{errorMsg}</span>
        </Strip>
      ) : null}
    </>
  );

  // ── Mensagens ──
  let lastDay = "";
  const lastHumanId = [...msgs].reverse().find((m) => m.sender_type === "human")?.id ?? null;
  const suggestionAfter = reg?.suggestion ? (reg.suggestion.messageId && msgs.some((m) => m.id === reg.suggestion!.messageId) ? reg.suggestion.messageId : lastHumanId) : null;

  const body = (
    <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${mobile ? "px-[14px] pt-[10px] pb-2" : `${px} py-3`} flex flex-col gap-2.5`}>
      <div className="mt-auto" />
      {q.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" /> Carregando…
        </div>
      ) : null}
      {msgs.map((m) => {
        const isGuest = m.sender_type === "guest";
        const day = String(m.created_at).slice(0, 10);
        const label = day !== lastDay ? dayLabel(String(m.created_at)) : null;
        lastDay = day;
        const detected = isGuest && m.content ? detectLanguage(m.content) : null;
        const canTranslate = Boolean(detected && detected !== myLang);
        const tr = translations[m.id];
        const failed = !isGuest && m.delivery_status === "failed";
        const airbnb = channelOf((m as { channel?: string | null }).channel ?? null, session) === "airbnb";
        const attachment: AttachmentInfo | null = m.attachment_path
          ? {
              type: m.attachment_type as AttachmentInfo["type"],
              mime: m.attachment_mime,
              durationMs: m.attachment_duration_ms,
              sizeBytes: m.attachment_size_bytes,
              name: m.attachment_name,
              path: m.attachment_path,
              transcript: m.attachment_transcript ?? null,
            }
          : null;
        const decision = decisions.byMessage.get(m.id);
        const labelEl = isGuest ? (
          <div className="mb-1 text-[11px] font-bold">
            {guestNameByConversation[(m as { conversation_id?: string }).conversation_id ?? ""] || guestName}
          </div>
        ) : m.sender_type === "human" ? (
          <div className="mb-1 text-[11px] font-bold">{(m.sender_user_id && senderProfiles[m.sender_user_id]?.displayName) || "Atendente"}</div>
        ) : m.sender_type === "system" ? (
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Mensagem Automática</div>
        ) : (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-accent">
            <Sparkles className="size-3" />
            IA
          </div>
        );
        return (
          <Fragment key={m.id}>
            {label ? <SectionLabel text={label} /> : null}
            <div className={`flex flex-col ${isGuest ? "items-start" : "items-end"} gap-1`}>
              <div
                onPointerDown={() => startLongPress(toActionMsg(m))}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActionMsg(toActionMsg(m));
                }}
                className={`max-w-[85%] select-none whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                  m.sender_type === "system" ? "bg-foreground/[0.05] text-foreground" : BUBBLE_BG
                } ${failed ? "opacity-55" : ""}`}
              >
                {labelEl}
                {attachment ? (
                  <div className="mb-1">
                    <AttachmentBubble attachment={attachment} />
                  </div>
                ) : null}
                {editingId === m.id ? (
                  <div className="space-y-1">
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={3}
                      className="w-full min-w-[220px] rounded-lg border-0 bg-background p-2 text-sm text-foreground"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="text-[11px] opacity-70 hover:opacity-100"
                        onClick={() => {
                          setEditingId(null);
                          setEditingText("");
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={editMsg.isPending || !editingText.trim()}
                        className="rounded-[7px] bg-foreground px-2 py-1 text-[11px] text-background disabled:opacity-50"
                        onClick={() => editMsg.mutate({ messageId: m.id, content: editingText })}
                      >
                        {editMsg.isPending ? "Salvando…" : "Salvar"}
                      </button>
                    </div>
                  </div>
                ) : (
                  m.content && (
                    <div className="leading-[1.45]">
                      <MessageText text={tr?.showing && tr.text ? tr.text : m.content} />
                    </div>
                  )
                )}
                {tr?.showing && tr.text ? (
                  <div className="mt-1 flex items-center gap-1 text-[10px] opacity-60">
                    <Languages className="size-3" /> Traduzido automaticamente
                  </div>
                ) : null}
                <div className="mt-1 flex items-center gap-1 text-[10px] opacity-60">
                  <span>
                    {format(new Date(m.created_at), "HH:mm")}
                    {m.edited_at ? " · editada" : ""}
                  </span>
                  {!isGuest ? <DeliveryTicks status={m.delivery_status} /> : null}
                </div>
              </div>
              {failed ? (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center rounded-[5px] bg-[#c98c8c]/16 px-2 py-[3px] text-[10.5px] font-bold text-[#a35d5d]">
                    {airbnb ? "Cancelada Pelo Airbnb · Não Entregue" : "Não Entregue"}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">
                    {format(new Date(m.created_at), "dd/MM · HH:mm")}
                  </span>
                </div>
              ) : null}
              {m.sender_type === "human" && learnedByMessage.get(m.id) ? (
                <LearnedBadge learning={learnedByMessage.get(m.id)!} conversationId={conversationId} />
              ) : null}
              {canTranslate ? (
                <button
                  type="button"
                  onClick={() => toggleTranslation(m.id, m.content ?? "")}
                  disabled={tr?.loading}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-60"
                  title={`Mensagem em ${LANG_NAMES[detected as string] ?? detected}`}
                >
                  {tr?.loading ? <LoaderCircle className="size-3 animate-spin" /> : <Languages className="size-3" />}
                  {tr?.showing ? "Ver Original" : "Traduzir"}
                </button>
              ) : null}
              {suggestionAfter === m.id && reg?.suggestion ? (
                <RegionalSuggestion
                  city={reg.city ?? ""}
                  onMark={() => setRegionalWin({ mode: "new" })}
                  onDismiss={() => dismissRegional.mutate(reg.suggestion!.id)}
                  busy={dismissRegional.isPending}
                />
              ) : null}
            </div>
            {failed ? (
              <p className="max-w-[92%] self-center rounded-[10px] bg-foreground/[0.05] px-2.5 py-1.5 text-center text-[11.5px] text-muted-foreground">
                A IA também sabe que esta mensagem não chegou ao hóspede e não a trata como dita.
              </p>
            ) : null}
            {decision ? (
              decision.status === "pending" || decisionSending(decision) ? (
                <DecisionStrip
                  decision={decision}
                  conversationId={conversationId}
                  compact={mobile}
                  pendingOptionId={pickedOption}
                  onPick={setPickedOption}
                />
              ) : (
                <DecisionRecord decision={decision} />
              )
            ) : null}
          </Fragment>
        );
      })}
      {/* decisão cuja mensagem de origem não está na lista carregada: no fim, para nunca sumir */}
      {decisions.list
        .filter((d) => !msgs.some((m) => m.id === d.trigger_message_id))
        .map((d) =>
          d.status === "pending" || decisionSending(d) ? (
            <DecisionStrip key={d.id} decision={d} conversationId={conversationId} compact={mobile} pendingOptionId={pickedOption} onPick={setPickedOption} />
          ) : (
            <DecisionRecord key={d.id} decision={d} />
          ),
        )}
    </div>
  );

  // ── Rodapé ──
  const latestNote = notes.length ? notes[notes.length - 1] : null;
  const noteStrip = latestNote ? (
    <Strip
      tone="note"
      px={stripPx}
      action={
        <button type="button" className={STRIP_BTN.note} onClick={() => setNotesOpen(true)}>
          {notes.length > 1 ? `Ver (${notes.length})` : "Ver"}
        </button>
      }
    >
      <span className="min-w-0 flex-1 truncate text-[#6b5214] dark:text-[#e3cf9a]">
        <strong className="font-bold">Nota interna:</strong> {latestNote.content}
      </span>
    </Strip>
  ) : null;

  const pauseStrip =
    pausaMinutos !== null ? (
      <Strip
        tone="pause"
        px="pl-3.5 pr-3"
        action={
          <button type="button" onClick={() => release.mutate()} disabled={release.isPending} className={STRIP_BTN.pause}>
            <Sparkles className="size-3" />
            Devolver Agora
          </button>
        }
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-amber-200/45 text-amber-700/85 dark:bg-amber-400/15 dark:text-amber-300/80">
          <Pause className="size-3" strokeWidth={2.6} />
        </span>
        <span className="min-w-0 flex-1 truncate text-amber-900/75 dark:text-amber-200/80">
          A IA volta em <strong className="font-bold tabular-nums">{pausaMinutos} min</strong>
        </span>
      </Strip>
    ) : null;

  const lockedFooter = (msg: ReactNode, withClaim: boolean) => (
    <div className="shrink-0 px-3 py-2.5" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}>
      <div className="flex items-center justify-center gap-2 rounded-[10px] bg-foreground/[0.05] px-3 py-2 text-center text-[12px] text-muted-foreground">
        <Lock className="size-3 shrink-0" />
        <span className={mobile ? "flex-1" : ""}>{msg}</span>
        {withClaim ? (
          <button
            type="button"
            onClick={handleClaim}
            disabled={claim.isPending}
            className="ml-1 inline-flex h-7 items-center gap-1 rounded-[7px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-2.5 text-[11.5px] font-bold text-white disabled:opacity-50"
          >
            <UserCheck className="size-3" />
            Assumir
          </button>
        ) : null}
      </div>
    </div>
  );

  let footer: ReactNode = null;
  if (status !== "resolved" && !canChat) {
    footer = lockedFooter("Você não tem permissão para responder no chat. Peça ao dono da conta para habilitar em Administrativo → Permissões.", false);
  } else if (status !== "resolved" && canChat && !canCompose) {
    footer = lockedFooter(
      isLockedByOther ? (
        <>
          Somente <strong>{assignedProfile?.displayName ?? "o atendente responsável"}</strong> pode responder — você acompanha em tempo real.
        </>
      ) : mobile ? (
        "Assuma para responder."
      ) : (
        "Assuma a conversa para poder responder ao hóspede."
      ),
      true,
    );
  } else if (status !== "resolved" && canChat && canCompose) {
    const empty = !text.trim();
    footer = (
      <>
        {noteStrip}
        {pauseStrip}
        <form
          aria-disabled={sendingDecision || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || send.isPending || sendingDecision) return;
            send.mutate();
          }}
          className={`shrink-0 px-3 pt-2 pb-2 ${sendingDecision ? "pointer-events-none" : ""}`}
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {uploading ? (
            <div className="flex w-full items-center justify-center gap-1 pb-2 text-[10px] font-semibold text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" /> Enviando anexo…
            </div>
          ) : null}
          {note && !sendingDecision ? (
            <div className="-mt-0.5 flex w-full items-center justify-center gap-1 pb-2 text-[10px] font-semibold text-[#8a6a1a]">
              <StickyNote className="size-3" />
              Nota interna (só a equipe vê)
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf,video/mp4,video/webm,video/quicktime" className="hidden" onChange={onFilePicked} />
            <input ref={cameraInputRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={onFilePicked} />
            <ComposerPlusMenu
              disabled={uploading || sendingDecision}
              onAttach={() => fileInputRef.current?.click()}
              onCamera={() => cameraInputRef.current?.click()}
              attachLabel="Anexar Arquivo"
              iconClassName="size-[18px]"
              menuClassName="w-[180px] !border-0"
              className={sendingDecision ? "!text-muted-foreground/40" : ""}
            />
            {sendingDecision ? (
              <div className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-2xl bg-foreground/[0.03] px-3 py-1.5">
                <span className="inline-flex shrink-0 animate-spin text-[#7C1AD8]">
                  <LoaderCircle className="size-3.5" />
                </span>
                <span className="block w-full truncate text-sm leading-[1.2rem] text-muted-foreground/80">A IA está enviando a resposta…</span>
              </div>
            ) : (
              <div className={`flex min-h-8 min-w-0 flex-1 items-end rounded-2xl px-3 py-1.5 ${note ? "bg-[#c9a962]/12" : "bg-foreground/[0.05]"}`}>
                <TagMentionTextarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    const el = e.target as HTMLTextAreaElement;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                  }}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (text.trim() && !sendingDecision) send.mutate();
                    }
                  }}
                  items={tagItems}
                  placeholder={note ? "Nota interna…" : "Mensagem…"}
                  rows={1}
                  containerClassName="flex-1 min-w-0"
                  className={`${COMPOSER_INPUT} !max-h-40 whitespace-pre-wrap break-words border-0 px-0 placeholder:text-muted-foreground`}
                />
              </div>
            )}
            <div className="shrink-0">
              {sendingDecision ? (
                <span className="grid size-8 place-items-center rounded-full text-muted-foreground/40">
                  <MicIcon />
                </span>
              ) : (
                <AudioRecorderButton disabled={uploading} maxSeconds={60} onRecorded={onAudioRecorded} compact />
              )}
            </div>
            <button
              type="submit"
              disabled={send.isPending || empty || sendingDecision}
              aria-label="Enviar mensagem"
              className={`grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white ${sendingDecision ? "opacity-25" : empty ? "opacity-40" : ""}`}
            >
              {send.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </form>
      </>
    );
  } else if (latestNote) {
    footer = noteStrip;
  }

  // ── Janelas ──
  const actionWhen = actionMsg ? format(new Date(actionMsg.createdAt), "HH:mm") : "";
  const actionSub = actionMsg
    ? `${actionMsg.isNote ? "Nota interna" : actionMsg.isGuest ? "Mensagem do hóspede" : actionMsg.senderType === "ai" ? "Mensagem da IA" : actionMsg.senderType === "system" ? "Mensagem automática" : "Sua mensagem"} · ${actionWhen}`
    : "";
  const filteredTargets = (targetsQ.data?.targets ?? []).filter((t) =>
    (t.displayName ?? "").toLowerCase().includes(transferSearch.trim().toLowerCase()),
  );
  const ROLE_LABEL: Record<string, string> = { owner: "Titular", admin: "Administrador", member: "Equipe" };
  const reopenChannels: Array<{ key: "chat" | "whatsapp"; icon: ReactNode; title: string; sub: string }> = [];
  if (session.startsWith("airbnb:"))
    reopenChannels.push({ key: "chat", icon: <AirbnbMark />, title: "Chat do Airbnb", sub: "Pela conversa da reserva no Airbnb" });
  else if (!session.startsWith("wa:") && !session.startsWith("whatsapp:"))
    reopenChannels.push({ key: "chat", icon: <MessageSquare className="size-[15px]" />, title: "Chat do Guia", sub: "Pelo guia digital do hóspede" });
  if (waIntegrated && guest?.phone)
    reopenChannels.push({
      key: "whatsapp",
      icon: <MessageCircle className="size-[15px]" />,
      title: "WhatsApp",
      sub: `${maskPhone(formatIntlPhone(guest.phone, guest.phoneCountry ?? undefined) ?? guest.phone)} do hóspede`,
    });

  const windows = (
    <>
      <AtdWindow open={!!actionMsg} onOpenChange={(v) => !v && setActionMsg(null)} title="Opções da Mensagem" subtitle={actionSub}>
        <WinRow
          icon={<Copy className="size-[15px]" />}
          title="Copiar"
          sub="Copia o texto da mensagem"
          last={!actionAllowed.edit && !actionAllowed.delete}
          onClick={() => {
            if (actionMsg) navigator.clipboard?.writeText(actionMsg.content);
            setActionMsg(null);
          }}
        />
        {actionAllowed.edit ? (
          <WinRow
            icon={<Pencil className="size-[15px]" />}
            title="Editar"
            sub="Corrige o texto já enviado"
            last={!actionAllowed.delete}
            onClick={() => {
              if (actionMsg) {
                if (actionMsg.isNote) setNotesOpen(false);
                setEditingId(actionMsg.id);
                setEditingText(actionMsg.content);
              }
              setActionMsg(null);
            }}
          />
        ) : null}
        {actionAllowed.delete ? (
          <WinRow
            icon={<Trash2 className="size-[15px]" />}
            title="Apagar"
            sub="Remove a mensagem da conversa"
            rose
            last
            onClick={() => {
              if (actionMsg) deleteMsg.mutate(actionMsg.id);
              setActionMsg(null);
            }}
          />
        ) : null}
      </AtdWindow>

      <AtdWindow open={reopenOpen} onOpenChange={setReopenOpen} title="Reabrir Conversa" subtitle="Por onde você quer falar com o hóspede?" width={300}>
        {reopenChannels.map((c, i) => (
          <WinRow key={c.key} icon={c.icon} title={c.title} sub={c.sub} last={i === reopenChannels.length - 1} disabled={reopen.isPending} onClick={() => reopen.mutate(c.key)} />
        ))}
      </AtdWindow>

      <AtdWindow
        open={transferOpen}
        onOpenChange={(v) => {
          setTransferOpen(v);
          if (!v) setTransferSearch("");
        }}
        onBack={() => {
          setTransferOpen(false);
          setTransferSearch("");
        }}
        title="Transferir Conversa"
        subtitle="Para quem da equipe?"
      >
        <WinSearch value={transferSearch} onChange={setTransferSearch} placeholder="Buscar pessoa da equipe…" />
        <div className="sg-elegant-scroll max-h-[262px] overflow-y-auto">
          {targetsQ.isLoading ? (
            <div className="flex items-center gap-1.5 px-4 py-3 text-xs text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" /> Carregando…
            </div>
          ) : filteredTargets.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-muted-foreground">Nenhuma outra pessoa da equipe disponível.</p>
          ) : (
            filteredTargets.map((t, i) => (
              <WinRow
                key={t.userId}
                icon={<UserIcon />}
                title={t.displayName ?? "Membro da equipe"}
                sub={ROLE_LABEL[String(t.role)] ?? String(t.role ?? "")}
                last={i === filteredTargets.length - 1}
                disabled={transfer.isPending}
                onClick={() => transfer.mutate(t.userId)}
              />
            ))
          )}
        </div>
      </AtdWindow>

      <AtdWindow open={notesOpen} onOpenChange={setNotesOpen} title="Notas Internas" subtitle="Só a equipe vê" width={380}>
        <div className="sg-elegant-scroll flex max-h-[60dvh] flex-col gap-2.5 overflow-y-auto px-4 pb-4 pt-3.5">
          {notes.map((n) => {
            const who = (n.sender_user_id && senderProfiles[n.sender_user_id]?.displayName) || "Equipe";
            return (
              <div
                key={n.id}
                className="ds-well px-3 py-2.5"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActionMsg(toActionMsg(n));
                }}
                onPointerDown={() => startLongPress(toActionMsg(n))}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground/80">{who}</span>
                  <span className="tabular-nums">
                    <RelDay iso={String(n.created_at).slice(0, 10)} toneClass="text-foreground/80" /> · {format(new Date(n.created_at), "HH:mm")}
                  </span>
                </div>
                {editingId === n.id ? (
                  <div className="space-y-1">
                    <textarea value={editingText} onChange={(e) => setEditingText(e.target.value)} rows={3} className="w-full rounded-lg border-0 bg-background p-2 text-[12.5px]" />
                    <div className="flex justify-end gap-2">
                      <button type="button" className="text-[11px] opacity-70" onClick={() => setEditingId(null)}>
                        Cancelar
                      </button>
                      <button type="button" className="rounded-[7px] bg-foreground px-2 py-1 text-[11px] text-background" onClick={() => editMsg.mutate({ messageId: n.id, content: editingText })}>
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="select-text whitespace-pre-wrap text-[12.5px] leading-[1.45]">{n.content}</div>
                )}
              </div>
            );
          })}
        </div>
      </AtdWindow>

      <AtdWindow open={reasonOpen} onOpenChange={setReasonOpen} title="Motivo do Encaminhamento" subtitle="Por que a IA chamou a equipe" width={320}>
        {reg?.active ? (
          <>
            <div className="flex items-center gap-2.5 px-4 pt-3.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#c9a962]/[0.18] text-[#8a6a1a]">
                <ZapOffIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold text-[#8a6a1a]">Situação Regional Ativa</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {regionalTitle(reg.active)} · {conversationsLabel(reg.affected.length)}
                </span>
              </span>
            </div>
            <div className="px-4 pt-3">
              <div className="ds-well select-text whitespace-pre-wrap px-3 py-2.5 text-[12.5px] leading-[1.45]">{reason}</div>
            </div>
          </>
        ) : (
          <div className="px-4 pt-3.5">
            <div className="ds-well select-text whitespace-pre-wrap px-3 py-2.5 text-[12.5px] leading-[1.45]">{reason}</div>
          </div>
        )}
        <div className="flex flex-col gap-2 px-4 pb-4 pt-3.5">
          {!isMine && status !== "resolved" ? (
            <button
              type="button"
              disabled={claim.isPending}
              onClick={() => {
                setReasonOpen(false);
                handleClaim();
              }}
              className={`${BTN_BRAND} w-full flex-none`}
            >
              <UserCheck className="size-3.5" />
              Assumir e Responder
            </button>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setReasonOpen(false);
                setInstructOpen(true);
              }}
              className={`${BTN_SOFT} !inline-flex items-center justify-center gap-1.5`}
            >
              <Sparkles className="size-3.5" />
              Instruir a IA
            </button>
            <button
              type="button"
              disabled={resolve.isPending}
              onClick={() => {
                resolve.mutate();
                setReasonOpen(false);
              }}
              className={BTN_SOFT}
            >
              Marcar Resolvida
            </button>
          </div>
        </div>
      </AtdWindow>

      {instructOpen && conv ? (
        <InstructAiWindow
          open={instructOpen}
          onOpenChange={setInstructOpen}
          onBack={() => {
            setInstructOpen(false);
            setReasonOpen(true);
          }}
          conversationId={conversationId}
          propertyId={String(conv.property_id)}
          propertyName={propertyName}
          regional={reg?.active ? { situation: reg.active, affected: reg.affected } : null}
          onDone={(m) => {
            setInstructOpen(false);
            if (m) setErrorMsg(null);
            invalidateAll();
          }}
        />
      ) : null}

      {regionalWin ? (
        <RegionalWindow
          open
          onOpenChange={(v) => !v && setRegionalWin(null)}
          conversationId={conversationId}
          city={reg?.city ?? ""}
          initial={
            regionalWin.mode === "edit" && reg?.active
              ? reg.active
              : reg?.suggestion
                ? { kind: reg.suggestion.kind, aiText: reg.suggestion.aiText }
                : null
          }
          onSaved={() => {
            setRegionalWin(null);
            qc.invalidateQueries({ queryKey: ["conv-regional", conversationId] });
            qc.invalidateQueries({ queryKey: ["regional-situations"] });
          }}
        />
      ) : null}
    </>
  );

  if (compact) {
    return (
      <div className="flex h-full max-h-[100dvh] min-h-0 flex-col bg-card text-foreground">
        {showMotive ? (
          <Strip tone="motive" px="pl-3.5 pr-3" action={<button type="button" className={STRIP_BTN.motive} onClick={() => setReasonOpen(true)}>Ver</button>}>
            <span className="min-w-0 flex-1 truncate text-[#6f2f78] dark:text-fuchsia-200">
              <strong className="font-bold">Motivo:</strong> {reason}
            </span>
          </Strip>
        ) : null}
        {extraBanners}
        {body}
        {footer}
        {windows}
      </div>
    );
  }

  return (
    <div className={`flex h-full min-h-0 flex-col bg-card text-foreground ${mobile ? "max-h-[100dvh] bg-background" : ""}`}>
      {mobile ? mobileHeader : desktopHeader}
      {showMotive ? (
        <Strip tone="motive" px={stripPx} action={<button type="button" className={STRIP_BTN.motive} onClick={() => setReasonOpen(true)}>Ver</button>}>
          <span className="min-w-0 flex-1 truncate text-[#6f2f78] dark:text-fuchsia-200">
            <strong className="font-bold">Motivo:</strong> {reason}
          </span>
        </Strip>
      ) : null}
      {extraBanners}
      {body}
      {footer}
      {windows}
    </div>
  );
}

function StayGuestIcon() {
  return <UserIcon className="size-3.5 shrink-0" />;
}

function UserIcon({ className = "size-[15px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function ZapOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
      <path d="M10.513 4.856 13.12 2.17a.5.5 0 0 1 .86.46l-1.377 4.317" />
      <path d="M15.656 10H20a1 1 0 0 1 .78 1.63l-1.72 1.773" />
      <path d="M16.273 16.273 10.88 21.83a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14H4a1 1 0 0 1-.78-1.63l4.507-4.643" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

/** Marca do Airbnb só na linha "Chat do Airbnb" da janela Reabrir Conversa (é o canal, não o hóspede). */
function AirbnbMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" aria-label="Airbnb" style={{ flex: "none" }}>
      <path
        fill="#FF385C"
        d="M12 1.5c-1.1 0-2 .7-2.6 1.9C7.6 7 5.4 11.6 3.6 15.4c-.9 2-.3 4.4 1.6 5.5 1.7 1 3.8.6 5.3-.8.5-.5 1-1 1.5-1.6.5.6 1 1.1 1.5 1.6 1.5 1.4 3.6 1.8 5.3.8 1.9-1.1 2.5-3.5 1.6-5.5C18.6 11.6 16.4 7 14.6 3.4 14 2.2 13.1 1.5 12 1.5Zm0 15.2c-1.3-1.6-2.3-3.2-2.3-4.5 0-1.3 1-2.2 2.3-2.2s2.3.9 2.3 2.2c0 1.3-1 2.9-2.3 4.5Z"
      />
    </svg>
  );
}

/** "+55 45 9 9921-4567" ⇒ "+55 45 9 9921-••••" (o número inteiro não aparece na janela). */
function maskPhone(p: string): string {
  return p.replace(/\d{4}$/, "••••");
}

/** Cartão "Parece Uma Situação da Região", logo abaixo da fala da equipe (mockup REG-D01/M01). */
function RegionalSuggestion({ city, onMark, onDismiss, busy }: { city: string; onMark: () => void; onDismiss: () => void; busy: boolean }) {
  return (
    <div className="ds-3d relative w-[85%] max-w-[420px] overflow-hidden rounded-[14px] bg-card px-3.5 py-3">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px] bg-[#c9a962]" />
      <div className="flex items-center gap-1.5 text-[12.5px] font-bold">
        <Zap className="size-3.5 shrink-0 text-[#c9a962]" />
        Parece Uma Situação da Região
      </div>
      <p className="mt-1 text-[12px] leading-[1.45] text-muted-foreground">
        Marque para a IA usar esta resposta com outros hóspedes de {city || "sua cidade"} que relatarem o mesmo problema. Defeito dentro do imóvel nunca entra.
      </p>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={onMark} className={BTN_BRAND}>
          Marcar Situação Regional
        </button>
        <button type="button" onClick={onDismiss} disabled={busy} className={`${BTN_SOFT} flex-none px-4`}>
          Agora Não
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────── Lista ───────────────────────────

type GuestDetail = {
  name: string | null;
  phone: string | null;
  phoneCountry: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
  reservationCode: string | null;
};

const CARD_LIFT_SHADOW = "0 22px 44px -18px rgba(40,25,20,0.34),0 4px 10px rgba(40,25,20,0.06)";

/**
 * Cards da lista. DESKTOP (25/11/2026, opção 4): sem borda, sem cor de seleção e sem escurecer — o selecionado
 * cresce um pouco para os lados e flutua com sombra ampla; ao passar o mouse, os demais mostram o MESMO efeito.
 * Infos da reserva no formato do cabeçalho (hóspede, período na cor da etapa, noites · hóspedes · código).
 * CELULAR: layout próprio (hóspede com o ícone de chat, período e o motivo numa linha).
 * Resolvidas: sem horário e sem motivo.
 */
export function ConversationList({
  conversations,
  details,
  reservations,
  guideViewers,
  owners,
  activeId,
  onSelect,
  layout = "desktop",
  resolved = false,
  empty,
}: {
  conversations: Array<{
    id: string;
    guest_name: string | null;
    status: string;
    handoff_at: string | null;
    last_message_at: string;
    handoff_urgency: string | null;
    handoff_reason: string | null;
    assigned_to?: string | null;
    guest_session_id?: string | null;
    properties: { name: string | null } | { name: string | null }[] | null;
  }>;
  details?: Record<string, GuestDetail>;
  assignedNames?: Record<string, string>;
  reservations?: Record<string, { status: "confirmed" | "loose" | "missing" | "no_reservations" | "cancelled"; checkin: string | null; checkout: string | null; guests?: number | null }>;
  guideViewers?: Record<string, number>;
  owners?: Record<string, { name: string | null; phone: string | null; phoneCountry: string | null }>;
  activeId: string | null;
  onSelect: (id: string) => void;
  layout?: "desktop" | "mobile";
  resolved?: boolean;
  /** Estado vazio (título e apoio). */
  empty?: { title: string; sub: string };
}) {
  if (conversations.length === 0) {
    return (
      <div className="ds-3d relative overflow-hidden rounded-[14px] border-0 bg-card px-4 py-8 text-center">
        <span className="mx-auto mb-2 grid size-9 place-items-center rounded-[10px] bg-foreground/[0.06] text-muted-foreground">
          <HeadphonesIcon />
        </span>
        <p className="text-[13px] font-semibold">{empty?.title ?? "Nenhuma conversa."}</p>
        {empty?.sub ? <p className="mt-1 text-[12px] text-muted-foreground">{empty.sub}</p> : null}
      </div>
    );
  }
  return (
    <>
      {conversations.map((c) => {
        const prop = Array.isArray(c.properties) ? c.properties[0] : c.properties;
        const isActive = c.id === activeId;
        const d = details?.[c.id];
        const owner = owners?.[c.id];
        const displayName = d?.name || c.guest_name || "Hóspede anônimo";
        const stay = buildStayView({ detail: d ?? null, res: reservations?.[c.id] ?? null, viewers: guideViewers?.[c.id] ?? 0 });
        const ago = shortAgo(c.handoff_at ?? c.last_message_at);
        const title = prop?.name ?? "—";
        if (layout === "mobile") {
          const sel = isActive ? " bg-[var(--card-surface-hover)] ring-1 ring-inset ring-foreground/10" : " bg-[var(--card-surface)]";
          const period = stay.checkin ? (
            <div className={`flex flex-wrap items-center gap-1.5 text-[11.5px] tabular-nums ${stayToneText(stay, "text-muted-foreground")}`}>
              <span>
                <RelDay iso={stay.checkin} toneClass={stayToneText(stay)} />
              </span>
              {stay.checkout ? (
                <>
                  <span>→</span>
                  <span>
                    <RelDay iso={stay.checkout} toneClass={stayToneText(stay)} />
                  </span>
                </>
              ) : null}
            </div>
          ) : null;
          return (
            <button
              key={c.id}
              type="button"
              data-clip-row
              onClick={() => onSelect(c.id)}
              className={`group relative isolate flex shrink-0 flex-col gap-2 rounded-[12px] p-3.5 text-left ds-3d${sel}`}
            >
              <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] rounded-l-[12px] ${stayBarClass(stay)}`} />
              <div className="ds-card-lines min-w-0 w-full">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="ds-card-title flex-1 leading-tight" title={title}>
                    {title}
                  </span>
                  {!resolved ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{ago}</span> : null}
                </div>
                {owner?.name ? (
                  <div className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-xs">
                    <span className="min-w-0 shrink truncate font-semibold text-foreground">{owner.name.trim()}</span>
                  </div>
                ) : null}
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 shrink truncate text-[13px] font-semibold">{displayName}</span>
                  <GuestChatIcon phone={d?.phone ?? null} country={d?.phoneCountry ?? null} />
                </div>
                {period}
                {!resolved && c.handoff_reason ? <p className="truncate text-[11.5px] text-muted-foreground">{c.handoff_reason}</p> : null}
              </div>
            </button>
          );
        }
        return (
          <button
            key={c.id}
            type="button"
            data-clip-row
            onClick={() => onSelect(c.id)}
            style={isActive ? { boxShadow: CARD_LIFT_SHADOW } : undefined}
            className={`group relative isolate flex shrink-0 flex-col gap-2 overflow-hidden rounded-[12px] p-3.5 text-left ds-3d bg-card ${
              isActive
                ? "-mx-3 px-[26px]"
                : "transition-[margin,padding,box-shadow] duration-200 ease-out hover:-mx-3 hover:px-[26px] hover:shadow-[0_22px_44px_-18px_rgba(40,25,20,0.34),0_4px_10px_rgba(40,25,20,0.06)]"
            }`}
          >
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${stayBarClass(stay)}`} />
            <div className="ds-card-lines min-w-0 w-full">
              <div className="flex min-w-0 items-center gap-2">
                <span className="ds-card-title flex-1 leading-tight" title={title}>
                  {title}
                </span>
                {!resolved ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{ago}</span> : null}
              </div>
              {owner?.name ? (
                <div className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-xs">
                  <span className="min-w-0 shrink truncate font-semibold text-foreground">{owner.name.trim()}</span>
                </div>
              ) : null}
              <div className="mt-1 flex min-w-0 flex-col gap-[5px]">
                <StayGuestLine name={displayName} />
                <StayPeriodLine stay={stay} />
                <StayNightsLine stay={stay} />
              </div>
            </div>
          </button>
        );
      })}
    </>
  );
}

/** Ícone de chat do hóspede (verde, 12px) logo depois do nome; com telefone abre o WhatsApp. */
function GuestChatIcon({ phone, country }: { phone: string | null; country: string | null }) {
  const icon = (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full p-0.5 text-emerald-600">
      <MessageCircle style={{ width: 12, height: 12 }} />
    </span>
  );
  if (!phone) return icon;
  const digits = (formatIntlPhone(phone, country ?? undefined) ?? phone).replace(/\D+/g, "");
  if (!digits) return icon;
  return (
    <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Conversar com o hóspede">
      {icon}
    </a>
  );
}

function HeadphonesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

// reexportados para quem já importava daqui
export { nightsLabel, guestsLabel, CopyCode };

export function useMyUserId() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setId(data.user?.id ?? null));
  }, []);
  return id;
}
