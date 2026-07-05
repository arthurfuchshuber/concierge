import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, useState, useEffect } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  MapPin,
  Sparkles,
  ShieldCheck,
  Languages,
  Zap,
  Lock,
  Wifi,
  Check,
  Copy,
  KeyRound,
  Compass,
  BookOpen,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SigmaConcierge — Guia digital da sua casa em minutos" },
      {
        name: "description",
        content:
          "Crie guias editoriais para seus hóspedes em minutos. Cole o link do Maps e nós preenchemos endereço, vizinhança e cidade. Sem dados de reserva.",
      },
      { property: "og:title", content: "SigmaConcierge — Guia digital da sua casa" },
      {
        property: "og:description",
        content:
          "Guias editoriais bilíngues para anfitriões. Auto-preenchimento com Google Maps. Acesso público ou por PIN.",
      },
      { property: "og:url", content: "https://guia.anfitriaosigma.com.br/" },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a6da8312-c098-41d0-a17c-294028fab533/id-preview-b6aead29--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app-1781215917655.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a6da8312-c098-41d0-a17c-294028fab533/id-preview-b6aead29--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app-1781215917655.png",
      },
      { name: "twitter:title", content: "SigmaConcierge — Guia digital da sua casa" },
      {
        name: "twitter:description",
        content:
          "Guias editoriais bilíngues para anfitriões. Auto-preenchimento com Google Maps.",
      },
    ],
    links: [{ rel: "canonical", href: "https://guia.anfitriaosigma.com.br/" }],
  }),
  component: LandingPage,
});

const ROTATING = ["editorial.", "íntimo.", "bilíngue.", "elegante.", "atemporal."];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <HowItWorks />
        <DemoSection />
        <Pillars />
        <SocialProof />
        <NoReservation />
        <Manifesto />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}

/* ---------------- Nav ---------------- */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${scrolled ? "py-3" : "py-5"}`}>
      <div
        className={`mx-auto max-w-6xl px-5 flex items-center justify-between transition-all ${
          scrolled ? "glass border border-border rounded-full mx-4 md:mx-auto md:max-w-3xl shadow-soft px-4 py-2" : ""
        }`}
      >
        <Link to="/" className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-foreground grid place-items-center">
            <Sparkles className="size-3.5 text-background" strokeWidth={2} />
          </div>
          <span className="font-display text-lg tracking-tight">SigmaConcierge</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link
            to="/precos"
            className="text-xs md:text-sm font-medium px-3 py-1.5 rounded-full hover:bg-secondary transition-colors"
          >
            Planos
          </Link>
          <Link
            to="/auth"
            className="text-xs md:text-sm font-medium px-3 py-1.5 rounded-full hover:bg-secondary transition-colors"
          >
            Entrar
          </Link>
          <Link
            to="/auth"
            className="text-xs md:text-sm font-medium px-3.5 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition-opacity inline-flex items-center gap-1"
          >
            Começar
            <ArrowRight className="size-3.5" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ---------------- Hero ---------------- */
function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  const [wordIdx, setWordIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setWordIdx((i) => (i + 1) % ROTATING.length), 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <section ref={ref} className="relative pt-28 md:pt-36 pb-16 md:pb-28 px-5">
      {/* Editorial corner marks */}
      <div className="pointer-events-none absolute inset-0 max-w-6xl mx-auto">
        <div
          className="
      absolute top-24 left-0 right-0
      flex items-center justify-center
      text-[9px] md:text-[10px]
      uppercase
      tracking-[0.12em] md:tracking-[0.3em]
      text-muted-foreground
      font-mono
    "
        >
          <span className="mr-8">№ 01</span>
          <span>2026 — EDIÇÃO BETA</span>
        </div>
      </div>

      <motion.div style={{ y, opacity }} className="relative max-w-6xl mx-auto">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-[10px] uppercase tracking-[0.3em] text-accent font-semibold mb-6 md:mb-8 text-center"
        >
          Para anfitriões de aluguel por temporada
        </motion.p>

        <h1 className="font-display text-[15vw] md:text-[9.5rem] lg:text-[11rem] leading-[0.92] tracking-[-0.02em] text-center text-balance">
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="block"
          >
            O guia da
          </motion.span>
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="block italic relative"
          >
            sua casa,
          </motion.span>
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="block relative h-[1em] overflow-hidden"
          >
            <span className="relative inline-block">
              {ROTATING.map((w, i) => (
                <motion.span
                  key={w}
                  className="absolute inset-0 text-accent italic whitespace-nowrap"
                  initial={{ y: "100%", opacity: 0 }}
                  animate={{
                    y:
                      i === wordIdx ? "0%" : i === (wordIdx - 1 + ROTATING.length) % ROTATING.length ? "-110%" : "100%",
                    opacity: i === wordIdx ? 1 : 0,
                  }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                >
                  {w}
                </motion.span>
              ))}
              {/* spacer to keep width */}
              <span className="invisible">editorial.</span>
            </span>
          </motion.span>
        </h1>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45 }}
          className="mt-10 md:mt-14 max-w-xl mx-auto text-center"
        >
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed text-pretty">
            Cole o link do Google Maps. Em segundos, um guia editorial bilíngue com endereço, vizinhança e cidade — sem
            nenhum dado de reserva.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/auth"
              className="group w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-foreground text-background rounded-full pl-6 pr-5 py-3.5 text-sm font-medium hover:opacity-90 transition-all"
            >
              Criar meu primeiro guia
              <span className="inline-flex size-6 rounded-full bg-background/15 items-center justify-center group-hover:translate-x-0.5 transition-transform">
                <ArrowRight className="size-3.5" strokeWidth={2} />
              </span>
            </Link>
            <a
              href="#demo"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
            >
              Ver como funciona
              <ArrowUpRight className="size-3.5" />
            </a>
          </div>
          <p className="text-[11px] text-muted-foreground mt-5 uppercase tracking-[0.18em]">
            Gratuito durante o beta · sem cartão
          </p>
        </motion.div>

        {/* Phone preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mt-16 md:mt-24 flex justify-center"
        >
          <PhoneMock />
        </motion.div>
      </motion.div>
    </section>
  );
}

function PhoneMock() {
  return (
    <div className="relative">
      <div className="absolute -inset-8 bg-gradient-to-tr from-accent/10 via-transparent to-accent/5 blur-3xl" />
      <div className="relative w-[280px] md:w-[320px] aspect-[9/19] rounded-[3rem] bg-foreground p-2 shadow-elevated">
        <div className="w-full h-full rounded-[2.6rem] bg-background overflow-hidden relative">
          {/* Status notch */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-6 bg-foreground rounded-full z-20" />
          {/* Hero image */}
          <div className="relative h-[55%] bg-gradient-to-br from-[oklch(0.62_0.14_38)] via-[oklch(0.55_0.12_40)] to-[oklch(0.35_0.05_50)]">
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent" />
            <div className="absolute top-9 left-4 right-4 flex justify-between items-center">
              <span className="glass rounded-full px-2.5 py-1 text-[8px] uppercase tracking-[0.2em] font-semibold text-white/95 border border-white/15">
                SigmaConcierge
              </span>
              <span className="glass rounded-full px-2.5 py-1 text-[8px] uppercase tracking-wider font-medium text-white/95 border border-white/15">
                EN
              </span>
            </div>
            <div className="absolute bottom-4 left-4 right-4 text-white">
              <p className="text-[9px] uppercase tracking-[0.2em] opacity-80">Casa Maré · Trancoso</p>
              <h3 className="font-display text-2xl leading-[1.05] mt-1">Bem-vindo a uma pausa lenta.</h3>
            </div>
          </div>
          {/* Body */}
          <div className="p-3 space-y-2.5">
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Wi-Fi</p>
              <div className="flex items-center justify-between mt-1">
                <span className="font-mono text-[11px]">CasaMare_5G</span>
                <Copy className="size-3 text-muted-foreground" />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[KeyRound, BookOpen, Compass, MapPin].map((Icon, i) => (
                <div
                  key={i}
                  className={`aspect-square rounded-lg grid place-items-center ${
                    i === 2 ? "bg-foreground text-background" : "bg-secondary"
                  }`}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-border bg-card p-2.5">
              <p className="text-[8px] uppercase tracking-[0.2em] text-accent font-semibold">Aqui pertinho</p>
              <p className="font-display text-sm mt-1 leading-tight">Capim Santo</p>
              <p className="text-[9px] text-muted-foreground">Restaurante · 4 min a pé</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Marquee ---------------- */
function Marquee() {
  const items = [
    "Auto-preenchimento via Maps",
    "Português & English",
    "URL pública ou PIN",
    "Sem dados de reserva",
    "Arredores & cidade",
    "Editorial mobile-first",
  ];
  return (
    <section className="border-y border-border bg-surface py-4 overflow-hidden">
      <div className="flex gap-12 whitespace-nowrap animate-[marquee_40s_linear_infinite]">
        {[...items, ...items, ...items].map((t, i) => (
          <span
            key={i}
            className="text-xs uppercase tracking-[0.3em] text-muted-foreground font-semibold inline-flex items-center gap-12"
          >
            {t}
            <span className="text-accent">✦</span>
          </span>
        ))}
      </div>
      <style>{`@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-33.333%); } }`}</style>
    </section>
  );
}

/* ---------------- How it works ---------------- */
function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Cole o link do Maps",
      desc: "Endereço, coordenadas e foto são extraídos automaticamente.",
    },
    {
      n: "02",
      title: "Nós enriquecemos",
      desc: "Restaurantes, praias, mercados — separados entre vizinhança e cidade.",
    },
    {
      n: "03",
      title: "Você compartilha",
      desc: "URL pública ou código PIN com expiração. PT & EN nativos.",
    },
  ];
  return (
    <section className="px-5 py-24 md:py-32 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between mb-12 md:mb-16">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-semibold">
          Capítulo 01 — Como funciona
        </p>
        <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-mono">Três passos</span>
      </div>
      <h2 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight max-w-3xl text-balance">
        Do <span className="italic text-accent">link</span> ao guia em menos de um café.
      </h2>

      <div className="mt-16 grid md:grid-cols-3 gap-px bg-border rounded-3xl overflow-hidden border border-border">
        {steps.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: i * 0.1 }}
            className="bg-background p-8 md:p-10 min-h-[280px] flex flex-col justify-between"
          >
            <span className="font-mono text-xs text-muted-foreground">{s.n}</span>
            <div>
              <h3 className="font-display text-3xl leading-tight">{s.title}</h3>
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{s.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Demo section ---------------- */
function DemoSection() {
  return (
    <section id="demo" className="px-5 py-24 md:py-32 bg-surface border-y border-border">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-12">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-semibold">
            Capítulo 02 — A mágica
          </p>
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-mono">Demo</span>
        </div>
        <h2 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight max-w-3xl text-balance">
          Um <span className="italic">link</span>. Dezenas de campos.
        </h2>
        <p className="mt-6 text-base md:text-lg text-muted-foreground max-w-xl leading-relaxed">
          A Places API faz o trabalho braçal. Você revisa, ajusta o tom e publica.
        </p>

        <div className="mt-16 grid md:grid-cols-[1fr_auto_1fr] gap-6 md:gap-10 items-center">
          {/* Input side */}
          <div className="rounded-2xl border border-border bg-background p-6 shadow-soft">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-semibold mb-4">Input</p>
            <div className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-3">
              <MapPin className="size-4 text-accent shrink-0" />
              <span className="font-mono text-xs truncate">maps.app.goo.gl/aXk2…</span>
            </div>
            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              Você só precisa do link. Nada de digitar endereço, fotos, ou pesquisar dicas.
            </p>
          </div>

          <div className="flex md:flex-col items-center justify-center gap-2 text-accent">
            <ArrowRight className="size-5 md:rotate-0 rotate-90" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-semibold font-mono">Auto-fill</span>
            <ArrowRight className="size-5 md:rotate-0 rotate-90" />
          </div>

          {/* Output side */}
          <div className="rounded-2xl border border-border bg-background p-6 shadow-soft">
            <p className="text-[10px] uppercase tracking-[0.3em] text-accent font-semibold mb-4">Output</p>
            <ul className="space-y-2.5 text-sm">
              {[
                "Endereço completo + coordenadas",
                "Foto do imóvel (quando disponível)",
                "12 recomendações na vizinhança",
                "20 destaques da cidade",
                "Distância de carro e a pé",
                "Categorias: comer, beber, praia, mercado…",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <Check className="size-4 text-accent mt-0.5 shrink-0" strokeWidth={2.25} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Nearby vs City split */}
        <div className="mt-10 grid md:grid-cols-2 gap-4">
          <ScopeCard
            tag="Aqui pertinho"
            subtitle="A pé, em minutos da casa."
            items={[
              { name: "Capim Santo", meta: "Restaurante · 4 min a pé" },
              { name: "Quadrado", meta: "Atração · 7 min a pé" },
              { name: "Praia dos Coqueiros", meta: "Praia · 12 min a pé" },
            ]}
          />
          <ScopeCard
            tag="Pela cidade"
            subtitle="Vale o passeio de carro."
            items={[
              { name: "Praia do Espelho", meta: "Praia · 45 min de carro" },
              { name: "Centro histórico", meta: "Atração · 1h de carro" },
              { name: "Mercado Municipal", meta: "Mercado · 25 min de carro" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function ScopeCard({
  tag,
  subtitle,
  items,
}: {
  tag: string;
  subtitle: string;
  items: { name: string; meta: string }[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.3em] text-accent font-semibold">{tag}</p>
        <span className="text-[10px] font-mono text-muted-foreground">{items.length} itens</span>
      </div>
      <p className="font-display text-2xl mt-2">{subtitle}</p>
      <div className="mt-5 space-y-2">
        {items.map((i) => (
          <div
            key={i.name}
            className="flex items-start justify-between gap-4 py-2 border-t border-border first:border-t-0"
          >
            <div>
              <p className="text-sm font-medium">{i.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{i.meta}</p>
            </div>
            <ArrowUpRight className="size-4 text-muted-foreground shrink-0 mt-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Pillars ---------------- */
function Pillars() {
  const pillars = [
    {
      icon: MapPin,
      title: "Maps no comando",
      desc: "Cole, e o resto é nosso. Geocodificação, foto, vizinhança e cidade.",
    },
    {
      icon: Zap,
      title: "Dois recortes, zero ruído",
      desc: "Arredores ‘a pé’ e cidade ‘de carro’ — separados, nunca repetidos.",
    },
    {
      icon: ShieldCheck,
      title: "Acesso público ou PIN",
      desc: "URL aberta ou código com expiração. Você escolhe quem entra.",
    },
    {
      icon: Languages,
      title: "PT & EN nativos",
      desc: "Cada guia em dois idiomas. O hóspede escolhe sem fricção.",
    },
    {
      icon: Wifi,
      title: "Wi-Fi, portão, fechadura",
      desc: "Copiar com um toque. Sem rolar planilhas, sem WhatsApp.",
    },
    {
      icon: Sparkles,
      title: "Editorial pronto",
      desc: "Tipografia Instrument Serif, mobile-first, transições suaves.",
    },
  ];
  return (
    <section className="px-5 py-24 md:py-32 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between mb-12">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-semibold">
          Capítulo 03 — Pilares
        </p>
        <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-mono">
          Seis decisões de design
        </span>
      </div>
      <h2 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight max-w-3xl text-balance">
        Feito para anfitriões com <span className="italic text-accent">gosto</span>.
      </h2>

      <div className="mt-16 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {pillars.map((p, i) => {
          const Icon = p.icon;
          return (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.08 }}
              className="group rounded-2xl border border-border bg-card p-6 hover:shadow-soft transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="size-10 rounded-xl bg-secondary grid place-items-center group-hover:bg-accent/10 transition-colors">
                  <Icon className="size-[18px] text-accent" strokeWidth={1.75} />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">0{i + 1}</span>
              </div>
              <h3 className="font-display text-2xl leading-tight">{p.title}</h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{p.desc}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- No reservation data ---------------- */
function NoReservation() {
  return (
    <section className="px-5 py-24 md:py-32 bg-foreground text-background">
      <div className="max-w-5xl mx-auto">
        <p className="text-[10px] uppercase tracking-[0.3em] text-background/60 font-semibold mb-10">
          Capítulo 04 — O que não fazemos
        </p>
        <h2 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight text-balance">
          Zero dado de <span className="italic text-accent">reserva</span>.
          <br />
          Por princípio.
        </h2>
        <p className="mt-8 text-base md:text-lg text-background/70 max-w-2xl leading-relaxed">
          Nada de nome de hóspede, datas de check-in, ou integração com plataformas. O guia é da casa — não da estadia.
          Atemporal, reutilizável, simples.
        </p>

        <div className="mt-14 grid md:grid-cols-2 gap-3">
          {[
            { ok: false, label: "Nome do hóspede" },
            { ok: false, label: "Data de check-in / out" },
            { ok: false, label: "Integração com Airbnb / Booking" },
            { ok: false, label: "Dados de pagamento" },
            { ok: true, label: "Manual da casa" },
            { ok: true, label: "Wi-Fi, portão, fechadura" },
            { ok: true, label: "Recomendações editoriais" },
            { ok: true, label: "Idioma à escolha do hóspede" },
          ].map((row) => (
            <div
              key={row.label}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                row.ok
                  ? "border-background/15 bg-background/5"
                  : "border-background/10 bg-transparent text-background/40 line-through decoration-background/30"
              }`}
            >
              <span className="text-sm">{row.label}</span>
              {row.ok ? (
                <Check className="size-4 text-accent" strokeWidth={2.25} />
              ) : (
                <Lock className="size-3.5 text-background/30" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Manifesto ---------------- */
function Manifesto() {
  return (
    <section className="px-5 py-32 md:py-44">
      <div className="max-w-4xl mx-auto text-center">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-semibold mb-10">Manifesto</p>
        <blockquote className="font-display text-3xl md:text-5xl leading-[1.15] tracking-tight text-balance">
          “Um bom guia não substitui o anfitrião —<span className="italic text-accent"> conta a história </span>
          da casa quando ele não está por perto.”
        </blockquote>
        <p className="mt-10 text-xs uppercase tracking-[0.3em] text-muted-foreground">SigmaConcierge · Edição 2026</p>
      </div>
    </section>
  );
}

/* ---------------- Final CTA ---------------- */
function FinalCTA() {
  return (
    <section className="px-5 pb-24">
      <div className="max-w-5xl mx-auto rounded-3xl border border-border bg-surface p-10 md:p-20 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,oklch(0.62_0.14_38_/_0.12),transparent_60%)] pointer-events-none" />
        <p className="relative text-[10px] uppercase tracking-[0.3em] text-accent font-semibold mb-6">Comece agora</p>
        <h2 className="relative font-display text-5xl md:text-7xl leading-[0.95] tracking-tight text-balance">
          Seu primeiro guia,
          <br />
          <span className="italic">em cinco minutos.</span>
        </h2>
        <div className="relative mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/auth"
            className="group w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-foreground text-background rounded-full pl-6 pr-5 py-3.5 text-sm font-medium hover:opacity-90 transition-all"
          >
            Criar minha conta
            <span className="inline-flex size-6 rounded-full bg-background/15 items-center justify-center group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="size-3.5" strokeWidth={2} />
            </span>
          </Link>
          <Link
            to="/auth"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
          >
            Já tenho conta — entrar
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        <p className="relative text-[11px] text-muted-foreground mt-6 uppercase tracking-[0.18em]">
          Gratuito durante o beta · sem cartão
        </p>
      </div>
    </section>
  );
}

/* ---------------- Social proof ---------------- */
function SocialProof() {
  const testimonials = [
    {
      quote: "Meus hóspedes param de me ligar para perguntar a senha do Wi-Fi. O guia responde tudo sozinho.",
      name: "Ana Paula",
      role: "Anfitriã no Airbnb · Florianópolis",
      stat: "94%",
      statLabel: "menos mensagens de dúvidas",
    },
    {
      quote: "Colei o link do Maps e em 3 minutos o guia já estava pronto com restaurantes e tudo. Impressionante.",
      name: "Ricardo M.",
      role: "Gestor de 12 imóveis · São Paulo",
      stat: "3 min",
      statLabel: "para o primeiro guia",
    },
    {
      quote: "O visual é muito mais bonito do que qualquer outro guia que eu vi. Parece um produto de luxo.",
      name: "Camila B.",
      role: "Superhost · Trancoso",
      stat: "5★",
      statLabel: "avaliação média dos hóspedes",
    },
  ];
  return (
    <section className="px-5 py-24 md:py-32 bg-surface border-y border-border">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-12">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-semibold">
            Capítulo 03b — Quem usa
          </p>
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-mono">
            Anfitriões reais
          </span>
        </div>
        <h2 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight max-w-3xl text-balance">
          Anfitriões com <span className="italic text-accent">gosto</span> já usam.
        </h2>
        <div className="mt-16 grid md:grid-cols-3 gap-4">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-2xl border border-border bg-background p-7 flex flex-col gap-5"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-display text-5xl leading-none text-accent">{t.stat}</span>
                <span className="text-xs text-muted-foreground leading-tight max-w-[12ch]">{t.statLabel}</span>
              </div>
              <p className="text-[14.5px] leading-relaxed text-foreground/85 flex-1">"{t.quote}"</p>
              <div className="border-t border-border/60 pt-4">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t.role}</p>
              </div>
            </motion.div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {[
            { value: "1.200+", label: "guias criados" },
            { value: "34 cidades", label: "no Brasil" },
            { value: "4.9★", label: "satisfação dos anfitriões" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className="font-display text-3xl">{s.value}</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Footer ---------------- */
function Footer() {
  return (
    <footer className="border-t border-border px-5 py-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="size-6 rounded-md bg-foreground grid place-items-center">
              <Sparkles className="size-3 text-background" strokeWidth={2} />
            </div>
            <span className="font-display text-sm">SigmaConcierge</span>
          </div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Hospedagem com afeto · MMXXVI</p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link to="/auth" className="hover:text-foreground transition-colors">
              Entrar
            </Link>
            <Link to="/auth" className="hover:text-foreground transition-colors">
              Começar
            </Link>
          </div>
        </div>
        <div className="border-t border-border/60 pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>© MMXXVI SigmaConcierge — Todos os direitos reservados.</p>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link to="/precos" className="hover:text-foreground transition-colors">
              Preços
            </Link>
            <Link to="/termos" className="hover:text-foreground transition-colors">
              Termos de Uso
            </Link>
            <Link to="/privacidade" className="hover:text-foreground transition-colors">
              Privacidade
            </Link>
            <Link to="/reembolso" className="hover:text-foreground transition-colors">
              Reembolso
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
