import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowLeft, Phone } from "lucide-react";
import { property } from "@/lib/property";

export const Route = createFileRoute("/emergency")({
  head: () => ({ meta: [{ title: "Emergência — SigmaGuide" }] }),
  component: EmergencyPage,
});

function EmergencyPage() {
  return (
    <div>
      <div className="px-4 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      </div>

      <header className="px-6 pt-6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Suporte</p>
        <h1 className="font-serif text-4xl leading-none">Emergência</h1>
        <p className="mt-3 text-sm text-muted-foreground">Contatos importantes a um toque de distância.</p>
      </header>

      <section className="px-4 mt-6 space-y-2">
        {property.emergency.map((c, i) => (
          <motion.a
            key={c.id}
            href={`tel:${c.number.replace(/\s/g, "")}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            className="flex items-center justify-between gap-3 p-4 bg-card border border-border rounded-2xl active:scale-[0.98] transition-transform"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold">{c.label}</p>
              <p className="font-mono text-xs text-muted-foreground mt-0.5">{c.number}</p>
            </div>
            <div className="size-10 rounded-full bg-destructive grid place-items-center shrink-0">
              <Phone className="size-4 text-destructive-foreground" strokeWidth={2.25} />
            </div>
          </motion.a>
        ))}
      </section>
    </div>
  );
}
