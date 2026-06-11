import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, MapPin, Sparkles, ShieldCheck, Languages, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SigmaGuide — Guia digital para hospedagem" },
      { name: "description", content: "Crie guias digitais elegantes para hóspedes em minutos. Auto-preenchimento com Google Maps, acesso público ou por PIN." },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-xl bg-primary grid place-items-center">
            <Sparkles className="size-4 text-primary-foreground" strokeWidth={2} />
          </div>
          <span className="font-serif text-xl">SigmaGuide</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/auth" className="text-sm font-medium px-4 py-2 rounded-full hover:bg-secondary">Entrar</Link>
          <Link to="/auth" className="text-sm font-medium px-4 py-2 rounded-full bg-primary text-primary-foreground">Começar</Link>
        </div>
      </header>

      <section className="px-6 pt-10 pb-20 max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-3xl"
        >
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold mb-4">
            Para anfitriões de aluguel por temporada
          </p>
          <h1 className="font-serif text-5xl md:text-7xl leading-[1.02] text-balance">
            O guia perfeito da sua casa, pronto em minutos.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground text-pretty max-w-2xl leading-relaxed">
            Cole o link do Google Maps do seu imóvel. Nós preenchemos endereço, restaurantes próximos, praias, mercados e atrações — separando o que é da vizinhança e o que vale a pena na cidade.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full pl-5 pr-4 py-3 text-sm font-medium"
            >
              Criar meu primeiro guia
              <ArrowRight className="size-4" strokeWidth={2} />
            </Link>
            <span className="text-xs text-muted-foreground">Gratuito durante o beta · sem cartão</span>
          </div>
        </motion.div>

        <div className="mt-20 grid md:grid-cols-3 gap-4">
          {[
            { icon: MapPin, title: "Auto-preenchimento com Maps", desc: "Cole o link do imóvel. Geocodificamos e buscamos pontos de interesse com a Places API." },
            { icon: Zap, title: "Arredores e cidade, separados", desc: "Recomendações 'aqui pertinho' (a pé) e 'pela cidade' (de carro) — sem duplicatas." },
            { icon: ShieldCheck, title: "Acesso público ou por PIN", desc: "URL pública ou código com data de expiração. Sem dados de reserva." },
            { icon: Languages, title: "PT e EN nativos", desc: "Cada guia em dois idiomas. O hóspede escolhe na hora." },
            { icon: Sparkles, title: "Design premium pronto", desc: "Tipografia editorial, layout mobile-first, animações suaves." },
            { icon: ShieldCheck, title: "Multi-tenant seguro", desc: "Cada anfitrião vê apenas seus imóveis. RLS no banco." },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="rounded-2xl border border-border bg-card p-5">
                <div className="size-9 rounded-xl bg-secondary grid place-items-center mb-4">
                  <Icon className="size-[18px]" strokeWidth={1.75} />
                </div>
                <h3 className="text-sm font-semibold">{f.title}</h3>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
        SigmaGuide · Hospedagem com afeto
      </footer>
    </div>
  );
}
