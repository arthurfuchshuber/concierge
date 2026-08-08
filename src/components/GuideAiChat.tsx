import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircleMore, Send, X, Loader2, Paperclip } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GuestNotificationsPrompt } from "@/components/GuestNotificationsPrompt";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import { AttachmentBubble, type AttachmentInfo } from "@/components/handoff/AttachmentBubble";
import { readAccessRecord } from "@/components/GuideAccessGate";
import { metaPixelTrackCustom } from "@/lib/meta-pixel";
import { translateMessage } from "@/lib/translate.functions";
import { detectLanguage, userLanguage } from "@/lib/lang-detect";

type Msg = {
  role: "user" | "assistant" | "system";
  content: string;
  id?: string;
  createdAt?: string;
  senderType?: string;
  attachment?: AttachmentInfo | null;
};

function getSessionId(slug: string): string {
  const key = `guide-chat-session:${slug}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function loadCachedMessages(slug: string): { conversationId?: string; messages: Msg[] } {
  if (typeof window === "undefined") return { messages: [] };
  try {
    const raw = window.localStorage.getItem(`guide-chat-thread:${slug}`);
    if (!raw) return { messages: [] };
    const parsed = JSON.parse(raw) as { conversationId?: string; messages: Msg[] };
    return { conversationId: parsed.conversationId, messages: parsed.messages ?? [] };
  } catch {
    return { messages: [] };
  }
}

function saveCachedMessages(slug: string, conversationId: string | undefined, messages: Msg[]) {
  try {
    window.localStorage.setItem(
      `guide-chat-thread:${slug}`,
      JSON.stringify({ conversationId, messages: messages.slice(-30) }),
    );
  } catch {
    // ignore
  }
}

// Returns a time-of-day greeting and context hint based on current hour
function getTimeContext(): { greeting: string; hint: string } {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { greeting: "Bom dia", hint: "Posso sugerir cafés, padarias e um roteiro leve para começar bem o dia." };
  if (h >= 12 && h < 18) return { greeting: "Boa tarde", hint: "Posso indicar restaurantes abertos agora, passeios próximos e experiências para hoje." };
  if (h >= 18 && h < 23) return { greeting: "Boa noite", hint: "Posso recomendar jantar, drinks, delivery ou um programa especial perto daqui." };
  return { greeting: "Olá", hint: "Posso resolver dúvidas da estadia e sugerir boas escolhas ao seu redor." };
}

export function GuideAiChat({ slug, propertyName, guestName }: { slug: string; propertyName: string; guestName?: string | null }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  // Mensagens do atendente sempre no idioma do hóspede.
  const [autoTranslated, setAutoTranslated] = useState<Record<string, string>>({});
  const translatingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const myLang = userLanguage();
    const pending = messages.filter(
      (m) =>
        m.id &&
        m.senderType === "human" &&
        (m.content ?? "").trim().length > 2 &&
        !autoTranslated[m.id] &&
        !translatingRef.current.has(m.id) &&
        (() => {
          const d = detectLanguage(m.content);
          return Boolean(d && d !== myLang);
        })(),
    );
    if (!pending.length) return;
    pending.forEach(async (m) => {
      const id = m.id as string;
      translatingRef.current.add(id);
      try {
        const r = await translateMessage({ data: { text: m.content.slice(0, 2000), targetLang: myLang } });
        setAutoTranslated((p) => ({ ...p, [id]: r.translated }));
      } catch {
        /* mantém o original */
      }
    });
  }, [messages, autoTranslated]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const forceAiNextRef = useRef(false);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  const { greeting, hint } = getTimeContext();

  // Draggable launcher position (persistent). side + distance from bottom in px.
  const [pos, setPos] = useState<{ side: "left" | "right"; bottom: number }>(() => {
    if (typeof window === "undefined") return { side: "right", bottom: 96 };
    try {
      const raw = window.localStorage.getItem("guide-chat-pos");
      if (raw) {
        const p = JSON.parse(raw);
        if ((p.side === "left" || p.side === "right") && typeof p.bottom === "number") return p;
      }
    } catch { /* ignore */ }
    return { side: "right", bottom: 96 };
  });
  const [dragOffset, setDragOffset] = useState<{ dy: number } | null>(null);
  const dragStateRef = useRef<{
    x: number; y: number; moved: boolean; pointerId: number;
    startRect: DOMRect;
    button: HTMLButtonElement;
    move: (ev: PointerEvent) => void;
    up: (ev: PointerEvent) => void;
  } | null>(null);
  const justDraggedRef = useRef(false);

  function handleLauncherPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const button = e.currentTarget;
    const startRect = button.getBoundingClientRect();
    const state = {
      x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId,
      startRect, button,
      move: (ev: PointerEvent) => {
        if (ev.pointerId !== state.pointerId) return;
        const dx = ev.clientX - state.x;
        const dy = ev.clientY - state.y;
        if (!state.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) state.moved = true;
        if (state.moved) {
          ev.preventDefault();
          setDragOffset({ dy });
        }
      },
      up: (ev: PointerEvent) => {
        if (ev.pointerId !== state.pointerId) return;
        window.removeEventListener("pointermove", state.move);
        window.removeEventListener("pointerup", state.up);
        window.removeEventListener("pointercancel", state.up);
        dragStateRef.current = null;
        if (state.moved) {
          const dy = ev.clientY - state.y;
          const newTop = state.startRect.top + dy;
          const bottomPx = Math.max(24, Math.min(
            window.innerHeight - state.startRect.height - 24,
            window.innerHeight - (newTop + state.startRect.height),
          ));
          const next = { side: pos.side, bottom: bottomPx };
          setPos(next);
          setDragOffset(null);
          try { window.localStorage.setItem("guide-chat-pos", JSON.stringify(next)); } catch { /* ignore */ }
          justDraggedRef.current = true;
          window.setTimeout(() => { justDraggedRef.current = false; }, 80);
        } else {
          setDragOffset(null);
        }
      },
    };
    dragStateRef.current = state;
    window.addEventListener("pointermove", state.move, { passive: false });
    window.addEventListener("pointerup", state.up);
    window.addEventListener("pointercancel", state.up);
  }


  useEffect(() => {
    setMounted(true);
  }, []);


  useEffect(() => {
    setSessionId(getSessionId(slug));
    const cached = loadCachedMessages(slug);
    setConversationId(cached.conversationId);
    setMessages(cached.messages);
    // Manifestação persiste até o hóspede fechar (X) OU abrir o chat pela primeira vez.
    // Uma vez dispensada, não volta a aparecer (persistente entre sessões).
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(`guide-chat-nudge-dismissed:${slug}`) === "1";
    } catch {
      // ignore
    }
    if (dismissed) return;
    const t = setTimeout(() => setShowNudge(true), 2800);
    return () => clearTimeout(t);
  }, [slug]);

  function persistDismissed() {
    try {
      window.localStorage.setItem(`guide-chat-nudge-dismissed:${slug}`, "1");
    } catch {
      // ignore
    }
  }

  function dismissNudge() {
    setShowNudge(false);
    persistDismissed();
  }


  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages, loading]);

  useEffect(() => {
    if (open) {
      setHasOpened(true);
      setShowNudge(false);
      setPendingPreview(null);
      persistDismissed();
      setTimeout(() => inputRef.current?.focus(), 80);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Permite abrir o chat via evento global disparado da home (bolha do concierge, sugestões).
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ prompt?: string; forceAi?: boolean }>).detail;
      if (detail?.prompt) setInput(detail.prompt);
      forceAiNextRef.current = !!detail?.forceAi;
      // Não forçamos setHumanMode(false): se um humano assumiu a conversa,
      // o servidor mantém o modo humano e responderá com humanMode:true.

      setOpen(true);
    }
    window.addEventListener("open-guide-chat", onOpen as EventListener);
    return () => window.removeEventListener("open-guide-chat", onOpen as EventListener);
  }, []);

  const [humanMode, setHumanMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFetchedAtRef = useRef<string | undefined>(undefined);

  async function uploadGuestAttachment(blob: Blob, opts: { filename: string; mime: string; durationMs?: number }) {
    if (!conversationId) {
      setUploadErr("Envie primeiro uma mensagem para o atendente humano.");
      return;
    }
    if (!humanMode) {
      setUploadErr("Anexos só ficam disponíveis durante o atendimento humano.");
      return;
    }
    if (blob.size > 20 * 1024 * 1024) {
      setUploadErr("Arquivo maior que 20 MB.");
      return;
    }
    setUploading(true);
    setUploadErr(null);
    try {
      const form = new FormData();
      form.append("slug", slug);
      form.append("sessionId", sessionId);
      form.append("conversationId", conversationId);
      if (opts.durationMs != null) form.append("durationMs", String(opts.durationMs));
      const file = new File([blob], opts.filename, { type: opts.mime });
      form.append("file", file);
      const res = await fetch("/api/public/guide-chat-upload", { method: "POST", body: form });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Falha ao enviar anexo.");
      }
      const data = (await res.json()) as {
        id: string;
        path: string;
        url: string | null;
        type: "image" | "audio" | "video" | "document";
        mime: string;
        durationMs: number | null;
        name: string | null;
      };
      const msg: Msg = {
        role: "user",
        content: "",
        id: data.id,
        senderType: "guest",
        attachment: {
          type: data.type,
          mime: data.mime,
          durationMs: data.durationMs,
          sizeBytes: blob.size,
          name: data.name,
          url: data.url,
        },
      };
      const merged = [...messages, msg];
      setMessages(merged);
      saveCachedMessages(slug, conversationId, merged);
    } catch (e) {
      setUploadErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onGuestFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    await uploadGuestAttachment(f, { filename: f.name, mime: f.type });
  }

  async function onGuestAudio(audio: RecordedAudio) {
    const ext = audio.mime.includes("mp4") ? "m4a" : "webm";
    await uploadGuestAttachment(audio.blob, {
      filename: `audio-${Date.now()}.${ext}`,
      mime: audio.mime,
      durationMs: audio.durationMs,
    });
  }


  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    const forceAi = forceAiNextRef.current;
    forceAiNextRef.current = false;
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const effectiveGuestName = guestName ?? readAccessRecord(slug)?.name ?? undefined;
      const res = await fetch("/api/public/guide-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, sessionId, conversationId, message: text, guestName: effectiveGuestName, forceAi: forceAi || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { conversationId?: string; reply?: string; error?: string; handoff?: boolean; humanMode?: boolean };
      if (!res.ok) {
        const errMsg = data.error || "Não consegui responder agora.";
        const updated = [...next, { role: "assistant" as const, content: errMsg }];
        setMessages(updated);
        if (data.conversationId) setConversationId(data.conversationId);
        saveCachedMessages(slug, data.conversationId ?? conversationId, updated);
        return;
      }
      if (data.conversationId) setConversationId(data.conversationId);
      if (data.humanMode) {
        setHumanMode(true);
        // Add a one-time system note so the guest sees why the AI didn't answer.
        const alreadyNoted = next.some((m) => m.role === "system" && m.content.startsWith("Um atendente humano"));
        const updated = alreadyNoted
          ? next
          : [...next, { role: "system" as const, content: "Um atendente humano vai responder por aqui em instantes." }];
        setMessages(updated);
        saveCachedMessages(slug, data.conversationId ?? conversationId, updated);
      } else {
        const replyText = data.reply || "";
        const updated = [...next, { role: "assistant" as const, content: replyText }];
        setMessages(updated);
        saveCachedMessages(slug, data.conversationId ?? conversationId, updated);
        if (!openRef.current && replyText.trim()) setPendingPreview(replyText);
      }

      // Advance the polling cursor past the just-persisted user+AI rows so the
      // next poll doesn't re-append the AI reply we already rendered optimistically.
      lastFetchedAtRef.current = new Date().toISOString();
    } catch {
      const updated = [...next, { role: "assistant" as const, content: "Sem conexão. Tente novamente." }];
      setMessages(updated);
      saveCachedMessages(slug, conversationId, updated);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }

  // Poll for new agent/AI messages when we have a conversation. Ensures human
  // replies after handoff show up in the guest widget without a reload.
  useEffect(() => {
    if (!conversationId || !sessionId) return;
    let cancelled = false;
    async function poll() {
      try {
        const params = new URLSearchParams({ conversationId: conversationId!, sessionId });
        if (lastFetchedAtRef.current) params.set("since", lastFetchedAtRef.current);
        const res = await fetch(`/api/public/guide-chat?${params.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          humanMode?: boolean;
          messages?: {
            id: string;
            role: string;
            content: string;
            senderType?: string;
            createdAt: string;
            attachment?: AttachmentInfo | null;
          }[];
        };
        if (cancelled) return;
        if (typeof data.humanMode === "boolean") setHumanMode(data.humanMode);
        const incoming = (data.messages ?? []).filter(
          (m) => m.senderType === "human" || (m.senderType === "ai" && lastFetchedAtRef.current), // skip AI backfill on first load
        );
        if (incoming.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((p) => p.id).filter(Boolean));
            // Fallback dedupe for optimistic assistant messages that were appended
            // without an id (send() pushes `{ role, content }`). Match by content
            // against the tail so the polled copy of the same reply doesn't duplicate.
            const recentContents = new Set(
              prev.slice(-6).filter((p) => !p.id && p.role === "assistant").map((p) => (p.content || "").trim()),
            );
            const additions = incoming
              .filter(
                (m) =>
                  !seen.has(m.id) &&
                  (m.content?.trim() || m.attachment) &&
                  !(m.senderType === "ai" && recentContents.has((m.content || "").trim())),
              )
              .map((m) => ({
                role: "assistant" as const,
                content: m.content,
                id: m.id,
                createdAt: m.createdAt,
                senderType: m.senderType,
                attachment: m.attachment ?? null,
              }));
            if (!additions.length) return prev;
            const merged = [...prev, ...additions];
            saveCachedMessages(slug, conversationId, merged);
            if (!openRef.current) {
              const lastText = additions[additions.length - 1]?.content?.trim();
              if (lastText) setPendingPreview(lastText);
            }
            return merged;
          });
        }
        const latest = (data.messages ?? []).at(-1)?.createdAt;
        if (latest) lastFetchedAtRef.current = latest;
      } catch {
        // ignore transient poll errors
      }
    }
    // First poll: initialize the cursor to "now" so we don't re-append stale AI
    // messages already cached in localStorage, but still catch anything newer.
    if (!lastFetchedAtRef.current) lastFetchedAtRef.current = new Date().toISOString();
    const interval = open || humanMode ? 4000 : 15000;
    poll();
    const t = window.setInterval(poll, interval);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [conversationId, sessionId, open, humanMode, slug]);

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!mounted || typeof document === "undefined") return null;

  const launcher = !open ? (
    <div
      className={`fixed flex flex-col ${pos.side === "left" ? "items-start" : "items-end"} gap-3 pointer-events-none`}
      style={{
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${pos.bottom}px)`,
        [pos.side]: "16px",
        transform: dragOffset ? `translateY(${dragOffset.dy}px)` : undefined,
        transition: dragOffset ? "none" : "transform 200ms ease",
        touchAction: "none",
        zIndex: 2147483600,
      } as React.CSSProperties}
    >
      {/* Popup preview when AI replies while chat is closed */}
      {pendingPreview && (
        <div className="relative animate-in slide-in-from-bottom-2 fade-in duration-300 pointer-events-auto">
          <div className="max-w-[280px] rounded-2xl rounded-br-sm bg-white text-zinc-900 border-2 border-emerald-400/60 shadow-[0_20px_50px_-16px_rgba(16,185,129,0.35)] px-4 py-3">
            <button
              type="button"
              onClick={() => setPendingPreview(null)}
              className="absolute top-2 right-2 size-5 grid place-items-center rounded-full text-zinc-500 hover:text-zinc-900 transition-colors"
              aria-label="Fechar"
            >
              <X className="size-3" />
            </button>
            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.18em] mb-1.5 flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Concierge IA respondeu
            </p>
            <p className="text-[12.5px] leading-relaxed text-zinc-800 line-clamp-4">
              {pendingPreview}
            </p>
            <button
              type="button"
              onClick={() => { setPendingPreview(null); setOpen(true); }}
              className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-700 hover:text-emerald-800 transition-colors"
            >
              Abrir chat →
            </button>
          </div>
          <div className="absolute -bottom-1.5 right-5 size-3 bg-white border-r-2 border-b-2 border-emerald-400/60 rotate-45" />
        </div>
      )}

      {/* Proactive nudge bubble */}
      {showNudge && !hasOpened && !pendingPreview && (
        <div className="relative animate-in slide-in-from-bottom-2 fade-in duration-500 pointer-events-auto">
          <div className="max-w-[244px] rounded-2xl rounded-br-sm bg-background border border-border shadow-elevated px-4 py-3">
            <button
              type="button"
              onClick={dismissNudge}
              className="absolute top-2 right-2 size-5 grid place-items-center rounded-full text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Fechar"
            >
              <X className="size-3" />
            </button>

            <p className="text-[10px] font-semibold text-accent/80 uppercase tracking-[0.18em] mb-1">Concierge IA</p>
            <p className="text-[13px] leading-snug font-medium">
              {greeting}{guestName ? `, ${guestName.split(" ")[0]}` : ""}! 👋
            </p>
            <p className="text-[12px] text-foreground/85 mt-1 leading-snug font-medium">
              Quer uma recomendação personalizada?
            </p>
            <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{hint}</p>
            <button
              type="button"
              onClick={() => { setShowNudge(false); setOpen(true); }}
              className="mt-2.5 w-full text-[11.5px] font-semibold text-foreground hover:text-accent transition-colors text-left"
            >
              Pedir sugestões agora →
            </button>
          </div>
          <div className="absolute -bottom-1.5 right-5 size-3 bg-background border-r border-b border-border rotate-45" />
        </div>
      )}

      <button
        type="button"
        onPointerDown={handleLauncherPointerDown}
        onClick={() => {
          if (justDraggedRef.current) return;
          metaPixelTrackCustom("ChatClick", { location: "guide" });
          setOpen(true);
        }}
        aria-label="Abrir assistente do guia (arraste para reposicionar)"
        title="Peça dicas à IA · arraste para mover"
        className="btn-shine group relative inline-flex items-center gap-2 px-4 sm:px-5 h-14 rounded-full bg-emerald-500 text-white shadow-[0_16px_38px_-14px_rgba(16,185,129,0.7)] hover:bg-emerald-600 hover:shadow-[0_20px_46px_-16px_rgba(16,185,129,0.85)] active:scale-95 transition-all pointer-events-auto cursor-grab active:cursor-grabbing touch-none select-none"
      >
        {loading && (
          <span className="absolute -top-1 -right-1 size-3.5 rounded-full bg-amber-400 ring-2 ring-background animate-pulse" title="Pensando…" />
        )}
        <MessageCircleMore className="relative size-5 group-hover:scale-110 transition-transform" strokeWidth={2.1} />
        <span className="hidden sm:inline text-[13px] font-bold tracking-tight">
          {loading ? "Pensando…" : "Pedir dicas à IA"}
        </span>
      </button>
    </div>
  ) : null;

  const chatOverlay = open ? (
    <>
      <div
        className="fixed inset-0 bg-black/55 backdrop-blur-sm"
        style={{ zIndex: 2147483601 }}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        className="fixed bottom-4 right-4 left-4 sm:left-auto sm:bottom-5 sm:right-5 w-auto sm:w-[360px] h-[70dvh] max-h-[560px] sm:h-[480px] flex flex-col bg-white text-zinc-900 rounded-2xl border border-zinc-200 shadow-2xl overflow-hidden"
        style={{ zIndex: 2147483602 }}
        role="dialog"
        aria-modal="true"
        aria-label="Chat do concierge"
      >
        {/* Header */}
        <div className="relative px-4 py-3 border-b border-zinc-200 bg-gradient-to-br from-emerald-50 to-white">

          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center shrink-0 ring-1 ring-emerald-200">
              <MessageCircleMore className="size-4" strokeWidth={1.9} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.24em] text-emerald-700/80 font-semibold">Concierge IA</p>
              <p className="text-[13px] font-medium truncate text-zinc-900">{propertyName}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="grid size-9 place-items-center rounded-full hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 transition-colors"
            >

              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-6">
              <div className="mx-auto size-12 rounded-2xl bg-emerald-100 text-emerald-700 grid place-items-center mb-3 ring-1 ring-emerald-200">
                <MessageCircleMore className="size-5" strokeWidth={1.9} />
              </div>
              <p className="font-serif text-lg leading-tight text-zinc-900">
                {greeting}{guestName ? `, ${guestName.split(" ")[0]}` : ""}!
              </p>
              <p className="text-[12.5px] text-zinc-500 mt-2 max-w-[28ch] mx-auto leading-relaxed">
                {hint}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                {["Onde fica a casa?", "Qual a senha do Wi-Fi?", "O que fazer perto?"].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setInput(q)}
                    className="text-[11.5px] px-3 py-1.5 rounded-full border border-zinc-200 bg-white text-zinc-700 hover:border-emerald-400/60 hover:text-emerald-700 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>

            </div>
          )}
          {messages.filter((m) => (m.content ?? "").trim().length > 0 || m.attachment).map((m, i) => (
            <div key={m.id ?? i} className={`flex ${m.role === "user" ? "justify-end" : m.role === "system" ? "justify-center" : "justify-start"}`}>
              {m.role === "user" ? (
                <div className="max-w-[85%] flex flex-col items-end gap-1">
                  {m.attachment && <AttachmentBubble attachment={m.attachment} />}
                  {m.content && (
                    <div className="rounded-2xl rounded-tr-md bg-zinc-900 text-white px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-line">
                      {m.content}
                    </div>
                  )}
                </div>
              ) : m.role === "system" ? (
                <div className="max-w-[92%] text-center text-[11.5px] text-zinc-500 italic px-3 py-1.5 rounded-full bg-zinc-100">
                  {m.content}
                </div>
              ) : (
                <div className="max-w-[88%] text-[13.5px] leading-relaxed text-zinc-800 prose prose-sm max-w-none [&_p]:my-1 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-zinc-900 [&_a]:text-emerald-700 [&_a]:underline [&_a]:underline-offset-2 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 [&_li]:my-0.5">
                  {m.senderType === "human" && (
                    <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700/85 font-semibold mb-1">Atendente</p>
                  )}

                  {m.attachment && (
                    <div className="mb-1">
                      <AttachmentBubble attachment={m.attachment} />
                    </div>
                  )}
                  {m.content && (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                        code: ({ node, children, ...props }) => (
                          <CopyableCode {...props}>{children}</CopyableCode>
                        ),
                      }}
                    >
                      {(m.id && autoTranslated[m.id]) || m.content}
                    </ReactMarkdown>
                  )}

                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-zinc-500 text-[12.5px]">
              <Loader2 className="size-3.5 animate-spin" /> pensando…

            </div>
          )}
        </div>

        <GuestNotificationsPrompt
          slug={slug}
          sessionId={sessionId}
          conversationId={conversationId}
          visible={messages.some((m) => m.role === "user")}
        />

        {/* Composer */}
        <div
          className="px-3 pt-2 border-t border-zinc-200 bg-white"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {uploadErr && (
            <div className="text-[11px] text-red-600 mb-1.5 px-1 flex items-center justify-between">
              <span>{uploadErr}</span>
              <button onClick={() => setUploadErr(null)} className="ml-2"><X className="size-3" /></button>
            </div>
          )}
          <div className="flex items-end gap-1.5 bg-zinc-50 border border-zinc-200 rounded-2xl px-2 py-2 focus-within:border-emerald-400/50 transition-colors">
            {humanMode && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={onGuestFilePicked}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || loading}
                  title="Anexar"
                  aria-label="Anexar arquivo"
                  className="grid size-8 place-items-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 shrink-0 disabled:opacity-40"
                >
                  <Paperclip className="size-4" />
                </button>
                <AudioRecorderButton
                  disabled={uploading || loading}
                  maxSeconds={60}
                  onRecorded={onGuestAudio}
                  compact
                />
              </>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              maxLength={2000}
              placeholder={uploading ? "Enviando anexo…" : "Pergunte alguma coisa…"}
              aria-label="Mensagem para o concierge"
              disabled={uploading}
              className="flex-1 resize-none bg-transparent text-[16px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 max-h-32 min-w-0"
            />
            <button
              type="button"
              onClick={send}
              disabled={loading || uploading || !input.trim()}
              aria-label="Enviar"
              className="grid size-9 place-items-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" strokeWidth={2} />}
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 text-center mt-2 px-2">
            A IA usa as informações do guia. Confirme detalhes críticos com o anfitrião.
          </p>
        </div>
      </div>

    </>
  ) : null;

  return createPortal(
    <>
      {launcher}
      {chatOverlay}
    </>,
    document.body,
  );
}
