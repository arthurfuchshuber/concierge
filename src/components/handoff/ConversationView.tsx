import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
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
import { Send, UserCheck, RotateCcw, CheckCircle2, Loader2, StickyNote, Phone, Calendar, Hash, Lock, UserPlus2, ArrowRightLeft, X, Sparkles, Paperclip, MessageCircle, MessageSquare, Languages, Pencil, Trash2, MoreVertical, Copy, Camera } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reopenHandoffConversation } from "@/lib/handoff.functions";
import { sendWhatsappFromConversation } from "@/lib/whatsapp.functions";
import { translateMessage } from "@/lib/translate.functions";
import { detectLanguage, userLanguage, LANG_NAMES } from "@/lib/lang-detect";
import { TagMentionTextarea, type TagMentionItem } from "@/components/tags/TagMentionTextarea";
import { getTagItemsForConversation } from "@/lib/guide-tag-items.functions";
import { TeachAiDialog } from "@/components/handoff/TeachAiDialog";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import { AttachmentBubble, type AttachmentInfo } from "@/components/handoff/AttachmentBubble";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useMyPermissions } from "@/hooks/useMyPermissions";


type Props = { conversationId: string; compact?: boolean; myUserId: string | null };

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

export function ConversationView({ conversationId, compact, myUserId }: Props) {
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
  const [channel, setChannel] = useState<"chat" | "whatsapp">("chat");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ id: string; content: string; mine: boolean } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLongPress = (m: { id: string; content: string; mine: boolean }) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => setActionMsg(m), 450);
  };
  const cancelLongPress = () => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  };
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachSource, setTeachSource] = useState<{ id: string; content: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const editFn = useServerFn(editHandoffMessage);
  const deleteFn = useServerFn(deleteHandoffMessage);
  const reopenFn = useServerFn(reopenHandoffConversation);
  const sendWaFn = useServerFn(sendWhatsappFromConversation);

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
      const r = await translateFn({ data: { text: content.slice(0, 4000), targetLang: myLang } });
      setTranslations((p) => ({ ...p, [id]: { text: r.translated, loading: false, showing: true } }));
    } catch (e) {
      setTranslations((p) => ({ ...p, [id]: { text: null, loading: false, showing: false } }));
      setErrorMsg(e instanceof Error ? e.message : "Não consegui traduzir agora.");
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
      .on("postgres_changes", { event: "*", schema: "public", table: "property_chat_messages", filter: `conversation_id=eq.${conversationId}` }, () => {
        qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "property_chat_conversations", filter: `id=eq.${conversationId}` }, () => {
        qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, qc]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
    qc.invalidateQueries({ queryKey: ["handoff-list"] });
    qc.invalidateQueries({ queryKey: ["handoff-pending-count"] });
  };

  const send = useMutation({
    mutationFn: async () =>
      channel === "whatsapp" && !note
        ? sendWaFn({ data: { conversationId, text: text.trim() } })
        : sendFn({ data: { conversationId, content: text.trim(), internalNote: note } }),
    onSuccess: () => { setText(""); invalidateAll(); },
    onError: (e) => setErrorMsg((e as Error).message),
  });
  const reopen = useMutation({
    mutationFn: async (ch: "chat" | "whatsapp") => {
      await reopenFn({ data: { conversationId } });
      return ch;
    },
    onSuccess: (ch) => { setChannel(ch); setReopenOpen(false); invalidateAll(); },
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
    onSuccess: () => { setTransferOpen(false); invalidateAll(); },
    onError: (e) => setErrorMsg((e as Error).message),
  });
  const editMsg = useMutation({
    mutationFn: async (v: { messageId: string; content: string }) =>
      editFn({ data: { conversationId, messageId: v.messageId, content: v.content } }),
    onSuccess: () => { setEditingId(null); setEditingText(""); invalidateAll(); },
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
        type === "image" ? (mime.split("/")[1] ?? "jpg").replace("jpeg", "jpg") :
        type === "audio" ? (mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : "webm") :
        type === "video" ? (mime.split("/")[1] ?? "mp4") :
        "pdf";
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
  const guest = q.data?.guestDetails;
  const claimReq = q.data?.claimRequester;
  const assignedProfile = q.data?.assignedProfile;
  const senderProfiles = (q.data as { senderProfiles?: Record<string, { displayName: string | null }> } | undefined)?.senderProfiles ?? {};
  const propertyName = (conv?.properties as { name?: string } | null)?.name ?? "Guia";
  const isMine = !!(conv?.assigned_to && myUserId && conv.assigned_to === myUserId);
  const isLockedByOther = !!(conv?.assigned_to && myUserId && conv.assigned_to !== myUserId);
  const isUnassigned = !conv?.assigned_to;
  const iRequested = !!(conv?.claim_requested_by && myUserId && conv.claim_requested_by === myUserId);
  const someoneRequestedFromMe = !!(isMine && conv?.claim_requested_by && conv.claim_requested_by !== myUserId);
  const status = conv?.status;

  const guestName = guest?.name ?? conv?.guest_name ?? "Hóspede anônimo";
  const waHref = guest?.phone ? whatsappHref(guest.phone, guest.phoneCountry) : null;
  const checkinFmt = fmtCheckin(guest?.checkinDate ?? null);
  const checkoutFmt = fmtCheckin((guest as { checkoutDate?: string | null } | undefined)?.checkoutDate ?? null);


  function handleClaim() {
    if (isLockedByOther) {
      const who = assignedProfile?.displayName ?? "outro membro";
      const ok = typeof window !== "undefined" && window.confirm(`Esta conversa está sendo atendida por ${who}. Tem certeza que deseja assumir?`);
      if (!ok) return;
    }
    claim.mutate();
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 bg-white text-zinc-900"
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
      }}
    >
      <div className="border-b border-zinc-200 p-3 space-y-2 shrink-0 bg-zinc-50">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{guestName}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {propertyName}
              {conv?.handoff_at ? ` · ${formatDistanceToNow(new Date(conv.handoff_at), { locale: ptBR, addSuffix: true })}` : ""}
            </div>

            {(waHref || checkinFmt || checkoutFmt || guest?.reservationCode) && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {waHref && (
                  <a href={waHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-600 hover:underline">
                    <Phone className="size-3" /> {formatIntlPhone(guest?.phone, guest?.phoneCountry)}
                  </a>
                )}
                {checkinFmt && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="size-3" /> Check-in {checkinFmt}
                  </span>
                )}
                {checkoutFmt && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="size-3" /> Check-out {checkoutFmt}
                  </span>
                )}

                {guest?.reservationCode && (
                  <span className="inline-flex items-center gap-1">
                    <Hash className="size-3" /> {guest.reservationCode}
                    <CopyButton value={guest.reservationCode} size={11} />
                  </span>
                )}
              </div>
            )}

            {conv?.handoff_reason && (
              <div className="text-[11px] mt-2 px-2 py-1 rounded bg-amber-500/10 text-amber-700 border border-amber-500/30 line-clamp-2">
                {conv.handoff_reason}
              </div>
            )}

            {isLockedByOther && (
              <div className="text-[11px] mt-2 px-2 py-1 rounded bg-secondary text-foreground/80 border border-border inline-flex items-center gap-1">
                <Lock className="size-3" /> Em atendimento por {assignedProfile?.displayName ?? "outro membro"}
              </div>
            )}
            {someoneRequestedFromMe && (
              <div className="text-[11px] mt-2 px-2 py-1 rounded bg-primary/10 text-primary border border-primary/30 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1"><UserPlus2 className="size-3" /> {claimReq?.displayName ?? "Um membro"} pediu acesso</span>
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
                  <DropdownMenuItem onSelect={() => setReopenOpen(true)}>
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
                    <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setTransferOpen((v) => !v); }}>
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
            <span className="inline-flex items-center gap-1"><MessageCircle className="size-3" /> Enviando pelo WhatsApp do hóspede</span>
            <button onClick={() => setChannel("chat")} className="underline">usar chat</button>
          </div>
        )}

        {transferOpen && isMine && (
          <div className="rounded-md border border-border bg-background p-2 space-y-1">
            <div className="text-[11px] text-muted-foreground px-1">Transferir para:</div>
            {targetsQ.isLoading && <div className="text-xs text-muted-foreground px-1 py-1"><Loader2 className="size-3 animate-spin inline mr-1" /> Carregando…</div>}
            {targetsQ.data?.targets.length === 0 && <div className="text-xs text-muted-foreground px-1 py-1">Nenhum outro membro disponível.</div>}
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
            <button onClick={() => setErrorMsg(null)}><X className="size-3" /></button>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0 bg-transparent">
        {q.isLoading && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="size-3 animate-spin" /> Carregando…</div>}
        {msgs.map((m) => {
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
              }
            : null;
          return (
            <div key={m.id} className={`flex flex-col ${isGuest ? "items-start" : "items-end"}`}>
              <div
                onPointerDown={() => startLongPress({ id: m.id, content: m.content ?? "", mine: !isGuest })}
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
                {isNote && <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1 flex items-center gap-1"><StickyNote className="size-3" /> Nota interna</div>}
                {!isNote && !isGuest && (
                  <div className="text-[11px] mb-1">
                    {m.sender_type === "human" ? (
                      <span className="font-bold">
                        {(m.sender_user_id && senderProfiles[m.sender_user_id]?.displayName) || "Atendente"}
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
                        onClick={() => { setEditingId(null); setEditingText(""); }}
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
                <div className="text-[10px] opacity-60 mt-1">
                  {formatDistanceToNow(new Date(m.created_at), { locale: ptBR, addSuffix: true })}
                  {m.edited_at ? " · editada" : ""}
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
                    {tr?.loading ? <Loader2 className="size-3 animate-spin" /> : <Languages className="size-3" />}
                    {tr?.showing ? "Ver original" : "Traduzir"}
                  </button>
                )}
                {canTeach && conv?.property_id && (
                  <button
                    type="button"
                    onClick={() => { setTeachSource({ id: m.id, content: m.content }); setTeachOpen(true); }}
                    className="mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title="Adicionar este conteúdo à base de conhecimento da IA"
                  >
                    <Sparkles className="size-3" /> Ensinar IA
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>


      {conv?.property_id && teachSource && (
        <TeachAiDialog
          open={teachOpen}
          onOpenChange={(v) => { setTeachOpen(v); if (!v) setTeachSource(null); }}
          propertyId={conv.property_id as string}
          propertyName={propertyName}
          initialContent={teachSource.content}
          sourceMessageId={teachSource.id}
        />
      )}

      {/* Ações da mensagem (segurar para abrir, como no WhatsApp) */}
      <Dialog open={!!actionMsg} onOpenChange={(v) => { if (!v) setActionMsg(null); }}>
        <DialogContent className="max-w-xs">
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
                    if (actionMsg) { setEditingId(actionMsg.id); setEditingText(actionMsg.content); }
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
        <DialogContent className="max-w-sm">
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



      {status !== "resolved" && !canChat && (
        <div className="shrink-0 border-t border-border p-3 text-center text-xs text-muted-foreground bg-surface flex items-center justify-center gap-2">
          <Lock className="size-3" />
          <span>Você não tem permissão para responder no chat. Peça ao dono da conta para habilitar em Administrativo → Permissões.</span>
        </div>
      )}
      {status !== "resolved" && canChat && (

        !isMine ? (
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
              {isLockedByOther
                ? <>Somente <strong>{assignedProfile?.displayName ?? "o atendente responsável"}</strong> pode responder — você acompanha em tempo real.</>
                : "Assuma a conversa para poder responder ao hóspede."}
            </span>
            <button
              onClick={handleClaim}
              disabled={claim.isPending}
              className="ml-1 text-[11px] px-2 py-1 rounded-md bg-primary text-primary-foreground inline-flex items-center gap-1"
            >
              <UserCheck className="size-3" /> Assumir
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim() || send.isPending) return;
              send.mutate();
            }}
            className="shrink-0 border-t border-border bg-surface"
            style={{
              paddingTop: "0.5rem",
              paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
              paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
              paddingRight: "max(0.5rem, env(safe-area-inset-right))",
            }}
          >
            {uploading && (
              <div className="px-2 pb-1 text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" /> enviando anexo…
              </div>
            )}
            <div className="flex items-end gap-1">
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
              <div className="flex-1 min-w-0 flex items-end gap-0.5 rounded-full border border-border bg-background pl-2 pr-1 py-0.5">
                <button
                  type="button"
                  onClick={() => setNote((v) => !v)}
                  title="Nota interna"
                  aria-label="Nota interna"
                  className={`grid size-8 place-items-center rounded-full shrink-0 ${note ? "bg-yellow-500/20 text-yellow-700" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                >
                  <StickyNote className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Anexar arquivo"
                  aria-label="Anexar arquivo"
                  className="grid size-8 place-items-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
                >
                  <Paperclip className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={uploading}
                  title="Tirar foto ou vídeo"
                  aria-label="Tirar foto ou vídeo"
                  className="grid size-8 place-items-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
                >
                  <Camera className="size-4" />
                </button>
                <TagMentionTextarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (text.trim()) send.mutate();
                    }
                  }}
                  items={tagItems}
                  placeholder={note ? "Nota interna…" : channel === "whatsapp" ? "Mensagem via WhatsApp…" : "Mensagem… (@ linka o guia)"}
                  rows={1}
                  containerClassName="flex-1 min-w-0"
                  className="w-full resize-none bg-transparent border-0 px-1 py-2 text-sm outline-none focus:ring-0 min-w-0 max-h-28"
                />
                <AudioRecorderButton
                  disabled={uploading}
                  maxSeconds={60}
                  onRecorded={onAudioRecorded}
                />
              </div>

              <button
                type="submit"
                disabled={!text.trim() || send.isPending}
                className={`size-10 grid place-items-center rounded-full text-white disabled:opacity-40 shrink-0 ${channel === "whatsapp" && !note ? "bg-emerald-600" : "bg-primary"}`}
              >
                {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
          </form>
        )
      )}
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
  assignedNames,
  reservations,
  activeId,
  onSelect,
}: {
  conversations: Array<{
    id: string; guest_name: string | null; status: string; handoff_at: string | null; last_message_at: string; handoff_urgency: string | null; handoff_reason: string | null;
    assigned_to?: string | null;
    properties: { name: string | null } | { name: string | null }[] | null;
  }>;
  details?: Record<string, GuestDetail>;
  assignedNames?: Record<string, string>;
  reservations?: Record<string, { status: "confirmed" | "loose" | "missing" | "no_ical"; checkin: string | null; checkout: string | null }>;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {

  return (
    <div className="flex flex-col divide-y divide-border">
      {conversations.length === 0 && (
        <div className="p-4 text-xs text-muted-foreground text-center">Nenhuma conversa.</div>
      )}
      {conversations.map((c) => {
        const prop = Array.isArray(c.properties) ? c.properties[0] : c.properties;
        const isActive = c.id === activeId;
        const urgent = c.handoff_urgency === "high";
        const d = details?.[c.id];
        const displayName = d?.name || c.guest_name || "Hóspede anônimo";
        const wa = d?.phone ? whatsappHref(d.phone, d.phoneCountry) : null;
        const checkin = fmtCheckin(d?.checkinDate ?? null);
        const checkout = fmtCheckin(d?.checkoutDate ?? null);
        const withWhom = c.assigned_to ? (assignedNames?.[c.id] ?? "outro membro") : null;
        const res = reservations?.[c.id];


        return (
          <div
            key={c.id}
            className={`px-3 py-2.5 hover:bg-secondary transition-colors cursor-pointer ${isActive ? "bg-secondary" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="flex items-center gap-2">
              {urgent && <span className="size-2 rounded-full bg-red-500 shrink-0" />}
              <div className="text-sm font-medium truncate flex-1">{displayName}</div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatDistanceToNow(new Date(c.handoff_at ?? c.last_message_at), { locale: ptBR, addSuffix: false })}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{prop?.name ?? "—"}</div>
            {(wa || checkin || checkout || d?.reservationCode) && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                {wa && (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-emerald-600 hover:underline"
                  >
                    <Phone className="size-3" /> {formatIntlPhone(d?.phone, d?.phoneCountry)}
                  </a>
                )}
                {checkin && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="size-3" /> In {checkin}
                  </span>
                )}
                {checkout && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="size-3" /> Out {checkout}
                  </span>
                )}

                {d?.reservationCode && (
                  <span className="inline-flex items-center gap-1">
                    <Hash className="size-3" /> {d.reservationCode}
                    <CopyButton value={d.reservationCode} size={11} />
                  </span>
                )}
              </div>
            )}
            {withWhom && (
              <div className="text-[11px] mt-0.5 inline-flex items-center gap-1 text-primary">
                <UserCheck className="size-3" /> Com {withWhom}
              </div>
            )}
            {res && res.status !== "no_ical" && (
              <div className="mt-0.5">
                {res.status === "confirmed" && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    ✓ Reserva confirmada
                  </span>
                )}
                {res.status === "loose" && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠ Datas divergem do Airbnb
                  </span>
                )}
                {res.status === "missing" && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠ Sem reserva Airbnb
                  </span>
                )}
              </div>
            )}
            {c.handoff_reason && <div className="text-[11px] text-foreground/70 truncate mt-0.5">{c.handoff_reason}</div>}

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
