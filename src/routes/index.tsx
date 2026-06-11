import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowUpRight, KeyRound, Wifi, BookOpen, Compass, ListChecks, LifeBuoy, HelpCircle, Sparkles } from "lucide-react";
import { property } from "@/lib/property";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `SigmaGuide — ${property.name}` },
      { name: "description", content: `Bem-vindo à ${property.name}. Seu guia digital de hospedagem.` },
    ],
  }),
  component: HomePage,
});

const sections = [
  { to: "/check-in", label: "Check-in", desc: "Senha, portão e endereço", icon: KeyRound },
  { to: "/wifi", label: "Wi-Fi", desc: "Rede e senha", icon: Wifi },
  { to: "/manual", label: "Manual da Casa", desc: "Equipamentos e cuidados", icon: BookOpen },
  { to: "/concierge", label: "Concierge", desc: "Restaurantes, praias, passeios", icon: Compass },
  { to: "/check-out", label: "Check-out", desc: "Checklist visual", icon: ListChecks },
  { to: "/emergency", label: "Emergência", desc: "Contatos importantes", icon: LifeBuoy },
  { to: "/faq", label: "FAQ", desc: "Perguntas frequentes", icon: HelpCircle },
  { to: "/chat", label: "Concierge IA", desc: "Pergunte qualquer coisa", icon: Sparkles },
] as const;

function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="px-4 pt-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-3xl border border-border shadow-elevated"
        >
          <img
            src={property.heroImage}
            alt={property.name}
            width={1080}
            height={1600}
            className="w-full aspect-[4/5] object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10" />

          <div className="absolute top-5 left-5 right-5 flex items-center justify-between">
            <span className="glass rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-semibold text-white/90 border border-white/15">
              SigmaGuide
            </span>
            <span className="glass rounded-full px-3 py-1 text-[10px] uppercase tracking-wider font-medium text-white/90 border border-white/15">
              {property.reservation.nights} noites
            </span>
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
            <p className="text-xs uppercase tracking-[0.18em] opacity-80 mb-2">Bem-vinda, {property.guest.firstName}</p>
            <h1 className="font-serif text-[2.6rem] leading-[1.05] text-balance mb-2">{property.name}</h1>
            <p className="text-sm opacity-80 mb-5">{property.tagline}</p>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest opacity-60">Sua estadia</p>
                <p className="text-sm font-medium mt-0.5">{property.reservation.checkIn} — {property.reservation.checkOut} · {property.reservation.year}</p>
              </div>
              <Link
                to="/check-in"
                className="shrink-0 inline-flex items-center gap-1.5 bg-white text-zinc-900 rounded-full pl-4 pr-3 py-2.5 text-sm font-medium transition-transform active:scale-95"
              >
                Iniciar estadia
                <ArrowUpRight className="size-4" strokeWidth={2} />
              </Link>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Wi-Fi prominent */}
      <section className="px-4 mt-6">
        <Link
          to="/wifi"
          className="block bg-accent/10 border border-accent/20 rounded-2xl p-4 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-xl bg-accent/15 grid place-items-center shrink-0">
              <div className="relative">
                <Wifi className="size-5 text-accent" strokeWidth={2} />
                <span className="absolute -top-1 -right-1 size-1.5 rounded-full bg-accent animate-pulse" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Wi-Fi ativo</p>
              <p className="text-sm font-medium truncate">{property.wifi.ssid}</p>
            </div>
          </div>
          <span className="text-xs font-medium text-accent shrink-0">Ver senha →</span>
        </Link>
      </section>

      {/* Section grid */}
      <section className="px-4 mt-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold">Sua hospedagem</h2>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">{sections.length} seções</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {sections.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.to}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              >
                <Link
                  to={s.to}
                  className="group block h-full bg-card border border-border rounded-2xl p-4 shadow-soft active:scale-[0.98] transition-transform"
                >
                  <div className="size-9 rounded-xl bg-secondary grid place-items-center mb-6 group-hover:bg-accent/10 transition-colors">
                    <Icon className="size-[18px] text-foreground group-hover:text-accent transition-colors" strokeWidth={1.75} />
                  </div>
                  <h3 className="text-sm font-semibold leading-tight">{s.label}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">{s.desc}</p>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

      <footer className="mt-12 px-6 text-center">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">SigmaGuide · Hospedagem com afeto</p>
      </footer>
    </div>
  );
}
