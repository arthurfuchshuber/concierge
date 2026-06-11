import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowUp, Sparkles } from "lucide-react";
import { askConcierge } from "@/lib/chat.functions";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "Concierge IA — SigmaGuide" }] }),
  component: ChatPage,
});

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Onde almoçar perto?",
  "Como funciona o check-out?",
  "Qual a senha do Wi-Fi?",
  "O que fazer hoje?",
];

function ChatPage() {
  const ask = useServerFn(askConcierge);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { reply } = await ask({ data: { messages: next } });
      setMessages([...next, { role: "assistant", content: reply || "Sem resposta." }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao responder.");
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <div className="px-4 pt-6 pb-2 flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold text-accent">
          <Sparkles className="size-3" /> Concierge IA
        </span>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="size-14 rounded-2xl bg-accent/15 grid place-items-center mx-auto mb-4">
              <Sparkles className="size-6 text-accent" strokeWidth={1.75} />
            </div>
            <h1 className="font-serif text-3xl leading-tight mb-2">Olá, sou seu Concierge</h1>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto text-pretty">
              Pergunte sobre a casa, o bairro, restaurantes ou regras da hospedagem.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-sm mx-auto">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs bg-card border border-border rounded-full px-3 py-1.5 hover:bg-secondary transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "user" ? (
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5 max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap">
                    {m.content}
                  </div>
                ) : (
                  <div className="text-sm leading-relaxed max-w-[90%] whitespace-pre-wrap text-foreground">
                    {m.content}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {loading && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} className="size-1.5 rounded-full bg-current" />
              <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} className="size-1.5 rounded-full bg-current" />
              <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} className="size-1.5 rounded-full bg-current" />
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="sticky bottom-24 px-4 pb-2"
      >
        <div className="glass border border-border rounded-3xl p-2 flex items-end gap-2 shadow-elevated">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Pergunte ao concierge…"
            className="flex-1 resize-none bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none max-h-32"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="shrink-0 size-9 rounded-full bg-accent text-accent-foreground grid place-items-center disabled:opacity-30 transition-opacity"
          >
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </button>
        </div>
      </form>
    </div>
  );
}
