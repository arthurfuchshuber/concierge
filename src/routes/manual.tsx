import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { property } from "@/lib/property";

export const Route = createFileRoute("/manual")({
  head: () => ({ meta: [{ title: "Manual da Casa — SigmaGuide" }] }),
  component: ManualPage,
});

function ManualPage() {
  const [open, setOpen] = useState<string | null>(property.manual[0]?.id ?? null);

  return (
    <div>
      <div className="px-4 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      </div>

      <header className="px-6 pt-6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Manual</p>
        <h1 className="font-serif text-4xl leading-none">A casa</h1>
        <p className="mt-3 text-sm text-muted-foreground">Tudo sobre os equipamentos e como aproveitar.</p>
      </header>

      <section className="px-4 mt-6 space-y-2">
        {property.manual.map((item, i) => {
          const isOpen = open === item.id;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              className="bg-card border border-border rounded-2xl overflow-hidden"
            >
              <button
                onClick={() => setOpen(isOpen ? null : item.id)}
                className="w-full text-left p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.desc}</p>
                </div>
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
                    <div className="px-4 pb-4 pt-0 text-sm text-muted-foreground leading-relaxed text-pretty">
                      {item.body}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </section>
    </div>
  );
}
