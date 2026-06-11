import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ChevronDown, Search } from "lucide-react";
import { property } from "@/lib/property";

export const Route = createFileRoute("/faq")({
  head: () => ({ meta: [{ title: "FAQ — SigmaGuide" }] }),
  component: FaqPage,
});

function FaqPage() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(0);

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return property.faq;
    return property.faq.filter((f) => f.q.toLowerCase().includes(term) || f.a.toLowerCase().includes(term));
  }, [q]);

  return (
    <div>
      <div className="px-4 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      </div>

      <header className="px-6 pt-6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Dúvidas</p>
        <h1 className="font-serif text-4xl leading-none">FAQ</h1>
      </header>

      <div className="px-4 mt-5">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            className="w-full bg-card border border-border rounded-full pl-11 pr-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <section className="px-4 mt-4 space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum resultado. Tente o <Link to="/chat" className="underline">Chat IA</Link>.</p>
        )}
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="bg-card border border-border rounded-2xl overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full text-left p-4 flex items-center justify-between gap-3"
              >
                <span className="text-sm font-medium pr-2 text-pretty">{item.q}</span>
                <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                </motion.div>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed text-pretty">{item.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </section>
    </div>
  );
}
