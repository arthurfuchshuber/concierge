import { useEffect, useRef, useState } from "react";
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
} from "@/lib/handoff.functions";
import { attachStaffMessage } from "@/lib/chat-attachments.functions";
import { Send, UserCheck, RotateCcw, CheckCircle2, Loader2, StickyNote, Phone, Calendar, Hash, Lock, UserPlus2, ArrowRightLeft, X, Sparkles, Paperclip, MessageCircle } from "lucide-react";
import { WhatsappComposerDialog } from "@/components/whatsapp/WhatsappComposerDialog";
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
    refetchInterval: 8000,
  });

  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachSource, setTeachSource] = useState<{ id: string; content: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    mutationFn: async () => sendFn({ data: { conversationId, content: text.trim(), internalNote: note } }),
    onSuccess: () => { setText(""); invalidateAll(); },
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

          <div className="flex flex-col gap-1 shrink-0 items-end">
            {/* Livre → assumir */}
            {(isUnassigned && status !== "resolved") && (
              <button onClick={handleClaim} disabled={claim.isPending} className="text-xs px-2 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1">
                <UserCheck className="size-3" /> Assumir
              </button>
            )}
            {/* Travada por outro → assumir (com confirmação) + pedir acesso */}
            {isLockedByOther && status !== "resolved" && (
              <button onClick={handleClaim} disabled={claim.isPending} className="text-xs px-2 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1">
                <UserCheck className="size-3" /> Assumir
              </button>
            )}
            {isLockedByOther && !iRequested && status !== "resolved" && (
              <button onClick={() => requestClaim.mutate()} disabled={requestClaim.isPending} className="text-xs px-2 py-1.5 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1">
                <UserPlus2 className="size-3" /> Solicitar acesso
              </button>
            )}
            {isLockedByOther && iRequested && (
              <button onClick={() => cancelRequest.mutate()} disabled={cancelRequest.isPending} className="text-xs px-2 py-1.5 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1">
                <X className="size-3" /> Cancelar solicitação
              </button>
            )}
            {/* É minha → transferir / devolver IA */}
            {isMine && status !== "resolved" && (
              <>
                <button onClick={() => setTransferOpen((v) => !v)} className="text-xs px-2 py-1.5 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1">
                  <ArrowRightLeft className="size-3" /> Transferir
                </button>
                <button onClick={() => release.mutate()} disabled={release.isPending} className="text-xs px-2 py-1.5 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1" title="Devolver à IA">
                  <RotateCcw className="size-3" /> IA
                </button>
              </>
            )}
            {guest?.phone && canChat && (
              <button
                onClick={() => setWaOpen(true)}
                className="text-xs px-2 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1"
                title="Enviar mensagem por WhatsApp"
              >
                <MessageCircle className="size-3" /> WhatsApp
              </button>
            )}
            {status !== "resolved" && (isMine || !conv?.assigned_to) && (
              <button onClick={() => resolve.mutate()} disabled={resolve.isPending} className="text-xs px-2 py-1.5 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1">
                <CheckCircle2 className="size-3" /> Resolver
              </button>
            )}
          </div>
        </div>

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
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
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
                {m.content && <>{m.content}</>}
                <div className="text-[10px] opacity-60 mt-1">
                  {formatDistanceToNow(new Date(m.created_at), { locale: ptBR, addSuffix: true })}
                </div>
              </div>
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
                ? <>Somente <strong>{assignedProfile?.displayName ?? "o atendente responsável"}</strong> pode responder.</>
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
            <div className="flex items-center gap-2 mb-1">
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 select-none">
                <input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} className="size-3" />
                nota
              </label>
              {uploading && <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> enviando anexo…</span>}
            </div>
            <div className="flex items-end gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={onFilePicked}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Anexar arquivo"
                aria-label="Anexar arquivo"
                className="grid size-9 place-items-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
              >
                <Paperclip className="size-4" />
              </button>
              <AudioRecorderButton
                disabled={uploading}
                maxSeconds={60}
                onRecorded={onAudioRecorded}
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (text.trim()) send.mutate();
                  }
                }}
                placeholder={note ? "Nota interna (não visível ao hóspede)…" : "Escrever para o hóspede…"}
                rows={compact ? 1 : 2}
                className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40 min-w-0"
              />
              <button
                type="submit"
                disabled={!text.trim() || send.isPending}
                className="size-9 grid place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40 shrink-0"
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
