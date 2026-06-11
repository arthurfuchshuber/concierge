import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Star, Navigation } from "lucide-react";
import { property, type Recommendation } from "@/lib/property";

export const Route = createFileRoute("/concierge")({
  head: () => ({ meta: [{ title: "Concierge — SigmaGuide" }] }),
  component: ConciergePage,
});

const tabs = [
  { id: "restaurants", label: "Restaurantes" },
  { id: "beaches", label: "Praias" },
  { id: "markets", label: "Mercados" },
] as const;

function ConciergePage() {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("restaurants");
  const items = property.recommendations[tab];

  return (
    <div>
      <div className="px-4 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      </div>

      <header className="px-6 pt-6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Concierge</p>
        <h1 className="font-serif text-4xl leading-none">Descubra a região</h1>
        <p className="mt-3 text-sm text-muted-foreground">Lugares selecionados pelo anfitrião, pertinho da casa.</p>
      </header>

      <div className="px-4 mt-4 flex gap-2 overflow-x-auto no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative shrink-0 px-4 py-2 text-xs font-medium rounded-full transition-colors ${
              tab === t.id ? "text-primary-foreground" : "text-muted-foreground bg-secondary"
            }`}
          >
            {tab === t.id && (
              <motion.span
                layoutId="concierge-tab"
                className="absolute inset-0 bg-primary rounded-full"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      <section className="px-4 mt-6 space-y-4">
        {items.map((item, i) => (
          <RecCard key={item.id} item={item} index={i} />
        ))}
      </section>

      <p className="px-6 mt-10 text-xs text-center text-muted-foreground">
        Quer dica personalizada? Pergunte ao <Link to="/chat" className="underline text-accent">Concierge IA</Link>.
      </p>
    </div>
  );
}

function RecCard({ item, index }: { item: Recommendation; index: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border border-border rounded-2xl overflow-hidden shadow-soft"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <img src={item.image} alt={item.name} width={800} height={600} loading="lazy" className="w-full h-full object-cover" />
        <span className="absolute top-3 left-3 glass border border-white/20 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold text-white">
          {item.category}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <h3 className="text-base font-semibold leading-tight">{item.name}</h3>
          <div className="shrink-0 inline-flex items-center gap-1 text-xs font-medium bg-secondary rounded-full px-2 py-0.5">
            <Star className="size-3 fill-accent text-accent" strokeWidth={0} />
            {item.rating}
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-snug text-pretty mb-3">{item.note}</p>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-muted-foreground">{item.distance}</span>
          <a
            href={item.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-foreground text-background rounded-full px-3 py-1.5"
          >
            <Navigation className="size-3.5" /> Navegar
          </a>
        </div>
      </div>
    </motion.article>
  );
}
