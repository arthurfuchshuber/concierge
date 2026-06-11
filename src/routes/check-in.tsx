import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowLeft, MapPin, Navigation } from "lucide-react";
import { property } from "@/lib/property";

export const Route = createFileRoute("/check-in")({
  head: () => ({ meta: [{ title: "Check-in — SigmaGuide" }] }),
  component: CheckInPage,
});

function CheckInPage() {
  const { checkIn } = property;
  return (
    <div>
      <div className="px-4 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      </div>

      <header className="px-6 pt-6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Chegada</p>
        <h1 className="font-serif text-4xl leading-none">Sua entrada</h1>
        <p className="mt-3 text-sm text-muted-foreground">Tudo o que você precisa para entrar na casa.</p>
      </header>

      <section className="px-4 mt-6 space-y-3">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative overflow-hidden rounded-2xl border border-border shadow-soft"
        >
          <img src={property.mapImage} alt="Mapa" width={1200} height={800} className="w-full aspect-[2/1] object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-background/85 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <div className="flex items-start gap-2 mb-3">
              <MapPin className="size-4 text-accent mt-0.5 shrink-0" />
              <p className="text-sm font-medium leading-snug">{checkIn.address}</p>
            </div>
            <a
              href={checkIn.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-4 py-2.5 text-sm font-medium"
            >
              <Navigation className="size-4" strokeWidth={2} />
              Abrir no Google Maps
            </a>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Fechadura</p>
            <p className="font-mono text-2xl tracking-wider">{checkIn.lockCode}</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Portão</p>
            <p className="font-mono text-2xl tracking-wider">{checkIn.gateCode}</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Horário</p>
            <p className="font-mono text-sm">a partir de {checkIn.time}</p>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed text-pretty">{checkIn.note}</p>
        </div>
      </section>
    </div>
  );
}
