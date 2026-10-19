import { ChannelLogo, channelOf } from "./ChannelLogo";
import { GuideViewers, StayLines, StayTag, buildStayView, shortAgo, stayBarClass, type StayView } from "./stay-view";
import { ownerLabel } from "@/components/dashboard/card-colors";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { ComposerPlusMenu } from "@/components/handoff/ComposerPlusMenu";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
} from "@/lib/handoff.functions";
import { MessageText } from "@/components/handoff/MessageText";
import { attachStaffMessage } from "@/lib/chat-attachments.functions";
import { listConversationEscalations, answerEscalation, reopenEscalationDecision } from "@/lib/ai-supervision.functions";
import { notifyAction } from "@/components/UndoActionBar";
import { dismissEscalation } from "@/lib/handoff.functions";
import { readDecisionSpec, canBecomeKnowledge } from "@/lib/ai/human-loop/decision-options";
import { minutesLeft } from "@/lib/ai/pause";
import {
  Send,
  UserCheck,
  RotateCcw,
  CheckCircle2,
  Loader2,
  StickyNote,
  Phone,
  Lock,
  UserPlus2,
  ArrowRightLeft,
  X,
  Sparkles,
  Paperclip,
  MessageCircle,
  MessageSquare,
  Languages,
  Pencil,
  Trash2,
  MoreVertical,
  Copy,
  Camera,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reopenHandoffConversation } from "@/lib/handoff.functions";
import { sendWhatsappFromConversation, getMyWhatsappConfig } from "@/lib/whatsapp.functions";
import { translateMessage } from "@/lib/translate.functions";
import { detectLanguage, userLanguage, LANG_NAMES } from "@/lib/lang-detect";
import { TagMentionTextarea, type TagMentionItem } from "@/components/tags/TagMentionTextarea";
import { getTagItemsForConversation } from "@/lib/guide-tag-items.functions";
import { KnowledgeFillDialog } from "@/components/handoff/KnowledgeFillDialog";
import { TeachAiDialog } from "@/components/handoff/TeachAiDialog";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import { transcribeAssistantAudio } from "@/lib/assistant.functions";
import { Mic, ChevronDown, ChevronUp } from "lucide-react";
import {
  COMPOSER_FIELD,
  COMPOSER_INPUT,
  COMPOSER_SEND_BTN,
} from "@/components/chat/composer-styles";
import { AttachmentBubble, type AttachmentInfo } from "@/components/handoff/AttachmentBubble";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useMyPermissions } from "@/hooks/useMyPermissions";

type Props = {
  conversationId: string;
  compact?: boolean;
  myUserId: string | null;
  /** Dados da reserva da conversa (vêm da lista): período, estadia, código, fase. */
  stay?: StayView | null;
  /** Proprietário do imóvel (mesma fonte da lista) — para o ícone de mensagem. */
  owner?: { name: string | null; phone: string | null; phoneCountry: string | null } | null;
};

import { toWhatsappNumber, formatIntlPhone } from "@/lib/masks";

function whatsappHref(phone: string, country: string | null) {
  const digits = toWhatsappNumber(phone, country);
  return digits ? `https://wa.me/${digits}` : null;
}

function fmtCheckin(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
  } catch {
    return iso;
  }
}

/**
 * OS TIQUINHOS DO WHATSAPP (pedido explícito, 10/09/2026).
 *
 * O canal já guardava o recibo em `property_chat_messages.delivery_status` —
 * o webhook da Sinch escreve `sent`, `delivered`, `read` ou `failed` — mas
 * nada disso aparecia na tela: o atendente mandava a mensagem e não sabia se
 * ela tinha chegado.
 *
 *   ✓        enviada (saiu daqui, ainda sem confirmação do aparelho)
 *   ✓✓       entregue no aparelho
 *   ✓✓ azul  lida
 *   !        falhou
 *
 * Sem recibo (chat do próprio guia, que é tempo real e não tem confirmação de
 * entrega), NADA é desenhado — um tique cinza eterno mentiria.
 */
function DeliveryTicks({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-0.5 text-rose-200" title="Falha no envio">
        <AlertCircle className="size-3" />
      </span>
    );
  }
  if (status === "sent") {
    return (
      <span className="inline-flex items-center" title="Enviada">
        <Check className="size-3" />
      </span>
    );
  }
  if (status === "delivered" || status === "read") {
    const read = status === "read";
    return (
      <span
        className={`inline-flex items-center ${read ? "text-sky-300" : ""}`}
        title={read ? "Lida" : "Entregue"}
      >
        <Check className="size-3" />
        <Check className="-ml-1.5 size-3" />
      </span>
    );
  }
  return null;
}

export function ConversationView({ conversationId, compact, myUserId, stay, owner }: Props) {
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
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["handoff-conv", conversationId],
    queryFn: () => getFn({ data: { conversationId } }),
    // Todos os membros acompanham em tempo real, mesmo sem assumir a conversa.
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  /* A FILA DE PERGUNTAS DA IA (11/09/2026).
   *
   * Até aqui, `ai_human_escalations` existia no banco e não tinha um único
   * consumidor de tela: a IA perguntava e ninguém via. O atendente lia o
   * `handoff_reason` — que é o motivo de ROTEAMENTO, escrito para máquina — e
   * respondia ao hóspede por fora. "O humano é consultor interno da IA" não
   * tinha por onde acontecer. */
  const escalationsFn = useServerFn(listConversationEscalations);
  const answerFn = useServerFn(answerEscalation);
  const dismissFn = useServerFn(dismissEscalation);
  const escQ = useQuery({
    queryKey: ["conv-escalations", conversationId],
    queryFn: () => escalationsFn({ data: { conversationId } }),
    refetchInterval: 8000,
  });
  const escalations = useMemo(
    () =>
      (escQ.data ?? []) as Array<{
        id: string;
        question_to_human: string | null;
        human_response: string | null;
        status: string | null;
        created_at: string | null;
        resolved_at: string | null;
        context_snapshot?: unknown;
      }>,
    [escQ.data],
  );
  const respondidas = useMemo(
    () => escalations.filter((e) => e.status === "answered" || e.status === "dismissed"),
    [escalations],
  );
  /* Várias perguntas no mesmo chat (19/10/2026): todas pendentes ficam na
     base, em cascata. Com só uma, ela já vem aberta; com mais, ficam
     recolhidas e a equipe expande a que quiser responder. */
  const pendingAsks = useMemo(
    () => escalations.filter((e) => e.status === "pending"),
    [escalations],
  );
  const [openAskId, setOpenAskId] = useState<string | null>(null);
  const pendingAsk = useMemo(
    () =>
      pendingAsks.length === 1
        ? pendingAsks[0]
        : (pendingAsks.find((e) => e.id === openAskId) ?? null),
    [pendingAsks, openAskId],
  );
  const hasPendingAsk = pendingAsks.length > 0;
  const [askText, setAskText] = useState("");
  const [askRecording, setAskRecording] = useState(false);
  const [askTranscribing, setAskTranscribing] = useState(false);
  const transcribeAskFn = useServerFn(transcribeAssistantAudio);
  async function onAskRecorded(a: RecordedAudio) {
    setAskRecording(false);
    setAskTranscribing(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("Não consegui ler o áudio."));
        r.readAsDataURL(a.blob);
      });
      const mimeType = (a.mime || "audio/webm").split(";")[0];
      const attempt = () =>
        Promise.race([
          transcribeAskFn({ data: { audioBase64: base64, mimeType } }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 30000),
          ),
        ]);
      let res: { text: string };
      try {
        res = await attempt();
      } catch {
        // Redes móveis (Safari/iOS "Load failed") costumam falhar só na 1ª tentativa.
        res = await attempt();
      }
      const text = (res.text ?? "").trim();
      if (!text) throw new Error("empty");
      setAskText((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      setErrorMsg(null);
    } catch {
      setErrorMsg(
        "Não consegui transcrever o áudio (falha de conexão). Grave de novo ou digite sua resposta.",
      );
    } finally {
      setAskTranscribing(false);
    }
  }
  // Sem pré-marcação: a equipe escolhe explicitamente (18/10/2026).
  const [saveKnowledge, setSaveKnowledge] = useState<boolean | null>(null);
  const [chosenOption, setChosenOption] = useState<string | null>(null);
  const [knowledgeScope, setKnowledgeScope] = useState<"property" | "global" | null>(null);
  const reopenDecisionFn = useServerFn(reopenEscalationDecision);
  const askSpec = useMemo(() => readDecisionSpec(pendingAsk?.context_snapshot), [pendingAsk]);
  const askNeedsKnowledge = !askSpec || canBecomeKnowledge(askSpec.kind);
  useEffect(() => {
    setChosenOption(null);
    setSaveKnowledge(null);
  }, [pendingAsk?.id]);

  const tagItemsFn = useServerFn(getTagItemsForConversation);
  const { data: tagItemsData } = useQuery({
    queryKey: ["tag-items", "conv", conversationId],
    queryFn: () => tagItemsFn({ data: { conversationId } }),
    staleTime: 60_000,
  });
  const tagItems = useMemo<TagMentionItem[]>(
    () =>
      (tagItemsData?.items ?? []).map((i) => ({
        key: i.key,
        param: i.param,
        label: i.label,
        hint: i.hint,
        kind: i.kind,
      })),
    [tagItemsData],
  );

  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [channel, setChannel] = useState<"chat" | "whatsapp">("chat");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ id: string; content: string; mine: boolean } | null>(
    null,
  );
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLongPress = (m: { id: string; content: string; mine: boolean }) => {
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
  const [fillOpen, setFillOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);

  const [teachOpen, setTeachOpen] = useState(false);
  const [teachSource, setTeachSource] = useState<{ id: string; content: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const editFn = useServerFn(editHandoffMessage);
  const deleteFn = useServerFn(deleteHandoffMessage);
  const reopenFn = useServerFn(reopenHandoffConversation);
  const sendWaFn = useServerFn(sendWhatsappFromConversation);
  const waCfgFn = useServerFn(getMyWhatsappConfig);
  const waCfgQ = useQuery({
    queryKey: ["my-whatsapp-config"],
    queryFn: async () => {
      try {
        return await waCfgFn();
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const waIntegrated = waCfgQ.data?.status === "active";

  // Tradução de mensagens do hóspede para o idioma do sistema do atendente.
  const myLang = useMemo(() => userLanguage(), []);
  const translateFn = useServerFn(translateMessage);
  const [translations, setTranslations] = useState<
    Record<string, { text: string | null; loading: boolean; showing: boolean }>
  >({});
  const toggleTranslation = async (id: string, content: string) => {
    const current = translations[id];
    if (current?.text) {
      setTranslations((p) => ({ ...p, [id]: { ...current, showing: !current.showing } }));
      return;
    }
    setTranslations((p) => ({ ...p, [id]: { text: null, loading: true, showing: false } }));
    try {
      const r = await translateFn({ data: { text: content.slice(0, 2000), targetLang: myLang } });
      setTranslations((p) => ({
        ...p,
        [id]: { text: r.translated, loading: false, showing: true },
      }));
    } catch (e) {
      setTranslations((p) => ({ ...p, [id]: { text: null, loading: false, showing: false } }));
      setErrorMsg(friendlyErrorMessage(e, "Não consegui traduzir agora."));
    }
  };

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [q.data?.messages?.length]);

  useEffect(() => {
    // Unique per-mount name avoids "cannot add postgres_changes callbacks after subscribe()"
    // when the effect remounts (StrictMode, tab focus, etc.) and Supabase reuses a same-name channel.
    const channelName = `conv-${conversationId}-${Math.random().toString(36).slice(2)}`;
    const ch = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "property_chat_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "property_chat_conversations",
          filter: `id=eq.${conversationId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, qc]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["conv-escalations", conversationId] });
    qc.invalidateQueries({ queryKey: ["ai-escalation-queue"] });
    qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
    qc.invalidateQueries({ queryKey: ["handoff-list"] });
    qc.invalidateQueries({ queryKey: ["handoff-pending-count"] });
  };

  const send = useMutation({
    mutationFn: async () =>
      channel === "whatsapp" && !note
        ? sendWaFn({ data: { conversationId, text: text.trim() } })
        : sendFn({ data: { conversationId, content: text.trim(), internalNote: note } }),
    onSuccess: () => {
      setText("");
      invalidateAll();
    },
    onError: (e) => setErrorMsg((e as Error).message),
  });
  /* Responder À IA: o atendente escreve uma linha e ela leva ao hóspede na
   * própria voz. A entrega é imediata (`speakWithAgent`), não fica esperando o
   * hóspede escrever de novo — foi assim que a hóspede do Studio 103 ficou sem
   * resposta desde 08/09. */
  const answer = useMutation({
    mutationFn: async () => {
      if (!pendingAsk) throw new Error("Nenhuma pergunta pendente.");
      return answerFn({
        data: {
          escalationId: pendingAsk.id,
          answer: (askSpec ? chosenOption : askText.trim()) ?? "",
          saveAsKnowledge: askNeedsKnowledge && saveKnowledge === true,
          knowledgeScope: knowledgeScope ?? "property",
        },
      });
    },
    onSuccess: (r) => {
      const escId = pendingAsk?.id;
      setAskText("");
      setChosenOption(null);
      setSaveKnowledge(null);
      setKnowledgeScope(null);
      const ex = (r as { executed?: { action: string; reservationId: string; previouslyDone: boolean } | null }).executed ?? null;
      const msg =
        ex?.action === "checkin_done" ? "Check-in registrado." : ex?.action === "checkout_done" ? "Check-out registrado." : "Decisão enviada.";
      // Desfazer de 5s: só quando nada foi dito ao hóspede (decisão interna).
      const silent = !!(r as { silent?: boolean }).silent;
      notifyAction(
        msg,
        escId && silent
          ? () => {
              void reopenDecisionFn({ data: { escalationId: escId, revert: ex } })
                .then(invalidateAll)
                .catch((e) => setErrorMsg(friendlyErrorMessage(e, "Não foi possível desfazer.")));
            }
          : undefined,
      );
      if (r && (r as { entregue?: boolean }).entregue === false) {
        setErrorMsg(
          "Resposta salva, mas não consegui entregar ao hóspede agora. Vou tentar de novo.",
        );
      }
      invalidateAll();
    },
    onError: (e) => setErrorMsg((e as Error).message),
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      if (!pendingAsk) return null;
      return dismissFn({ data: { escalationId: pendingAsk.id, reason: null } });
    },
    onSuccess: invalidateAll,
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
    mutationFn: async (v: { messageId: string; content: string }) =>
      editFn({ data: { conversationId, messageId: v.messageId, content: v.content } }),
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

  function inferAttachmentType(mime: string): "image" | "audio" | "video" | "document" | null {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    if (mime === "application/pdf") return "document";
    return null;
  }

  async function uploadAndAttach(
    file: Blob,
    opts: { name?: string; mime?: string; durationMs?: number },
  ) {
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
      const { error: upErr } = await supabase.storage
        .from("chat-attachments")
        .upload(path, file, { contentType: mime, upsert: false });
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
    await uploadAndAttach(audio.blob, {
      name: filename,
      mime: audio.mime,
      durationMs: audio.durationMs,
    });
  }

  const targetsQ = useQuery({
    queryKey: ["handoff-transfer-targets", conversationId],
    queryFn: () => targetsFn({ data: { conversationId } }),
    enabled: transferOpen,
    staleTime: 30_000,
  });

  const conv = q.data?.conversation;
  const msgs = q.data?.messages ?? [];
  // POR ONDE o hóspede está falando agora: canal da última mensagem dele.
  const liveChannel = (() => {
    const lastGuest = [...msgs].reverse().find((m) => (m as { role: string }).role === "user") as
      | { channel?: string | null }
      | undefined;
    return channelOf(lastGuest?.channel ?? null, conv?.guest_session_id ?? null);
  })();
  const guestNameByConversation =
    (q.data as { guestNameByConversation?: Record<string, string> } | undefined)
      ?.guestNameByConversation ?? {};
  const reservationActive = !!(q.data as { reservationActive?: boolean } | undefined)
    ?.reservationActive;
  const guest = q.data?.guestDetails;
  const claimReq = q.data?.claimRequester;
  const assignedProfile = q.data?.assignedProfile;
  const senderProfiles =
    (q.data as { senderProfiles?: Record<string, { displayName: string | null }> } | undefined)
      ?.senderProfiles ?? {};
  const propertyName = (conv?.properties as { name?: string } | null)?.name ?? "Guia";
  const propertyOwnerName =
    (q.data as { propertyOwnerName?: string | null } | undefined)?.propertyOwnerName ?? null;

  const isMine = !!(conv?.assigned_to && myUserId && conv.assigned_to === myUserId);
  /* Minutos que faltam para a IA voltar. `null` quando ela não está pausada —
   * ou quando a pausa é das antigas, sem prazo. Recalculado a cada refetch da
   * conversa (4s), então o contador anda sozinho. */
  const pausaMinutos = minutesLeft(conv);
  const isLockedByOther = !!(conv?.assigned_to && myUserId && conv.assigned_to !== myUserId);
  const isUnassigned = !conv?.assigned_to;
  const iRequested = !!(
    conv?.claim_requested_by &&
    myUserId &&
    conv.claim_requested_by === myUserId
  );
  const someoneRequestedFromMe = !!(
    isMine &&
    conv?.claim_requested_by &&
    conv.claim_requested_by !== myUserId
  );
  const status = conv?.status;

  const guestName = guest?.name ?? conv?.guest_name ?? "Hóspede anônimo";
  const waHref = guest?.phone ? whatsappHref(guest.phone, guest.phoneCountry) : null;
  const checkinFmt = fmtCheckin(guest?.checkinDate ?? null);
  const checkoutFmt = fmtCheckin(
    (guest as { checkoutDate?: string | null } | undefined)?.checkoutDate ?? null,
  );

  function handleClaim() {
    if (isLockedByOther) {
      const who = assignedProfile?.displayName ?? "outro membro";
      const ok =
        typeof window !== "undefined" &&
        window.confirm(
          `Esta conversa está sendo atendida por ${who}. Tem certeza que deseja assumir?`,
        );
      if (!ok) return;
    }
    claim.mutate();
  }

  return (
    <div
      // max-h-[100dvh]: pedido explícito (07/09/2026) — o cabeçalho do
      // hóspede sumia ao abrir o teclado no celular. Causa: `h-full` mede a
      // viewport SEM descontar o teclado, então o painel ficava mais alto
      // que a área visível e o navegador rolava a página inteira pra manter
      // o campo à vista, levando o cabeçalho junto. `dvh` acompanha a
      // viewport dinâmica, então o painel fica contido e quem rola é só a
      // lista de mensagens — o cabeçalho (shrink-0 + sticky) nunca sai.
      className="flex flex-col h-full max-h-[100dvh] min-h-0 bg-white text-zinc-900"
      style={{
        // Sobrescreve tokens do tema escuro dentro do painel de chat,
        // deixando a janela completamente clara na visão desktop.
        ["--background" as never]: "#ffffff",
        ["--foreground" as never]: "#18181b",
        ["--card" as never]: "#ffffff",
        ["--card-foreground" as never]: "#18181b",
        ["--muted" as never]: "#f4f4f5",
        ["--muted-foreground" as never]: "#71717a",
        ["--border" as never]: "#e4e4e7",
        ["--input" as never]: "#e4e4e7",
        ["--secondary" as never]: "#f4f4f5",
        ["--secondary-foreground" as never]: "#18181b",
        ["--popover" as never]: "#ffffff",
        ["--popover-foreground" as never]: "#18181b",
        // Este painel já fixa seu próprio tema claro (acima) pra ficar
        // estável independente do modo claro/escuro do resto do app — mas
        // faltava fixar --primary/--primary-foreground também. Sem isso, o
        // botão de enviar (bg-primary + texto branco fixo) podia herdar um
        // --primary quase branco de um dos temas, deixando o ícone
        // praticamente invisível sobre o próprio fundo.
        ["--primary" as never]: "#7c1ad8",
        ["--primary-foreground" as never]: "#ffffff",
      }}
    >
      {/* Pedido explícito (09/09/2026): "os principais dados do hóspede também
          precisam ser fixados". Antes este bloco ENCOLHIA ao focar o campo de
          mensagem — proprietário, imóvel, check-in/check-out e código sumiam
          justamente na hora de escrever a resposta, que é quando eles são mais
          necessários. O cabeçalho agora é sempre o mesmo, com ou sem teclado
          aberto: um só bloco fixo no topo, e quem rola é só a lista de
          mensagens. */}
      <div className="sticky top-0 z-20 border-b border-zinc-200 shrink-0 bg-zinc-50 px-4 py-3 space-y-2">
        <div className="flex gap-2 items-start justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 inline-flex" title={`Hóspede conversando via ${liveChannel}`}>
                <ChannelLogo channel={liveChannel} size={18} />
              </span>
              <span className="text-base font-semibold truncate">{guestName}</span>
              {guest?.phone && (
                <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <PhoneActionButton phone={guest.phone} country={guest.phoneCountry} size={13} />
                </span>
              )}
              {stay && <GuideViewers count={stay.viewers} />}
              {stay && <StayTag stay={stay} light />}
            </div>

            {(owner?.name ?? propertyOwnerName) && (
              <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
                <span className="truncate text-zinc-600" title={owner?.name ?? propertyOwnerName ?? ""}>
                  Proprietário: <b className="font-semibold text-zinc-900">{ownerLabel(owner?.name ?? propertyOwnerName)?.replace(/^Proprietário:\s*/, "")}</b>
                </span>
                {owner?.phone && (
                  <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <PhoneActionButton phone={owner.phone} country={owner.phoneCountry} size={12} />
                  </span>
                )}
              </div>
            )}

            <div className="text-[12px] text-muted-foreground truncate">{propertyName}</div>

            {stay && (
              <>
                <div className="my-0.5 h-px bg-zinc-200" />
                <StayLines stay={stay} size="md" />
              </>
            )}

            {isLockedByOther && (
              <div className="text-[11px] mt-2 px-2 py-1 rounded bg-secondary text-foreground/80 border border-border inline-flex items-center gap-1">
                <Lock className="size-3" /> Em atendimento por{" "}
                {assignedProfile?.displayName ?? "outro membro"}
              </div>
            )}
            {someoneRequestedFromMe && (
              <div className="text-[11px] mt-2 px-2 py-1 rounded bg-primary/10 text-primary border border-primary/30 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1">
                  <UserPlus2 className="size-3" /> {claimReq?.displayName ?? "Um membro"} pediu
                  acesso
                </span>
                <button
                  onClick={() => claimReq?.userId && transfer.mutate(claimReq.userId)}
                  className="px-2 py-0.5 rounded bg-primary text-primary-foreground text-[11px]"
                >
                  Transferir
                </button>
              </div>
            )}
          </div>

          <div className="shrink-0 flex items-center gap-1">
            {canChat && isMine && status !== "resolved" && (
              <button
                type="button"
                onClick={() => setNote((v) => !v)}
                title="Nota interna"
                aria-label="Nota interna"
                className={`size-9 grid place-items-center rounded-full border transition-colors ${note ? "bg-yellow-500/20 text-yellow-700 border-yellow-500/40" : "border-border text-muted-foreground hover:bg-secondary"}`}
              >
                <StickyNote className="size-4" />
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="size-9 grid place-items-center rounded-full border border-border hover:bg-secondary"
                  aria-label="Ações da conversa"
                  title="Ações da conversa"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 z-[2147483600]">
                <DropdownMenuLabel className="text-[11px]">Ações</DropdownMenuLabel>
                {status === "resolved" && canChat && (
                  <DropdownMenuItem
                    onSelect={() => {
                      if (waIntegrated && guest?.phone) setReopenOpen(true);
                      else reopen.mutate("chat");
                    }}
                  >
                    <RotateCcw className="size-3.5 mr-2" /> Reabrir conversa
                  </DropdownMenuItem>
                )}
                {(isUnassigned || isLockedByOther) && status !== "resolved" && (
                  <DropdownMenuItem onSelect={() => handleClaim()}>
                    <UserCheck className="size-3.5 mr-2" /> Assumir
                  </DropdownMenuItem>
                )}
                {isLockedByOther && !iRequested && status !== "resolved" && (
                  <DropdownMenuItem onSelect={() => requestClaim.mutate()}>
                    <UserPlus2 className="size-3.5 mr-2" /> Solicitar acesso
                  </DropdownMenuItem>
                )}
                {isLockedByOther && iRequested && (
                  <DropdownMenuItem onSelect={() => cancelRequest.mutate()}>
                    <X className="size-3.5 mr-2" /> Cancelar solicitação
                  </DropdownMenuItem>
                )}
                {isMine && status !== "resolved" && (
                  <>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setTransferOpen((v) => !v);
                      }}
                    >
                      <ArrowRightLeft className="size-3.5 mr-2" /> Transferir
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => release.mutate()}>
                      <RotateCcw className="size-3.5 mr-2" /> Devolver à IA
                    </DropdownMenuItem>
                  </>
                )}
                {/* Canal de envio é escolhido ao reabrir a conversa. */}

                {status !== "resolved" && (isMine || !conv?.assigned_to) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => resolve.mutate()}>
                      <CheckCircle2 className="size-3.5 mr-2" /> Resolver
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {channel === "whatsapp" && (
          <div className="text-[11px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3" /> Enviando pelo WhatsApp do hóspede
            </span>
            <button onClick={() => setChannel("chat")} className="underline">
              usar chat
            </button>
          </div>
        )}

        {transferOpen && isMine && (
          <div className="rounded-md border border-border bg-background p-2 space-y-1">
            <div className="text-[11px] text-muted-foreground px-1">Transferir para:</div>
            {targetsQ.isLoading && (
              <div className="text-xs text-muted-foreground px-1 py-1">
                <Loader2 className="size-3 animate-spin inline mr-1" /> Carregando…
              </div>
            )}
            {targetsQ.data?.targets.length === 0 && (
              <div className="text-xs text-muted-foreground px-1 py-1">
                Nenhum outro membro disponível.
              </div>
            )}
            {targetsQ.data?.targets.map((t) => (
              <button
                key={t.userId}
                onClick={() => transfer.mutate(t.userId)}
                disabled={transfer.isPending}
                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-secondary flex items-center justify-between"
              >
                <span>{t.displayName ?? t.userId.slice(0, 8)}</span>
                <span className="text-[10px] text-muted-foreground uppercase">{t.role}</span>
              </button>
            ))}
          </div>
        )}

        {errorMsg && (
          <div className="text-[11px] px-2 py-1 rounded bg-destructive/10 text-destructive border border-destructive/30 flex items-center justify-between gap-2">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)}>
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0 bg-transparent">
        {q.isLoading && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" /> Carregando…
          </div>
        )}
        {msgs.map((m, i) => {
          const isGuest = m.sender_type === "guest";
          const isNote = m.is_internal_note;
          const canTeach = !isNote && typeof m.content === "string" && m.content.trim().length > 2;
          const detected = isGuest && m.content ? detectLanguage(m.content) : null;
          const canTranslate = Boolean(detected && detected !== myLang);
          const tr = translations[m.id];
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
          /* CONSULTAS INTERNAS NO HISTÓRICO (11/09/2026).
             Decisão do produto: a pergunta da IA aparece nos DOIS lugares —
             cartão ativo acima do campo enquanto pendente, e aqui, discreta,
             depois de respondida, para quem lê a conversa depois entender por
             que a IA respondeu aquilo. Fica entre a mensagem atual e a
             próxima, pelo horário em que foi resolvida. */
          const consultas = respondidas.filter((e) => {
            const quando = new Date(e.resolved_at ?? e.created_at ?? 0).getTime();
            const agora = new Date(m.created_at ?? 0).getTime();
            const proxima = msgs[i + 1]
              ? new Date(msgs[i + 1].created_at ?? 0).getTime()
              : Infinity;
            return quando >= agora && quando < proxima;
          });
          return (
            <Fragment key={m.id}>
              <div className={`flex flex-col ${isGuest ? "items-start" : "items-end"}`}>
                <div
                  onPointerDown={() =>
                    startLongPress({ id: m.id, content: m.content ?? "", mine: !isGuest })
                  }
                  onPointerUp={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setActionMsg({ id: m.id, content: m.content ?? "", mine: !isGuest });
                  }}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words select-none ${
                    isNote
                      ? "bg-yellow-500/15 border border-yellow-500/30 text-foreground"
                      : isGuest
                        ? "bg-secondary text-foreground"
                        : m.sender_type === "human"
                          ? "bg-primary text-primary-foreground"
                          : "bg-accent text-accent-foreground"
                  }`}
                >
                  {isNote && (
                    <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1 flex items-center gap-1">
                      <StickyNote className="size-3" /> Nota interna
                    </div>
                  )}
                  {!isNote && isGuest && (
                    <div className="text-[11px] mb-1 flex items-center gap-1">
                      <ChannelLogo
                        channel={channelOf((m as { channel?: string | null }).channel ?? null, conv?.guest_session_id ?? null)}
                        size={12}
                      />
                      <span className="font-bold">
                        {guestNameByConversation[(m as { conversation_id?: string }).conversation_id ?? ""] ||
                          guestName}
                      </span>
                    </div>
                  )}
                  {!isNote && !isGuest && (
                    <div className="text-[11px] mb-1">
                      {m.sender_type === "human" ? (
                        <span className="font-bold">
                          {(m.sender_user_id && senderProfiles[m.sender_user_id]?.displayName) ||
                            "Atendente"}
                        </span>
                      ) : (
                        <span className="uppercase tracking-wide opacity-70">IA</span>
                      )}
                    </div>
                  )}
                  {attachment && (
                    <div className="mb-1">
                      <AttachmentBubble attachment={attachment} />
                    </div>
                  )}
                  {editingId === m.id ? (
                    <div className="space-y-1">
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        rows={3}
                        className="w-full min-w-[220px] rounded-lg bg-background text-foreground border border-border p-2 text-sm"
                      />
                      <div className="flex items-center gap-2 justify-end">
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
                          className="text-[11px] px-2 py-1 rounded bg-foreground text-background disabled:opacity-50"
                          onClick={() => editMsg.mutate({ messageId: m.id, content: editingText })}
                        >
                          {editMsg.isPending ? "Salvando…" : "Salvar"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    m.content && <MessageText text={tr?.showing && tr.text ? tr.text : m.content} />
                  )}
                  {tr?.showing && tr.text && (
                    <div className="text-[10px] opacity-60 mt-1 flex items-center gap-1">
                      <Languages className="size-3" /> Traduzido automaticamente
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-1 text-[10px] opacity-60">
                    <span>
                      {formatDistanceToNow(new Date(m.created_at), {
                        locale: ptBR,
                        addSuffix: true,
                      })}
                      {m.edited_at ? " · editada" : ""}
                    </span>
                    {/* Só nas MINHAS mensagens: recibo do que o hóspede recebeu. */}
                    {!isGuest && !isNote && <DeliveryTicks status={m.delivery_status} />}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canTranslate && (
                    <button
                      type="button"
                      onClick={() => toggleTranslation(m.id, m.content ?? "")}
                      disabled={tr?.loading}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-60"
                      title={`Mensagem em ${LANG_NAMES[detected as string] ?? detected}`}
                    >
                      {tr?.loading ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Languages className="size-3" />
                      )}
                      {tr?.showing ? "Ver original" : "Traduzir"}
                    </button>
                  )}
                  {canTeach && conv?.property_id && (
                    <button
                      type="button"
                      onClick={() => {
                        setTeachSource({ id: m.id, content: m.content ?? "" });
                        setTeachOpen(true);
                      }}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Adicionar este conteúdo à base de conhecimento da IA"
                    >
                      <Sparkles className="size-3" /> Ensinar IA
                    </button>
                  )}
                </div>
              </div>
              {consultas.map((e) => (
                <div
                  key={e.id}
                  className="mx-auto w-full max-w-[92%] rounded-lg border border-violet-500/30 bg-violet-500/[0.05] px-2.5 py-1.5 text-[11px] leading-snug"
                >
                  <div className="mb-0.5 inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.13em] text-violet-600 dark:text-violet-300">
                    <Sparkles className="size-2.5" /> consulta interna
                  </div>
                  <p className="text-muted-foreground">{e.question_to_human}</p>
                  <p className="mt-0.5 font-medium">
                    {e.status === "dismissed" ? "Descartada." : e.human_response}
                  </p>
                  {canChat && e.status === "answered" && !pendingAsk && readDecisionSpec(e.context_snapshot) && (
                    <button
                      type="button"
                      onClick={() => {
                        void reopenDecisionFn({ data: { escalationId: e.id, revert: null } })
                          .then(invalidateAll)
                          .catch((err) => setErrorMsg(friendlyErrorMessage(err, "Não foi possível refazer.")));
                      }}
                      className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-700 hover:underline"
                    >
                      Refazer decisão
                    </button>
                  )}
                </div>
              ))}
            </Fragment>
          );
        })}
      </div>

      {conv?.property_id && teachSource && (
        <TeachAiDialog
          open={teachOpen}
          onOpenChange={(v) => {
            setTeachOpen(v);
            if (!v) setTeachSource(null);
          }}
          propertyId={conv.property_id as string}
          propertyName={propertyName}
          initialContent={teachSource.content}
          sourceMessageId={teachSource.id}
        />
      )}

      {/* Ações da mensagem (segurar para abrir, como no WhatsApp) */}
      <Dialog
        open={!!actionMsg}
        onOpenChange={(v) => {
          if (!v) setActionMsg(null);
        }}
      >
        <DialogContent className="max-w-xs z-[2147483600]">
          <DialogHeader>
            <DialogTitle className="text-sm">Opções da mensagem</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col">
            <button
              type="button"
              className="flex items-center gap-2 px-2 py-2.5 rounded-lg text-sm hover:bg-secondary text-left"
              onClick={() => {
                if (actionMsg) navigator.clipboard?.writeText(actionMsg.content);
                setActionMsg(null);
              }}
            >
              <Copy className="size-4" /> Copiar
            </button>
            {actionMsg?.mine && (
              <>
                <button
                  type="button"
                  className="flex items-center gap-2 px-2 py-2.5 rounded-lg text-sm hover:bg-secondary text-left"
                  onClick={() => {
                    if (actionMsg) {
                      setEditingId(actionMsg.id);
                      setEditingText(actionMsg.content);
                    }
                    setActionMsg(null);
                  }}
                >
                  <Pencil className="size-4" /> Editar
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 px-2 py-2.5 rounded-lg text-sm text-destructive hover:bg-destructive/10 text-left"
                  onClick={() => {
                    if (actionMsg) deleteMsg.mutate(actionMsg.id);
                    setActionMsg(null);
                  }}
                >
                  <Trash2 className="size-4" /> Apagar
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reabrir conversa */}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent className="max-w-sm z-[2147483600]">
          <DialogHeader>
            <DialogTitle className="text-base">Reabrir conversa</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Por onde você quer falar com o hóspede?</p>
          <div className="flex flex-col gap-2 mt-2">
            <button
              type="button"
              disabled={reopen.isPending}
              onClick={() => reopen.mutate("chat")}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border hover:bg-secondary text-sm"
            >
              <MessageSquare className="size-4" /> Chat do navegador
            </button>
            <button
              type="button"
              disabled={reopen.isPending || !guest?.phone}
              onClick={() => reopen.mutate("whatsapp")}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm disabled:opacity-50"
            >
              <MessageCircle className="size-4" /> WhatsApp {guest?.phone ? "" : "(sem telefone)"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <KnowledgeFillDialog
        conversationId={conversationId}
        open={fillOpen}
        onOpenChange={setFillOpen}
        onApplied={() => {
          qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
          qc.invalidateQueries({ queryKey: ["handoff-list"] });
        }}
      />

      {/* Motivo do escalonamento + ações sugeridas */}
      <Dialog open={reasonOpen} onOpenChange={setReasonOpen}>
        <DialogContent className="max-w-md z-[2147483600]">
          <DialogHeader>
            <DialogTitle className="text-base">Por que a IA escalou</DialogTitle>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap rounded-lg border border-amber-500/30 bg-amber-500/10 text-foreground p-3">
            {conv?.handoff_reason}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">O que você quer fazer?</p>
          <div className="flex flex-col gap-2 mt-1">
            <button
              type="button"
              onClick={() => {
                setReasonOpen(false);
                setFillOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 text-sm"
            >
              <Sparkles className="size-4" /> Completar informação e responder
            </button>
            {!isMine && status !== "resolved" && (
              <button
                type="button"
                disabled={claim.isPending}
                onClick={() => {
                  setReasonOpen(false);
                  handleClaim();
                }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm disabled:opacity-50"
              >
                <UserPlus2 className="size-4" /> Assumir e responder
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (conv?.handoff_reason) navigator.clipboard?.writeText(conv.handoff_reason);
                setReasonOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border hover:bg-secondary text-sm"
            >
              <Copy className="size-4" /> Copiar motivo
            </button>
            {isMine && status !== "resolved" && (
              <button
                type="button"
                disabled={release.isPending}
                onClick={() => {
                  release.mutate();
                  setReasonOpen(false);
                }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border hover:bg-secondary text-sm disabled:opacity-50"
              >
                <Sparkles className="size-4" /> Devolver para a IA
              </button>
            )}
            {status !== "resolved" && (
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => {
                  resolve.mutate();
                  setReasonOpen(false);
                }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border hover:bg-secondary text-sm disabled:opacity-50"
              >
                <CheckCircle2 className="size-4" /> Marcar como resolvida
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {status !== "resolved" && !canChat && (
        <div className="shrink-0 border-t border-border p-3 text-center text-xs text-muted-foreground bg-surface flex items-center justify-center gap-2">
          <Lock className="size-3" />
          <span>
            Você não tem permissão para responder no chat. Peça ao dono da conta para habilitar em
            Administrativo → Permissões.
          </span>
        </div>
      )}
      {/* ------------------------------------------------------------------
          A PERGUNTA DA IA (11/09/2026)

          Toma o lugar que era do botão "Assumir": quando a IA perguntou algo,
          a ação principal da tela é RESPONDER A ELA, não assumir a conversa.
          Aparece para qualquer pessoa com permissão de chat — consultar não é
          tomar posse. Some sozinho quando respondido.
          ------------------------------------------------------------------ */}
      {status !== "resolved" && canChat && hasPendingAsk && (
        <div className="shrink-0 max-h-[60vh] overflow-y-auto border-t border-zinc-200 bg-white px-3 pb-2 pt-2.5">
          {pendingAsks.length > 1 && (
            <div className="mb-1.5 space-y-1.5">
              {pendingAsks
                .filter((e) => e.id !== pendingAsk?.id)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setOpenAskId(e.id)}
                    aria-expanded={false}
                    className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-left text-zinc-900 hover:bg-violet-100"
                  >
                    <Sparkles className="size-3.5 shrink-0 text-violet-700" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                      {e.question_to_human || "A IA precisa de uma decisão sua."}
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-violet-700" />
                  </button>
                ))}
            </div>
          )}
          {pendingAsk && (
          <div className="rounded-xl border border-violet-300 bg-violet-50 p-3 text-zinc-900">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.13em] text-violet-700">
              <Sparkles className="size-3" /> <span className="flex-1">a IA está te perguntando</span>
              {pendingAsks.length > 1 && (
                <button
                  type="button"
                  onClick={() => setOpenAskId(null)}
                  aria-label="Recolher pergunta"
                  aria-expanded
                  className="grid size-6 place-items-center rounded-full hover:bg-violet-100"
                >
                  <ChevronUp className="size-4" />
                </button>
              )}
            </div>
            <p className="text-[13px] font-semibold leading-snug text-zinc-900">
              {pendingAsk.question_to_human || "A IA precisa de uma decisão sua."}
            </p>
            {askSpec ? (
              <div className="mt-2.5 space-y-2.5">
                <div role="radiogroup" aria-label="Resposta" className="flex flex-wrap gap-1.5">
                  {askSpec.options.map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={chosenOption === o}
                      onClick={() => setChosenOption(o)}
                      className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                        chosenOption === o
                          ? "border-violet-600 bg-violet-600 text-white"
                          : "border-violet-300 bg-white text-violet-800 hover:bg-violet-100"
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
                {askNeedsKnowledge && chosenOption && (
                  <KnowledgeChoice value={saveKnowledge} onChange={setSaveKnowledge} scope={knowledgeScope} onScope={setKnowledgeScope} />
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => answer.mutate()}
                    disabled={
                      answer.isPending ||
                      !chosenOption ||
                      (askNeedsKnowledge && saveKnowledge === null) ||
                      (askNeedsKnowledge && saveKnowledge === true && knowledgeScope === null)
                    }
                    className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-45"
                  >
                    {answer.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    Enviar decisão
                  </button>
                </div>
              </div>
            ) : (
              <>
            <form
              className="mt-2.5 rounded-xl border border-zinc-300 bg-white p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!askText.trim() || answer.isPending) return;
                answer.mutate();
              }}
            >
              <textarea
                id="resposta-a-ia"
                value={askText}
                onChange={(e) => {
                  setAskText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
                }}
                ref={(el) => {
                  if (el) {
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
                  }
                }}
                disabled={askTranscribing}
                rows={2}
                placeholder={
                  askTranscribing
                    ? "Transcrevendo seu áudio…"
                    : "Responda à IA — ela leva ao hóspede na voz dela…"
                }
                className="block w-full min-w-0 resize-none whitespace-pre-wrap break-words bg-transparent px-1 text-[13px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-500"
              />
              <div className="mt-1.5 flex items-center justify-end gap-2">
                {askTranscribing ? (
                  <span className="grid size-8 shrink-0 place-items-center text-zinc-500">
                    <Loader2 className="size-4 animate-spin" />
                  </span>
                ) : askRecording ? (
                  <AudioRecorderButton
                    autoStart
                    compact
                    maxSeconds={120}
                    onRecorded={onAskRecorded}
                    onCancel={() => setAskRecording(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAskRecording(true)}
                    aria-label="Responder por áudio"
                    title="Responder por áudio"
                    className="grid size-8 shrink-0 place-items-center rounded-full border border-violet-300 text-violet-700 hover:bg-violet-100"
                  >
                    <Mic className="size-4" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={answer.isPending || !askText.trim() || askTranscribing || saveKnowledge === null || (saveKnowledge === true && knowledgeScope === null)}
                  aria-label="Enviar resposta"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-violet-600 text-white disabled:opacity-45"
                >
                  {answer.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </button>
              </div>
            </form>
                <div className="mt-2">
                  <KnowledgeChoice value={saveKnowledge} onChange={setSaveKnowledge} scope={knowledgeScope} onScope={setKnowledgeScope} />
                </div>
              </>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
<span />
              <button
                type="button"
                onClick={() => dismiss.mutate()}
                disabled={dismiss.isPending}
                className="text-[10.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Descartar pergunta
              </button>
            </div>
          </div>
          )}
        </div>
      )}

      {status !== "resolved" &&
        canChat &&
        (!isMine ? (
          <div
            className="shrink-0 border-t border-border p-3 text-center text-xs text-muted-foreground bg-surface flex items-center justify-center gap-2"
            style={{
              paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
              paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
              paddingRight: "max(0.75rem, env(safe-area-inset-right))",
            }}
          >
            <Lock className="size-3" />
            <span>
              {isLockedByOther ? (
                <>
                  Somente{" "}
                  <strong>{assignedProfile?.displayName ?? "o atendente responsável"}</strong> pode
                  responder — você acompanha em tempo real.
                </>
              ) : pendingAsk ? (
                // Com pergunta da IA na tela, falar direto é a SEGUNDA opção —
                // o texto e o peso do botão mudam para dizer isso.
                "Prefere falar você mesmo?"
              ) : (
                "Assuma a conversa para poder responder ao hóspede."
              )}
            </span>
            <button
              onClick={handleClaim}
              disabled={claim.isPending}
              className={
                pendingAsk
                  ? "ml-1 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-secondary"
                  : "ml-1 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground"
              }
            >
              <UserCheck className="size-3" /> {pendingAsk ? "Falar direto" : "Assumir"}
            </button>
          </div>
        ) : (
          <>
            {/* MODO DIRETO COM PRAZO (11/09/2026).
                A pausa deixou de ser eterna: 10 minutos, renovados a cada
                mensagem sua. Aqui ela fica VISÍVEL — antes, nada na tela dizia
                que a IA estava calada, e havia conversa muda desde 10/09. */}
            {pausaMinutos !== null && (
              <div className="shrink-0 border-t border-border bg-surface px-3 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-[11.5px]">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Lock className="size-3" />
                    Você está falando direto. A IA volta em{" "}
                    <strong className="tabular-nums text-foreground">{pausaMinutos} min</strong>.
                  </span>
                  <button
                    type="button"
                    onClick={() => release.mutate()}
                    disabled={release.isPending}
                    className="rounded-md border border-border px-2 py-0.5 text-[10.5px] hover:bg-surface-elevated"
                  >
                    Devolver agora
                  </button>
                </div>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim() || send.isPending) return;
                send.mutate();
              }}
              className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-surface px-3 pt-2"
              style={{
                // Só o rodapé precisa da área segura; laterais e topo saem das
                // classes compartilhadas, iguais às do Assistente.
                //
                // Pedido explícito (09/09/2026): "o rodapé com o teclado aberto
                // precisa ficar IDÊNTICO ao rodapé com o teclado fechado". Aqui
                // havia um `viewport.keyboardOpen ? …` que trocava a folga de
                // baixo — sobra da época em que o teclado ficava POR CIMA do
                // layout e a área segura era contada duas vezes. Com o
                // `interactive-widget=resizes-content` no viewport (ver
                // __root.tsx) a página encolhe de verdade, então a mesma medida
                // serve nos dois estados — e o rodapé para de "pular".
                paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
              }}
            >
              {uploading && (
                <div className="px-2 pb-1 text-[10px] text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" /> enviando anexo…
                </div>
              )}
              {note && (
                <div className="px-2 pb-1 text-[10px] text-yellow-700 inline-flex items-center gap-1">
                  <StickyNote className="size-3" /> nota interna (só a equipe vê)
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={onFilePicked}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*,video/*"
                  capture="environment"
                  className="hidden"
                  onChange={onFilePicked}
                />
                <ComposerPlusMenu
                  disabled={uploading}
                  onAttach={() => fileInputRef.current?.click()}
                  onCamera={() => cameraInputRef.current?.click()}
                />
                <div
                  className={`${COMPOSER_FIELD} !h-auto min-h-8 !items-end !rounded-2xl py-1.5 ${note ? "!border-yellow-500/50" : ""}`}
                >
                  <TagMentionTextarea
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      const el = e.target as HTMLTextAreaElement;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (text.trim()) send.mutate();
                      }
                    }}
                    items={tagItems}
                    placeholder={note ? "Nota interna…" : "Mensagem…"}
                    rows={1}
                    containerClassName="flex-1 min-w-0"
                    className={`${COMPOSER_INPUT} !max-h-40 whitespace-pre-wrap break-words border-0 px-0`}
                  />
                </div>

                <div className="shrink-0">
                  <AudioRecorderButton
                    disabled={uploading}
                    maxSeconds={60}
                    onRecorded={onAudioRecorded}
                    compact
                  />
                </div>
                <button
                  type="submit"
                  disabled={send.isPending || !text.trim()}
                  aria-label="Enviar mensagem"
                  className={`${COMPOSER_SEND_BTN} ${channel === "whatsapp" && !note ? "bg-emerald-600" : "bg-primary"}`}
                >
                  {send.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </button>
              </div>
            </form>
          </>
        ))}
    </div>
  );
}

type GuestDetail = {
  name: string | null;
  phone: string | null;
  phoneCountry: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
  reservationCode: string | null;
};

export function ConversationList({
  conversations,
  details,
  reservations,
  guideViewers,
  owners,
  activeId,
  onSelect,
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
    properties: { name: string | null } | { name: string | null }[] | null;
  }>;
  details?: Record<string, GuestDetail>;
  assignedNames?: Record<string, string>;
  reservations?: Record<
    string,
    {
      status: "confirmed" | "loose" | "missing" | "no_ical" | "cancelled";
      checkin: string | null;
      checkout: string | null;
      guests?: number | null;
    }
  >;
  /** Pessoas distintas que abriram o guia com o código da reserva (por conversa). */
  guideViewers?: Record<string, number>;
  /** Proprietário do imóvel de cada conversa — mesma fonte usada no Kanban. */
  owners?: Record<
    string,
    { name: string | null; phone: string | null; phoneCountry: string | null }
  >;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-2">
      {conversations.length === 0 && (
        <div className="p-4 text-xs text-muted-foreground text-center">Nenhuma conversa.</div>
      )}
      {conversations.map((c) => {
        const prop = Array.isArray(c.properties) ? c.properties[0] : c.properties;
        const isActive = c.id === activeId;
        const urgent = c.handoff_urgency === "high";
        const d = details?.[c.id];
        const owner = owners?.[c.id];
        const displayName = d?.name || c.guest_name || "Hóspede anônimo";
        const stay = buildStayView({
          detail: d ?? null,
          res: reservations?.[c.id] ?? null,
          viewers: guideViewers?.[c.id] ?? 0,
        });

        return (
          <div
            key={c.id}
            data-clip-row
            className={`relative flex shrink-0 snap-start flex-col gap-1 overflow-hidden rounded-[10px] border border-border py-2.5 pl-4 pr-3 transition-colors cursor-pointer ${
              isActive ? "bg-foreground/[0.07]" : "bg-foreground/[0.035] hover:bg-foreground/[0.06]"
            }`}
            onClick={() => onSelect(c.id)}
          >
            {/* Atendimento (mockup aprovado 16/10/2026): uma informação por linha, mesma ordem do
                card do Kanban — proprietário → imóvel → hóspede (+ pessoas do guia + etiqueta) →
                Período · Estadia · Reserva. A barra lateral e a etiqueta mostram a fase. */}
            <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${stayBarClass(stay)}`} />
            {owner?.name && (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="shrink truncate min-w-0 text-[11px] text-muted-foreground" title={owner.name}>
                  Proprietário: <b className="font-semibold text-foreground/85">{ownerLabel(owner.name)?.replace(/^Proprietário:\s*/, "")}</b>
                </span>
                <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <PhoneActionButton phone={owner.phone} country={owner.phoneCountry} size={11} />
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {shortAgo(c.handoff_at ?? c.last_message_at)}
                </span>
              </div>
            )}

            <div className="text-[11.5px] text-muted-foreground truncate">{prop?.name ?? "—"}</div>

            <div className="flex items-center gap-1.5 min-w-0">
              {urgent && <span className="size-2 rounded-full bg-red-500 shrink-0" />}
              <ChannelLogo channel={channelOf(null, (c as { guest_session_id?: string | null }).guest_session_id ?? null)} size={15} />
              <span className="shrink text-sm font-semibold truncate min-w-0" title={displayName}>
                {displayName}
              </span>
              {d?.phone && (
                <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <PhoneActionButton phone={d.phone} country={d.phoneCountry} size={12} />
                </span>
              )}
              <GuideViewers count={stay.viewers} />
              <StayTag stay={stay} />
            </div>

            <div className="my-0.5 h-px bg-border" />
            <StayLines stay={stay} size="sm" />
          </div>
        );
      })}
    </div>
  );
}

export function useMyUserId() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setId(data.user?.id ?? null));
  }, []);
  return id;
}

/** Pergunta explícita, sem opção pré-marcada: vira conhecimento? E onde vale? */
function KnowledgeChoice({
  value,
  onChange,
  scope,
  onScope,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  scope: "property" | "global" | null;
  onScope: (v: "property" | "global") => void;
}) {
  const pill = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-2">
      <div>
        <p className="text-[11.5px] font-semibold text-zinc-900">Salvar esta resposta como conhecimento da IA?</p>
        <div role="radiogroup" className="mt-1.5 flex flex-wrap gap-1.5">
          {pill(value === true, "Sim, salvar", () => onChange(true))}
          {pill(value === false, "Não, só desta vez", () => onChange(false))}
        </div>
      </div>
      {value === true && (
        <div>
          <p className="text-[11.5px] font-semibold text-zinc-900">Onde esse conhecimento vale?</p>
          <div role="radiogroup" className="mt-1.5 flex flex-wrap gap-1.5">
            {pill(scope === "property", "Apenas deste imóvel", () => onScope("property"))}
            {pill(scope === "global", "Global (todos os imóveis)", () => onScope("global"))}
          </div>
        </div>
      )}
    </div>
  );
}
