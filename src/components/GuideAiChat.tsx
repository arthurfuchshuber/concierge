import { useEffect, useRef, useState } from "react";
import { MessageCircleMore, Send, X, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Msg = { role: "user" | "assistant"; content: string };

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { greeting, hint } = getTimeContext();

  useEffect(() => {
    setSessionId(getSessionId(slug));
    const cached = loadCachedMessages(slug);
    setConversationId(cached.conversationId);
    setMessages(cached.messages);
    // Show proactive nudge after 12s if user hasn't opened yet (only on fresh sessions)
    if (cached.messages.length === 0) {
      const t = setTimeout(() => setShowNudge(true), 2500);
      return () => clearTimeout(t);
    }
  }, [slug]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages, loading]);

  useEffect(() => {
    if (open) {
      setHasOpened(true);
      setShowNudge(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/public/guide-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, sessionId, conversationId, message: text }),
      });
      const data = (await res.json().catch(() => ({}))) as { conversationId?: string; reply?: string; error?: string };
      if (!res.ok) {
        const errMsg = data.error || "Não consegui responder agora.";
        const updated = [...next, { role: "assistant" as const, content: errMsg }];
        setMessages(updated);
        if (data.conversationId) setConversationId(data.conversationId);
        saveCachedMessages(slug, data.conversationId ?? conversationId, updated);
        return;
      }
      const updated = [...next, { role: "assistant" as const, content: data.reply || "" }];
      setMessages(updated);
      if (data.conversationId) setConversationId(data.conversationId);
      saveCachedMessages(slug, data.conversationId ?? conversationId, updated);
    } catch {
      const updated = [...next, { role: "assistant" as const, content: "Sem conexão. Tente novamente." }];
      setMessages(updated);
      saveCachedMessages(slug, conversationId, updated);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }

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
                  onClick={() => setShowNudge(false)}
                  className="absolute top-2 right-2 size-5 grid place-items-center rounded-full text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Fechar"
                >
                  <X className="size-3" />
                </button>
                <p className="text-[10px] font-semibold text-accent/80 uppercase tracking-[0.18em] mb-1">Concierge IA</p>
                <p className="text-[13px] leading-snug font-medium">
                  {greeting}{guestName ? `, ${guestName.split(" ")[0]}` : ""}! 👋
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
            className="group relative inline-flex items-center gap-2.5 pl-2 pr-2 sm:pr-5 sm:pl-2.5 h-14 rounded-full bg-foreground text-background shadow-[0_14px_36px_-16px_oklch(from_var(--foreground)_l_c_h/0.45)] hover:shadow-[0_18px_44px_-18px_oklch(from_var(--foreground)_l_c_h/0.55)] active:scale-95 transition-all"
          >
            <span className="relative grid size-10 place-items-center rounded-full bg-background/15 backdrop-blur-sm">
              <span aria-hidden="true" className="absolute inset-0 rounded-full bg-background/20 animate-ping" style={{ animationDuration: "2.9s" }} />
              <MessageCircleMore className="relative size-5 group-hover:scale-110 transition-transform" strokeWidth={2} />
            </span>
            <span className="hidden sm:inline text-[13px] font-semibold tracking-tight pr-1">
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
                <p className="text-[10px] uppercase tracking-[0.24em] text-accent font-semibold">Concierge IA</p>
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
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-foreground text-background px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-line">
                    {m.content}
                  </div>
                ) : (
                  <div className="max-w-[88%] text-[13.5px] leading-relaxed text-foreground/90 prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-foreground [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 [&_li]:my-0.5">
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

          {/* Composer */}
          <div className="px-3 pb-3 pt-2 border-t border-border bg-background">
            <div className="flex items-end gap-2 bg-card border border-border rounded-2xl px-3 py-2 focus-within:border-accent/60 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                maxLength={2000}
                placeholder="Pergunte alguma coisa…"
                className="flex-1 resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground/70 max-h-32"
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                aria-label="Enviar"
                className="grid size-9 place-items-center rounded-full bg-accent text-accent-foreground hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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
