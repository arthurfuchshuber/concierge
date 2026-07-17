import { useEffect, useRef, useState } from "react";
import { MessageCircleMore, Send, X, Loader2, Paperclip } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GuestNotificationsPrompt } from "@/components/GuestNotificationsPrompt";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import { AttachmentBubble, type AttachmentInfo } from "@/components/handoff/AttachmentBubble";

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
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const forceAiNextRef = useRef(false);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  const { greeting, hint } = getTimeContext();


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
      if (detail?.forceAi) setHumanMode(false);
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
      const res = await fetch("/api/public/guide-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, sessionId, conversationId, message: text, guestName: guestName ?? undefined, forceAi: forceAi || undefined }),
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

  return (
    <>
      {!open && (
        <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
          {/* Proactive nudge bubble */}
          {showNudge && !hasOpened && (
            <div className="relative animate-in slide-in-from-bottom-2 fade-in duration-500">
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
              {/* tail */}
              <div className="absolute -bottom-1.5 right-5 size-3 bg-background border-r border-b border-border rotate-45" />
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Abrir assistente do guia"
            title="Peça dicas à IA"
            className="group relative inline-flex items-center gap-2 px-4 sm:px-5 h-14 rounded-full bg-foreground text-background shadow-[0_14px_36px_-16px_oklch(from_var(--foreground)_l_c_h/0.45)] hover:shadow-[0_18px_44px_-18px_oklch(from_var(--foreground)_l_c_h/0.55)] active:scale-95 transition-all"
          >
            <MessageCircleMore className="relative size-5 group-hover:scale-110 transition-transform" strokeWidth={2} />
            <span className="hidden sm:inline text-[13px] font-semibold tracking-tight">
              Pedir dicas à IA
            </span>
          </button>

        </div>
      )}

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:bottom-5 sm:right-5 z-50 w-auto sm:w-[360px] h-[480px] max-h-[calc(100vh-2rem)] flex flex-col bg-background rounded-2xl border border-border shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="relative px-4 py-3 border-b border-border bg-gradient-to-br from-accent/10 to-transparent">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center shrink-0 ring-1 ring-emerald-200">
                <MessageCircleMore className="size-4" strokeWidth={1.9} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-[0.24em] text-accent/75 font-semibold">Concierge IA</p>
                <p className="text-[13px] font-medium truncate">{propertyName}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="grid size-9 place-items-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
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
                <p className="font-serif text-lg leading-tight">
                  {greeting}{guestName ? `, ${guestName.split(" ")[0]}` : ""}!
                </p>
                <p className="text-[12.5px] text-muted-foreground mt-2 max-w-[28ch] mx-auto leading-relaxed">
                  {hint}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                  {["Onde fica a casa?", "Qual a senha do Wi-Fi?", "O que fazer perto?"].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setInput(q)}
                      className="text-[11.5px] px-3 py-1.5 rounded-full border border-border bg-card hover:border-accent/50 hover:text-accent transition-colors"
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
                      <div className="rounded-2xl rounded-tr-md bg-foreground text-background px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-line">
                        {m.content}
                      </div>
                    )}
                  </div>
                ) : m.role === "system" ? (
                  <div className="max-w-[92%] text-center text-[11.5px] text-muted-foreground italic px-3 py-1.5 rounded-full bg-muted/50">
                    {m.content}
                  </div>
                ) : (
                  <div className="max-w-[88%] text-[13.5px] leading-relaxed text-foreground/90 prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-foreground [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 [&_li]:my-0.5">
                    {m.senderType === "human" && (
                      <p className="text-[10px] uppercase tracking-[0.18em] text-accent/80 font-semibold mb-1">Atendente</p>
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
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-muted-foreground text-[12.5px]">
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
            className="px-3 pt-2 border-t border-border bg-background"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            {uploadErr && (
              <div className="text-[11px] text-destructive mb-1.5 px-1 flex items-center justify-between">
                <span>{uploadErr}</span>
                <button onClick={() => setUploadErr(null)} className="ml-2"><X className="size-3" /></button>
              </div>
            )}
            <div className="flex items-end gap-1.5 bg-card border border-border rounded-2xl px-2 py-2 focus-within:border-accent/35 transition-colors">
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
                    className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 disabled:opacity-40"
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
                className="flex-1 resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground/70 max-h-32 min-w-0"
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || uploading || !input.trim()}
                aria-label="Enviar"
                className="grid size-9 place-items-center rounded-full bg-foreground text-background hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" strokeWidth={2} />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-2 px-2">
              A IA usa as informações do guia. Confirme detalhes críticos com o anfitrião.
            </p>
          </div>
        </div>
        </>
      )}
    </>
  );
}
