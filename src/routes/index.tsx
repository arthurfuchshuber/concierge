import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { PLAN_COMPARISON_GROUPS, type PlanKey } from "@/lib/payments.shared";
import {
  ArrowRight,
  Check,
  MessageCircle,
  Sparkles,
  Zap,
  Globe2,
  ShieldCheck,
  Clock,
  Star,
  BarChart3,
  Bot,
  Bell,
  Wifi,
  Heart,
  ChevronDown,
  Menu,
  X,
  Send,
  Phone,
} from "lucide-react";
import conciergeLogo from "@/assets/concierge-logo.png";
import { metaPixelTrack, metaPixelTrackCustom, metaPixelTrackCustomOnce } from "@/lib/meta-pixel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ConciergeIA — Atendimento com IA para hóspedes de temporada" },
      {
        name: "description",
        content:
          "O ConciergeIA responde seus hóspedes em segundos, no idioma deles, com o tom da sua marca. Menos check-ins caóticos, mais avaliações 5 estrelas.",
      },
      { property: "og:title", content: "ConciergeIA — IA que atende hóspedes por você" },
      {
        property: "og:description",
        content:
          "Automatize o atendimento ao hóspede com IA. Respostas em 3 segundos, 24/7, em português, inglês e espanhol.",
      },
      { property: "og:url", content: "https://guia.anfitriaosigma.com.br/" },
    ],
    links: [{ rel: "canonical", href: "https://guia.anfitriaosigma.com.br/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "A IA fala com o hóspede como se fosse eu?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Sim. Você define o tom (formal, próximo, descontraído), configura assinatura e ela usa seu vocabulário, suas indicações e seus favoritos. Nada de robô genérico.",
              },
            },
            {
              "@type": "Question",
              name: "Preciso saber programar ou ter conhecimento técnico?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Não. O onboarding é guiado — você cola o link do Google Maps do imóvel e a IA já entende endereço, vizinhança e cidade. Preenche o resto em minutos.",
              },
            },
            {
              "@type": "Question",
              name: "Funciona no WhatsApp?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Hoje o ConciergeIA funciona via link direto do guia e QR code no imóvel — o hóspede acessa pelo navegador, sem instalar nada. A integração nativa com WhatsApp Business API está no nosso roadmap para 2026; anfitriões dos planos Pro e Business terão acesso antecipado quando disponível.",
              },
            },
            {
              "@type": "Question",
              name: "E se a IA não souber responder?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Ela nunca inventa. Se não tem certeza, chama você imediatamente por notificação. Você aprova, ela aprende e responde por conta na próxima.",
              },
            },
            {
              "@type": "Question",
              name: "Meus dados e dos meus hóspedes estão seguros?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Totalmente. Somos LGPD-compliant, criptografia ponta-a-ponta e nunca coletamos dados de reserva ou pagamento. Só o necessário pra atender bem.",
              },
            },
            {
              "@type": "Question",
              name: "Posso cancelar quando quiser?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Sim. Assinatura mensal, sem multa, sem burocracia. Cancela pelo painel em 2 cliques.",
              },
            },
            {
              "@type": "Question",
              name: "Quanto tempo até estar funcionando?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Em média 15 minutos do cadastro até a primeira resposta automática. Sério.",
              },
            },
          ],
        }),
      },
    ],
  }),

  component: LandingPage,
});

const CREAM = "#FDF9F2";
const BRAND_GRADIENT = "linear-gradient(135deg, #7C1AD8 0%, #E82DAE 100%)";

function LandingPage() {
  return (
    <div className="min-h-screen text-black font-sans" style={{ backgroundColor: CREAM }}>
      <Header />
      <main id="main">
        <Hero />
        <SocialProof />
        <Pain />
        <Showcase />
        <Metrics />
        <Testimonials />
        <Pricing />
        <FAQ />
        <Purpose />

        <FinalCTA />
      </main>
      <Footer />
      <FloatingContact />
    </div>
  );
}


/* ---------- HEADER ---------- */
function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header
      className="sticky top-0 z-50 backdrop-blur-md border-b border-black/5"
      style={{ backgroundColor: "rgba(253, 249, 242, 0.85)" }}
    >
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <img src={conciergeLogo} alt="ConciergeIA" className="size-9 object-contain" />
          <span className="font-display font-bold text-lg tracking-tight">ConciergeIA</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-black/70">
          <a href="#recursos" className="hover:text-black transition">Recursos</a>
          <a href="#planos" className="hover:text-black transition">Planos</a>
          <a href="#faq" className="hover:text-black transition">FAQ</a>
          <Link to="/auth" search={{}} className="hover:text-black transition">Login</Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            search={{}}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-5 h-10 text-sm font-semibold text-white shadow-lg hover:opacity-95 transition"
            style={{ background: BRAND_GRADIENT }}
          >
            Começar agora <ArrowRight className="size-4" />
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            className="md:hidden size-10 grid place-items-center rounded-full border border-black/10 bg-white"
            aria-label="Menu"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="md:hidden border-t border-black/5 bg-white/95 backdrop-blur">
          <div className="px-5 py-4 flex flex-col gap-3 text-sm font-medium">
            <a href="#recursos" onClick={() => setOpen(false)}>Recursos</a>
            <a href="#planos" onClick={() => setOpen(false)}>Planos</a>
            <a href="#faq" onClick={() => setOpen(false)}>FAQ</a>
            <Link to="/auth" search={{}} onClick={() => setOpen(false)}>Login</Link>
            <Link
              to="/auth"
              search={{}}
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-full h-11 text-sm font-semibold text-white"
              style={{ background: BRAND_GRADIENT }}
            >
              Começar agora <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* ---------- HERO ---------- */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Decorative gradient blur */}
      <div
        className="absolute -top-32 -right-32 size-[520px] rounded-full blur-3xl opacity-30 pointer-events-none"
        style={{ background: BRAND_GRADIENT }}
      />
      <div
        className="absolute -bottom-40 -left-32 size-[420px] rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{ background: BRAND_GRADIENT }}
      />

      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-14 sm:pt-24 pb-16 sm:pb-24 flex flex-col items-center gap-12">
        <div className="text-center max-w-3xl mx-auto flex flex-col items-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white border border-black/5 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-black/70 shadow-sm">
            <Sparkles className="size-3.5" style={{ color: "#7C1AD8" }} />
            IA para anfitriões de temporada
          </div>

          <h1 className="mt-6 font-display font-extrabold text-[30px] sm:text-5xl lg:text-6xl leading-[1.1] tracking-tight text-balance">
            Seus hóspedes atendidos em{" "}
            <span
              className="inline-block bg-clip-text text-transparent"
              style={{ backgroundImage: BRAND_GRADIENT, WebkitBackgroundClip: "text" }}
            >
              3 segundos,
            </span>{" "}
            24 horas por dia.
          </h1>

          <p className="mt-5 text-[15px] sm:text-lg text-black/70 leading-relaxed text-pretty">
            O ConciergeIA responde dúvidas do check-in ao check-out — no idioma do hóspede
            e com o tom da sua marca. Você recupera seu tempo. Eles ficam encantados.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full sm:w-auto justify-center">
            <Link
              to="/auth"
              search={{}}
              className="btn-shine inline-flex items-center justify-center gap-2 rounded-full h-12 px-7 text-white text-sm font-semibold shadow-xl hover:opacity-95 transition"
              style={{ background: BRAND_GRADIENT }}
            >
              <span className="inline-flex items-center gap-2">Testar 7 dias grátis <ArrowRight className="size-4" /></span>
            </Link>

            <a
              href="#recursos"
              className="inline-flex items-center justify-center gap-2 rounded-full h-12 px-7 border border-black/15 bg-white text-sm font-semibold hover:bg-black/5 transition"
            >
              Ver como funciona
            </a>
          </div>

          {/* Prova social leve */}
          <div className="mt-8 flex items-center justify-center gap-5 text-xs text-black/60">
            <div className="flex -space-x-2">
              {["#7C1AD8", "#E82DAE", "#9B4ADC", "#C93AC1"].map((c, i) => (
                <div
                  key={i}
                  className="size-8 rounded-full border-2 border-[#FDF9F2] shadow-sm"
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="text-left">
              <div className="flex items-center gap-1 text-amber-500">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="size-3.5 fill-current" />
                ))}
              </div>
              <div className="mt-0.5 text-black/60">
                <strong className="text-black">+320 anfitriões</strong> confiam no ConciergeIA
              </div>
            </div>
          </div>
        </div>

        {/* Mockup do produto (phone frame + chat) */}
        <div className="relative flex justify-center w-full">
          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}


/* Phone mockup with a fake chat conversation */
function PhoneMockup() {
  return (
    <div className="relative">
      {/* Glow */}
      <div
        className="absolute -inset-6 rounded-[3rem] blur-2xl opacity-40 pointer-events-none"
        style={{ background: BRAND_GRADIENT }}
      />
      <div className="relative w-[290px] sm:w-[320px] rounded-[2.5rem] bg-black p-2 shadow-2xl">
        <div className="rounded-[2.1rem] overflow-hidden" style={{ backgroundColor: "#FDF9F2" }}>
          {/* Fake status bar */}
          <div className="flex items-center justify-between px-6 pt-3 pb-2 text-[10px] font-semibold text-black">
            <span>9:41</span>
            <div className="flex items-center gap-1">
              <Wifi className="size-3" />
              <div className="w-6 h-2.5 rounded-sm border border-black/60 relative">
                <div className="absolute inset-0.5 rounded-[1px] bg-black" />
              </div>
            </div>
          </div>
          {/* Chat header */}
          <div className="px-4 py-3 flex items-center gap-2.5 border-b border-black/5">
            <img src={conciergeLogo} alt="" className="size-9 object-contain" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Casa Verão</div>
              <div className="text-[11px] text-emerald-600 flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
                Online agora
              </div>
            </div>
          </div>
          {/* Messages */}
          <div className="px-4 py-4 space-y-2.5 min-h-[340px]">
            <ChatBubble side="user">Oi! A que horas é o check-in?</ChatBubble>
            <ChatBubble side="ai">
              Olá, Marina! 🌊 O check-in é a partir das <b>15h</b>. Se chegar antes, deixa a mala com o
              porteiro. Posso te enviar o mapa de acesso?
            </ChatBubble>
            <ChatBubble side="user">Sim! E tem restaurante bom perto?</ChatBubble>
            <ChatBubble side="ai">
              Tenho 3 favoritos da casa 👇
              <div className="mt-1.5 space-y-1 text-[11px] font-medium">
                <div className="rounded-lg bg-white/70 px-2 py-1">🍤 Sal Marinho — 80m</div>
                <div className="rounded-lg bg-white/70 px-2 py-1">🍕 Nonna Rita — 320m</div>
                <div className="rounded-lg bg-white/70 px-2 py-1">🥗 Verdejar — 500m</div>
              </div>
            </ChatBubble>
          </div>
          {/* Input */}
          <div className="px-3 pb-4">
            <div className="rounded-full bg-white border border-black/10 flex items-center gap-2 pl-4 pr-1 py-1">
              <span className="text-[12px] text-black/40 flex-1">Escreva sua mensagem…</span>
              <div className="size-8 rounded-full grid place-items-center" style={{ background: BRAND_GRADIENT }}>
                <Send className="size-3.5 text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating badge */}
      <div className="absolute -left-4 top-24 hidden sm:flex items-center gap-2 bg-white rounded-2xl border border-black/5 shadow-xl px-3 py-2">
        <div className="size-8 rounded-full grid place-items-center" style={{ background: BRAND_GRADIENT }}>
          <Zap className="size-4 text-white" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-black/50 font-semibold">Resposta em</div>
          <div className="text-sm font-bold">2.7s</div>
        </div>
      </div>
      <div className="absolute -right-3 bottom-16 hidden sm:flex items-center gap-2 bg-white rounded-2xl border border-black/5 shadow-xl px-3 py-2">
        <div className="size-8 rounded-full bg-amber-100 grid place-items-center">
          <Star className="size-4 fill-amber-500 text-amber-500" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-black/50 font-semibold">Avaliação</div>
          <div className="text-sm font-bold">4.9 / 5</div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ side, children }: { side: "user" | "ai"; children: React.ReactNode }) {
  if (side === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] text-[12px] bg-white rounded-2xl rounded-br-sm px-3 py-2 shadow-sm border border-black/5">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className="max-w-[85%] text-[12px] text-white rounded-2xl rounded-bl-sm px-3 py-2 shadow-md"
        style={{ background: BRAND_GRADIENT }}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------- SOCIAL PROOF ---------- */
function SocialProof() {
  return (
    <section className="py-10 border-y border-black/5">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <p className="text-center text-[11px] uppercase tracking-[0.25em] font-semibold text-black/50">
          Usado por anfitriões premiados em
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-black/40 font-display font-bold text-sm sm:text-base">
          <span>Airbnb Plus</span>
          <span>·</span>
          <span>Booking Preferred</span>
          <span>·</span>
          <span>VRBO Premier</span>
          <span>·</span>
          <span>Superhost 2025</span>
        </div>
      </div>
    </section>
  );
}

/* ---------- PAIN → SOLUTION ---------- */
function Pain() {
  const items = [
    {
      icon: Clock,
      pain: "Mensagens sem parar, dia e madrugada",
      fix: "IA responde em 3s no seu tom, 24/7.",
    },
    {
      icon: Globe2,
      pain: "Hóspede estrangeiro que não fala português",
      fix: "Traduz e responde em PT, EN e ES automaticamente.",
    },
    {
      icon: Bot,
      pain: "Você respondendo o mesmo wifi 40x por mês",
      fix: "A IA aprende sua casa e resolve o repetitivo.",
    },
    {
      icon: Star,
      pain: "Avaliações baixas por 'demora na resposta'",
      fix: "Ninguém espera. Você sobe nota e ranking.",
    },
    {
      icon: Bell,
      pain: "Perder o hóspede no meio da estadia",
      fix: "Você recebe alerta só quando é humano de verdade.",
    },
    {
      icon: Heart,
      pain: "Falta de toque humano em respostas automáticas",
      fix: "A IA tem a sua voz, seus favoritos, seu cuidado.",
    },
  ];
  return (
    <section id="recursos" className="py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <p className="text-[11px] uppercase tracking-[0.25em] font-semibold text-black/50">
            O que trava seu dia
          </p>
          <h2 className="mt-3 font-display font-extrabold text-[26px] sm:text-5xl leading-[1.15] tracking-tight text-balance">
            Você não abriu um <span className="italic">callcenter</span>. Abriu uma casa.
          </h2>
          <p className="mt-4 text-[15px] sm:text-lg text-black/60 leading-relaxed text-pretty">
            Todo anfitrião enfrenta o mesmo. O ConciergeIA resolve — sem perder o toque humano.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((it) => (
            <div
              key={it.pain}
              className="group bg-white rounded-3xl border border-black/5 p-6 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden"
            >
              <div
                className="absolute inset-x-0 top-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: BRAND_GRADIENT }}
              />
              <div
                className="size-11 rounded-2xl grid place-items-center text-white shadow-md mb-4"
                style={{ background: BRAND_GRADIENT }}
              >
                <it.icon className="size-5" />
              </div>
              <p className="text-sm font-semibold text-black/50">{it.pain}</p>
              <p className="mt-2 text-base font-semibold text-black leading-snug">{it.fix}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- SHOWCASE (alternating) ---------- */
function Showcase() {
  const blocks = [
    {
      tag: "IA treinada na sua casa",
      title: "Ela conhece cada detalhe — do wifi ao seu restaurante favorito.",
      body:
        "Você preenche uma vez. A IA aprende endereço, regras, café da manhã, indicações e responde como se fosse você — inclusive nos detalhes que só um bom anfitrião sabe.",
      mockup: <MockupBrain />,
    },
    {
      tag: "Dashboard vivo",
      title: "Enxergue tudo o que a IA está resolvendo — e o que precisa de você.",
      body:
        "Você recebe alerta só quando o hóspede precisa de decisão humana. O resto, o ConciergeIA resolve em segundos e reporta.",
      mockup: <MockupDashboard />,
    },
    {
      tag: "3 idiomas nativos",
      title: "Português, inglês e espanhol — sem parecer tradução automática.",
      body:
        "Cada mensagem soa natural no idioma do hóspede. Sua nota de comunicação sobe. Suas reviews viram elogio.",
      mockup: <MockupLanguages />,
    },
  ];

  return (
    <section className="py-20 sm:py-28" style={{ backgroundColor: "#FFFFFF" }}>
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="space-y-24">
          {blocks.map((b) => (
            <div key={b.tag} className="flex flex-col items-center gap-10">
              <div className="text-center max-w-3xl mx-auto flex flex-col items-center">
                <div
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white"
                  style={{ background: BRAND_GRADIENT }}
                >
                  <Sparkles className="size-3" /> {b.tag}
                </div>
                <h3 className="mt-4 font-display font-bold text-[22px] sm:text-4xl leading-[1.2] tracking-tight text-balance">
                  {b.title}
                </h3>
                <p className="mt-4 text-[15px] sm:text-lg text-black/70 leading-relaxed text-pretty">{b.body}</p>
              </div>
              <div className="flex justify-center w-full">{b.mockup}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


/* --- fake product mockups --- */
function MockupBrain() {
  return (
    <div className="relative w-full max-w-md">
      <div
        className="absolute -inset-4 rounded-3xl blur-2xl opacity-25 pointer-events-none"
        style={{ background: BRAND_GRADIENT }}
      />
      <div className="relative rounded-3xl bg-[#FDF9F2] border border-black/5 shadow-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="size-2 rounded-full bg-red-400" />
          <div className="size-2 rounded-full bg-amber-400" />
          <div className="size-2 rounded-full bg-emerald-400" />
          <div className="ml-3 text-[11px] font-mono text-black/40">conciergeia.app / minha-casa</div>
        </div>
        <div className="text-xs uppercase tracking-widest font-semibold text-black/40 mb-2">
          Conhecimento da casa
        </div>
        <div className="space-y-2">
          {[
            { k: "Wifi", v: "CasaVerão-2G · bemvindo2026" },
            { k: "Check-in", v: "15h · self check-in com PIN" },
            { k: "Café", v: "Padaria da Praça, 2 quadras" },
            { k: "Restaurante favorito", v: "Sal Marinho 🍤" },
            { k: "Praia mais próxima", v: "80m — descida da Rua 3" },
          ].map((row) => (
            <div key={row.k} className="flex items-center justify-between text-sm py-1.5 border-b border-black/5 last:border-0">
              <span className="text-black/60">{row.k}</span>
              <span className="font-semibold text-black text-right ml-3 truncate max-w-[60%]">{row.v}</span>
            </div>
          ))}
        </div>
        <div
          className="mt-4 rounded-2xl p-3 text-xs font-medium text-white flex items-center gap-2"
          style={{ background: BRAND_GRADIENT }}
        >
          <Bot className="size-4" /> IA aprendeu 12 novas informações nesta semana.
        </div>
      </div>
    </div>
  );
}

function MockupDashboard() {
  return (
    <div className="relative w-full max-w-md">
      <div
        className="absolute -inset-4 rounded-3xl blur-2xl opacity-25 pointer-events-none"
        style={{ background: BRAND_GRADIENT }}
      />
      <div className="relative rounded-3xl bg-white border border-black/5 shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-widest font-semibold text-black/40">Hoje</div>
            <div className="font-display font-bold text-lg">Casa Verão · Ilhabela</div>
          </div>
          <img src={conciergeLogo} alt="" className="size-9 object-contain" />
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: "Msgs IA", value: "47" },
            { label: "P/ humano", value: "2" },
            { label: "Tempo médio", value: "2.9s" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-[#FDF9F2] p-3">
              <div className="text-[9px] uppercase tracking-widest text-black/50 font-semibold">{s.label}</div>
              <div className="font-display font-bold text-lg">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="text-[11px] uppercase tracking-widest font-semibold text-black/40 mb-2">
          Atividade
        </div>
        <div className="space-y-2">
          {[
            { name: "Marina", msg: "Perguntou sobre check-in", tag: "resolvido" },
            { name: "James", msg: "Pediu restaurante vegano", tag: "resolvido" },
            { name: "Sofia", msg: "Quer trocar de quarto", tag: "humano" },
          ].map((row, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div className="size-7 rounded-full bg-black/5 grid place-items-center font-semibold text-black/60">
                {row.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{row.name}</div>
                <div className="text-black/50 truncate">{row.msg}</div>
              </div>
              <span
                className={`text-[9px] uppercase tracking-widest font-bold px-2 py-1 rounded-full ${
                  row.tag === "humano"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {row.tag}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 h-16 rounded-2xl relative overflow-hidden" style={{ background: BRAND_GRADIENT }}>
          <svg viewBox="0 0 200 60" className="w-full h-full opacity-70">
            <polyline
              points="0,45 20,38 40,42 60,30 80,32 100,20 120,25 140,15 160,18 180,10 200,12"
              fill="none"
              stroke="white"
              strokeWidth="2"
            />
          </svg>
          <div className="absolute top-2 left-3 text-[10px] uppercase tracking-widest font-bold text-white">
            Nota de comunicação · 7 dias
          </div>
        </div>
      </div>
    </div>
  );
}

function MockupLanguages() {
  const items = [
    { flag: "🇧🇷", lang: "PT", text: "Bom dia, Marina! O café da manhã está pronto às 8h ☕" },
    { flag: "🇺🇸", lang: "EN", text: "Good morning, Marina! Breakfast will be ready at 8am ☕" },
    { flag: "🇪🇸", lang: "ES", text: "¡Buenos días, Marina! El desayuno estará listo a las 8h ☕" },
  ];
  return (
    <div className="relative w-full max-w-md">
      <div
        className="absolute -inset-4 rounded-3xl blur-2xl opacity-25 pointer-events-none"
        style={{ background: BRAND_GRADIENT }}
      />
      <div className="relative rounded-3xl bg-[#FDF9F2] border border-black/5 shadow-2xl p-6 space-y-3">
        <div className="text-xs uppercase tracking-widest font-semibold text-black/40 mb-1">
          Mesma mensagem · idioma do hóspede
        </div>
        {items.map((it) => (
          <div key={it.lang} className="flex items-start gap-3 bg-white rounded-2xl p-3 border border-black/5">
            <div className="text-2xl">{it.flag}</div>
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-widest font-bold text-black/40">{it.lang}</div>
              <div className="text-sm">{it.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- METRICS ---------- */
function Metrics() {
  const stats = [
    { value: "-73%", label: "no tempo médio de resposta" },
    { value: "+42%", label: "de avaliações 5 estrelas" },
    { value: "94%", label: "das dúvidas resolvidas sem você" },
    { value: "3s", label: "de resposta média — 24/7" },
  ];
  return (
    <section className="py-20 sm:py-24">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.label} className="text-center sm:text-left">
              <div
                className="font-display font-extrabold text-5xl sm:text-6xl bg-clip-text text-transparent leading-none"
                style={{ backgroundImage: BRAND_GRADIENT, WebkitBackgroundClip: "text" }}
              >
                {s.value}
              </div>
              <div className="mt-2 text-sm text-black/60 max-w-[180px] mx-auto sm:mx-0">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- TESTIMONIALS ---------- */
function Testimonials() {
  const items = [
    {
      name: "Camila Andrade",
      role: "Superhost · Ilhabela · 4 imóveis",
      stat: "+38% em 90 dias",
      quote:
        "Recuperei minhas noites de sono. As notas de comunicação viraram 5 direto. O melhor investimento que fiz esse ano.",
    },
    {
      name: "Rafael Menezes",
      role: "Anfitrião · Trancoso · 2 imóveis",
      stat: "-70% de mensagens no whatsapp",
      quote:
        "Meus hóspedes gringos amam. A IA responde em inglês fluente, com o mesmo cuidado que eu teria. Parece mágica.",
    },
    {
      name: "Ana Beatriz Lopes",
      role: "Gestora · Rio de Janeiro · 12 imóveis",
      stat: "94% resolvido pela IA",
      quote:
        "Minha operação triplicou de tamanho sem contratar ninguém pro atendimento. O ConciergeIA virou parte da equipe.",
    },
  ];
  return (
    <section className="py-20 sm:py-28" style={{ backgroundColor: "#FFFFFF" }}>
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <p className="text-[11px] uppercase tracking-[0.25em] font-semibold text-black/50">
            Depoimentos
          </p>
          <h2 className="mt-3 font-display font-extrabold text-[26px] sm:text-5xl leading-[1.15] tracking-tight text-balance">
            Anfitriões que dormem em paz.
          </h2>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {items.map((t) => (
            <div
              key={t.name}
              className="rounded-3xl border border-black/5 p-6 flex flex-col"
              style={{ backgroundColor: "#FDF9F2" }}
            >
              <div
                className="inline-flex self-start items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white"
                style={{ background: BRAND_GRADIENT }}
              >
                {t.stat}
              </div>
              <blockquote className="mt-4 text-base leading-relaxed text-black flex-1">
                "{t.quote}"
              </blockquote>
              <div className="mt-6 flex items-center gap-3 pt-4 border-t border-black/5">
                <div
                  className="size-10 rounded-full grid place-items-center text-white font-bold"
                  style={{ background: BRAND_GRADIENT }}
                >
                  {t.name[0]}
                </div>
                <div>
                  <div className="font-semibold text-sm">{t.name}</div>
                  <div className="text-xs text-black/50">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- PRICING ---------- */


type PricingCard = {
  key: PlanKey;
  name: string;
  price: string;
  period: string;
  desc: string;
  features: string[];
  lockedNext?: string;
  cta: string;
  ctaHref: string;
  highlight?: boolean;
  dark?: boolean;
};

function Pricing() {
  const sectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      metaPixelTrackCustomOnce("ViewPlans", { location: "landing" });
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            metaPixelTrackCustomOnce("ViewPlans", { location: "landing" });
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const plans: PricingCard[] = [
    {
      key: "starter",
      name: "Starter",
      price: "R$ 99",
      period: "/mês",
      desc: "Pra começar a encantar hóspedes com um guia digital profissional.",
      features: [
        "Até 3 guias digitais",
        "Edição manual completa (fotos, seções, dicas)",
        "Bilíngue (PT + EN)",
        "Acesso por link ou PIN privado",
        "QR code personalizado por imóvel",
      ],
      lockedNext: "Chat com IA para hóspedes",
      cta: "Testar 7 dias grátis",
      ctaHref: "/auth",
    },
    {
      key: "pro",
      name: "Pro",
      price: "R$ 199",
      period: "/mês",
      desc: "Automatize a rotina e deixe uma IA responder seus hóspedes por você.",
      features: [
        "Tudo do Starter, mais:",
        "Até 20 guias",
        "Importação automática dos anúncios do Airbnb",
        "Chat com IA para hóspedes dentro do guia",
        "Formulário de captação + validação de documentos por IA",
      ],
      lockedNext: "Atendimento humano ao vivo",
      cta: "Começar agora",
      ctaHref: "/auth",
      highlight: true,
    },
    {
      key: "business",
      name: "Business",
      price: "R$ 399",
      period: "/mês",
      desc: "Pra gestores profissionais com equipe e atendimento ao vivo.",
      features: [
        "Tudo do Pro, mais:",
        "Até 50 guias",
        "Atendimento humano ao vivo (com sua equipe)",
        "Ensinar a IA com sua base de conhecimento própria",
        "Gestão de equipe + edição em massa",
      ],
      lockedNext: "Marca própria (white label)",
      cta: "Começar agora",
      ctaHref: "/auth",
    },
    {
      key: "enterprise",
      name: "Enterprise",
      price: "Sob consulta",
      period: "",
      desc: "Volume alto, marca própria e integrações sob medida.",
      features: [
        "Tudo do Business, mais:",
        "Guias ilimitados",
        "Marca própria (logo e nome)",
        "Integração com sistemas externos",
        "Onboarding dedicado e SLA 24/7",
      ],
      cta: "Falar com vendas",
      ctaHref: "https://wa.me/5547996759381?text=" + encodeURIComponent("Olá! Tenho interesse no plano Enterprise do ConciergeIA."),
      dark: true,
    },
  ];

  return (
    <section id="planos" ref={sectionRef} className="py-20 sm:py-28">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <p className="text-[11px] uppercase tracking-[0.25em] font-semibold text-black/50">
            Planos
          </p>
          <h2 className="mt-3 font-display font-extrabold text-[26px] sm:text-5xl leading-[1.15] tracking-tight text-balance">
            Escolha o plano ideal para sua operação.
          </h2>
          <p className="mt-4 text-[15px] sm:text-lg text-black/60 text-pretty">
            7 dias grátis em todos os planos pagos. Cancele quando quiser.
          </p>
        </div>

        {/* Cards */}
        <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {plans.map((p) => {
            const isDark = p.dark;
            const isHi = p.highlight;
            const isEnterprise = p.ctaHref.startsWith("http") || p.ctaHref.startsWith("mailto:");
            return (
              <div
                key={p.key}
                className={`relative rounded-3xl p-8 flex flex-col ${
                  isDark
                    ? "bg-black text-white border border-black"
                    : isHi
                      ? "bg-white border-2 border-black shadow-xl"
                      : "bg-white border border-black/10 shadow-sm"
                }`}
              >
                {isHi && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-black text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">
                    Mais popular
                  </div>
                )}
                <div className={`text-xs uppercase tracking-widest font-bold ${isDark ? "text-white/70" : "text-black/50"}`}>
                  {p.name}
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-display font-extrabold text-4xl">{p.price}</span>
                  {p.period && <span className={isDark ? "text-white/60 text-sm" : "text-black/50 text-sm"}>{p.period}</span>}
                </div>
                <p className={`mt-2 text-sm min-h-[48px] ${isDark ? "text-white/70" : "text-black/60"}`}>{p.desc}</p>
                <ul className="mt-6 space-y-2.5 flex-1">
                  {p.features.map((f, idx) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className={`size-4 mt-0.5 shrink-0 ${idx === 0 && f.startsWith("Tudo do") ? (isDark ? "text-white" : "text-black") : (isDark ? "text-white/80" : "text-[#7C1AD8]")}`} />
                      <span className={isDark ? "text-white/90" : (idx === 0 && f.startsWith("Tudo do") ? "text-black font-semibold" : "text-black/80")}>{f}</span>
                    </li>
                  ))}
                  {p.lockedNext && (
                    <li className={`flex items-start gap-2 text-sm ${isDark ? "text-white/40" : "text-black/30"} line-through`}>
                      <span className="size-4 mt-0.5 shrink-0 grid place-items-center">×</span>
                      <span>{p.lockedNext}</span>
                    </li>
                  )}
                </ul>
                {isEnterprise ? (
                  <a
                    href={p.ctaHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => metaPixelTrack("InitiateCheckout", { plan: p.name })}
                    className={`btn-shine mt-8 inline-flex items-center justify-center gap-2 rounded-full h-12 text-sm font-semibold transition ${
                      isDark ? "bg-white text-black hover:opacity-90" : "bg-black text-white hover:opacity-90"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">{p.cta} <ArrowRight className="size-4" /></span>
                  </a>
                ) : (
                  <Link
                    to={p.ctaHref}
                    onClick={() => metaPixelTrack("InitiateCheckout", { plan: p.name })}
                    className="btn-shine mt-8 inline-flex items-center justify-center gap-2 rounded-full h-12 text-sm font-semibold transition bg-black text-white hover:opacity-90"
                  >
                    <span className="inline-flex items-center gap-2">{p.cta} <ArrowRight className="size-4" /></span>
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        {/* Comparison table */}
        <div className="mt-16 rounded-3xl border border-black/10 bg-white shadow-sm overflow-hidden">
          <div className="p-6 sm:p-8 border-b border-black/5 bg-black/[0.02]">
            <h3 className="font-display font-bold text-xl sm:text-2xl">Comparativo detalhado</h3>
            <p className="text-sm text-black/60 mt-1">
              Tudo em linguagem simples. Sem termos técnicos.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-black/5 bg-black/[0.02]">
                  <th className="p-4 sm:p-5 text-xs uppercase tracking-wider font-semibold text-black/50 w-[38%]">Recurso</th>
                  <th className="p-4 sm:p-5 text-sm font-semibold text-center">Starter</th>
                  <th className="p-4 sm:p-5 text-sm font-semibold text-center bg-black/[0.04]">Pro</th>
                  <th className="p-4 sm:p-5 text-sm font-semibold text-center">Business</th>
                  <th className="p-4 sm:p-5 text-sm font-semibold text-center">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {PLAN_COMPARISON_GROUPS.map((group) => (
                  <Fragment key={group.group}>
                    <tr key={`g-${group.group}`} className="bg-black/[0.02]">
                      <td colSpan={5} className="px-4 sm:px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-black/45">
                        {group.group}
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label}>
                        <td className="p-4 sm:p-5 text-sm font-medium text-black/80">{row.label}</td>
                        {(["starter", "pro", "business", "enterprise"] as PlanKey[]).map((k) => (
                          <td
                            key={k}
                            className={`p-4 sm:p-5 text-sm text-center ${k === "pro" ? "bg-black/[0.03]" : ""} ${row.values[k] === "—" ? "text-black/30" : row.values[k] === "✓" ? "text-[#7C1AD8] font-semibold" : "text-black/70"}`}
                          >
                            {row.values[k]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-xs text-black/50 mt-8">
          Precisa de algo específico?{" "}
          <a href="mailto:sigma@anfitriaosigma.com.br" className="underline hover:text-black">
            Fale com um consultor
          </a>{" "}
          — soluções personalizadas para redes e grandes operações.
        </p>
      </div>
    </section>
  );
}


/* ---------- FAQ ---------- */
function FAQ() {
  const items = [
    {
      q: "A IA fala com o hóspede como se fosse eu?",
      a: "Sim. Você define o tom (formal, próximo, descontraído), configura assinatura e ela usa seu vocabulário, suas indicações e seus favoritos. Nada de robô genérico.",
    },
    {
      q: "Preciso saber programar ou ter conhecimento técnico?",
      a: "Não. O onboarding é guiado — você cola o link do Google Maps do imóvel e a IA já entende endereço, vizinhança e cidade. Preenche o resto em minutos.",
    },
    {
      q: "Funciona no WhatsApp?",
      a: "Hoje o ConciergeIA funciona via link direto do guia e QR code no imóvel — o hóspede acessa pelo navegador, sem instalar nada. A integração nativa com WhatsApp Business API está no nosso roadmap para 2026; anfitriões dos planos Pro e Business terão acesso antecipado quando disponível.",
    },
    {
      q: "E se a IA não souber responder?",
      a: "Ela nunca inventa. Se não tem certeza, chama você imediatamente por notificação. Você aprova, ela aprende e responde por conta na próxima.",
    },
    {
      q: "Meus dados e dos meus hóspedes estão seguros?",
      a: "Totalmente. Somos LGPD-compliant, criptografia ponta-a-ponta e nunca coletamos dados de reserva ou pagamento. Só o necessário pra atender bem.",
    },
    {
      q: "Posso cancelar quando quiser?",
      a: "Sim. Assinatura mensal, sem multa, sem burocracia. Cancela pelo painel em 2 cliques.",
    },
    {
      q: "Quanto tempo até estar funcionando?",
      a: "Em média 15 minutos do cadastro até a primeira resposta automática. Sério.",
    },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="py-20 sm:py-28" style={{ backgroundColor: "#FFFFFF" }}>
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-[0.25em] font-semibold text-black/50">
            Perguntas frequentes
          </p>
          <h2 className="mt-3 font-display font-extrabold text-[26px] sm:text-5xl leading-[1.15] tracking-tight text-balance">
            Tudo o que você quer saber.
          </h2>
        </div>
        <div className="mt-12 space-y-3">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <button
                key={it.q}
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full text-left rounded-2xl border border-black/5 bg-[#FDF9F2] p-5 hover:shadow-md transition"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-black">{it.q}</span>
                  <ChevronDown
                    className={`size-5 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    style={{ color: "#7C1AD8" }}
                  />
                </div>
                {isOpen && (
                  <p className="mt-3 text-sm text-black/70 leading-relaxed">{it.a}</p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------- FINAL CTA ---------- */
/* ---------- PURPOSE / SOBRE O APLICATIVO ---------- */
function Purpose() {
  return (
    <section id="sobre" className="py-20 sm:py-24 border-t border-black/5">
      <div className="max-w-4xl mx-auto px-5 sm:px-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-white border border-black/5 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-black/70 shadow-sm">
          <ShieldCheck className="size-3.5" style={{ color: "#7C1AD8" }} />
          Sobre o aplicativo
        </div>

        <h2 className="mt-5 font-display font-extrabold text-[26px] sm:text-4xl leading-tight tracking-tight text-balance">
          O que é o ConciergeIA
        </h2>

        <p className="mt-4 text-[15px] sm:text-lg text-black/70 leading-relaxed text-pretty">
          O <strong>ConciergeIA</strong> é um aplicativo web de gestão e atendimento para
          anfitriões de aluguel por temporada, desenvolvido e operado pela{" "}
          <strong>Anfitrião Sigma</strong> (Brasil). Ele centraliza o guia digital do imóvel,
          o atendimento automatizado por IA aos hóspedes, o controle operacional de check-in
          e check-out e o relacionamento com proprietários e prestadores de serviço.
        </p>

        <h3 className="mt-10 font-display font-bold text-xl">Para que serve</h3>
        <ul className="mt-4 space-y-3 text-[15px] text-black/70">
          {[
            "Publicar um guia digital por residência (acesso, Wi-Fi, regras, recomendações da cidade).",
            "Responder dúvidas dos hóspedes 24/7 por IA, com transferência para atendimento humano quando necessário.",
            "Organizar chegadas, saídas e limpezas em um painel operacional com sincronização de reservas.",
            "Gerenciar cadastros de proprietários, hóspedes e prestadores de serviço.",
          ].map((t) => (
            <li key={t} className="flex gap-3">
              <Check className="size-5 shrink-0" style={{ color: "#7C1AD8" }} />
              <span>{t}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-10 font-display font-bold text-xl">
          Como o ConciergeIA usa os serviços do Google
        </h3>
        <p className="mt-4 text-[15px] text-black/70 leading-relaxed text-pretty">
          A integração com o <strong>Google Agenda</strong> é opcional e só é ativada quando o
          próprio anfitrião autoriza sua conta Google dentro do painel. Com a autorização, o
          ConciergeIA lê os eventos da agenda do usuário para exibir, em uma linha do tempo
          única, os compromissos relacionados a cada imóvel, proprietário ou prestador de
          serviço (visitas, manutenções, vistorias e limpezas). Os dados obtidos são usados
          exclusivamente para essa finalidade dentro da conta do usuário, não são vendidos,
          não são usados para publicidade e podem ser revogados a qualquer momento
          desconectando a integração no painel.
        </p>

        <div className="mt-8 flex flex-wrap gap-4 text-sm font-semibold">
          <Link to="/privacidade" className="underline underline-offset-4 hover:opacity-70">
            Política de Privacidade
          </Link>
          <Link to="/termos" className="underline underline-offset-4 hover:opacity-70">
            Termos de Serviço
          </Link>
          <a
            href="https://www.anfitriaosigma.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:opacity-70"
          >
            Anfitrião Sigma
          </a>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {

  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-5xl mx-auto px-5 sm:px-8">
        <div
          className="relative rounded-[2.5rem] p-10 sm:p-16 text-center text-white overflow-hidden shadow-2xl"
          style={{ background: BRAND_GRADIENT }}
        >
          <div className="absolute inset-0 opacity-20 pointer-events-none" style={{
            backgroundImage: "radial-gradient(circle at 20% 20%, white 0, transparent 40%), radial-gradient(circle at 80% 80%, white 0, transparent 40%)"
          }} />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-widest">
              <Sparkles className="size-3.5" /> 7 dias grátis · sem cartão
            </div>
            <h2 className="mt-5 font-display font-extrabold text-[30px] sm:text-6xl leading-[1.1] tracking-tight text-balance max-w-3xl mx-auto">
              Sua próxima review 5 estrelas está a um clique.
            </h2>
            <p className="mt-4 text-white/90 text-lg max-w-3xl mx-auto text-pretty">
              Ative o ConciergeIA em 15 minutos e volte a viver.
            </p>
            <Link
              to="/auth"
              search={{}}
              className="mt-8 inline-flex items-center justify-center gap-2 rounded-full h-14 px-8 bg-white text-black text-base font-bold hover:bg-black hover:text-white transition"
            >
              Começar agora <ArrowRight className="size-5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- FOOTER ---------- */
function Footer() {
  return (
    <footer className="border-t border-black/10 py-8">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
        <div className="flex items-center gap-2.5">
          <img src={conciergeLogo} alt="ConciergeIA" className="size-8 object-contain" />
          <span className="font-display font-bold text-base">ConciergeIA</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-black/70">
          <a href="#recursos" className="hover:text-black">Recursos</a>
          <a href="#planos" className="hover:text-black">Planos</a>
          <a href="#faq" className="hover:text-black">FAQ</a>
          <a href="#sobre" className="hover:text-black">Sobre o app</a>

          <Link to="/privacidade" className="hover:text-black">Privacidade</Link>
          <Link to="/termos" className="hover:text-black">Termos</Link>
          <Link to="/reembolso" className="hover:text-black">Reembolso</Link>
          <Link to="/confianca" className="hover:text-black">Confiança</Link>
        </nav>
      </div>
      <div className="max-w-6xl mx-auto px-5 sm:px-8 mt-5 pt-5 border-t border-black/5 flex flex-col sm:flex-row justify-between gap-2 text-xs text-black/50">
        <p>© {new Date().getFullYear()} ConciergeIA — Todos os direitos reservados.</p>
        <p className="flex items-center gap-1 flex-wrap">
          Feito com <Heart className="size-3 fill-current" style={{ color: "#E82DAE" }} /> no Brasil by{" "}
          <a
            href="https://www.anfitriaosigma.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-black/70 hover:text-black underline underline-offset-2"
          >
            Anfitrião Sigma
          </a>
        </p>
      </div>
    </footer>
  );
}


/* ---------- FLOATING CONTACT (AI chat + WhatsApp handoff) ---------- */
const WHATSAPP_NUMBER = "5547996759381";
const WHATSAPP_DISPLAY = "(47) 99675-9381";

const SUGGESTED_QUESTIONS = [
  "Como funciona a IA nas conversas?",
  "Qual plano é ideal pro meu caso?",
  "Vocês integram com Airbnb?",
  "Funciona no WhatsApp?",
  "Como é o período de teste grátis?",
];

const HUMAN_INTENT_REGEX = /\b(humano|atendente|pessoa|falar com (a )?equipe|suporte humano|whats?app|telefone|ligar|contato direto|vendedor|consultor)\b/i;

function buildWhatsappLink(text: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

function FloatingContact() {
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string; showHandoff?: boolean; showWhats?: boolean }[]>([
    {
      role: "ai",
      text: "Olá! 👋 Sou a IA do ConciergeIA. Posso tirar dúvidas sobre planos, funcionalidades e integrações — o que quiser antes de contratar.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [awaitingHandoff, setAwaitingHandoff] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chatOpen, sending]);

  function pushAi(text: string, extra?: { showHandoff?: boolean; showWhats?: boolean }) {
    setMessages((m) => [...m, { role: "ai", text, ...extra }]);
  }

  function handleUserText(q: string) {
    const clean = q.trim();
    if (!clean) return;
    setMessages((m) => [...m, { role: "user", text: clean }]);

    // If we're waiting for a yes/no on human handoff
    if (awaitingHandoff) {
      setAwaitingHandoff(false);
      if (/\b(sim|quero|pode|claro|isso|manda|bora|ok|beleza)\b/i.test(clean)) {
        pushAi("Perfeito! Clique no botão abaixo pra falar direto com nosso time no WhatsApp 👇", { showWhats: true });
        return;
      }
      if (/\b(n[aã]o|depois|agora n[aã]o)\b/i.test(clean)) {
        pushAi("Tranquilo! Segue perguntando o que quiser por aqui 🙂");
        return;
      }
    }

    // Detect intent for human handoff BEFORE calling AI
    if (HUMAN_INTENT_REGEX.test(clean)) {
      setAwaitingHandoff(true);
      pushAi("Quer que eu te conecte direto com nossa equipe no WhatsApp? (responda sim ou não)", { showHandoff: true });
      return;
    }

    void callAi(clean);
  }

  async function callAi(q: string) {
    setSending(true);
    try {
      const history = [
        ...messages.map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text })),
        { role: "user", content: q },
      ];
      const res = await fetch("/api/public/landing-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok) throw new Error("fail");
      const data = await res.json().catch(() => null);
      let reply =
        (data && (data.reply || data.message || data.content)) ||
        "Posso te conectar com nosso time no WhatsApp pra te ajudar melhor. Quer?";
      reply = String(reply);
      const wantsHandoff = /\[HANDOFF\]/i.test(reply);
      reply = reply.replace(/\[HANDOFF\]/gi, "").trim();
      pushAi(reply);
      if (wantsHandoff) {
        setAwaitingHandoff(true);
        pushAi("Quer que eu te conecte direto com nossa equipe no WhatsApp? (responda sim ou não)", { showHandoff: true });
      }
    } catch {
      setAwaitingHandoff(true);
      pushAi("Não consegui responder agora. Quer falar direto com nosso time no WhatsApp?", { showHandoff: true });
    } finally {
      setSending(false);
    }
  }

  function submit() {
    if (!input.trim() || sending) return;
    const q = input;
    setInput("");
    handleUserText(q);
  }

  const showSuggestions = messages.length === 1 && !sending;

  return (
    <>
      {/* Chat window */}
      {chatOpen && (
        <div
          className="fixed bottom-24 right-4 sm:right-6 z-[60] w-[calc(100vw-2rem)] max-w-sm rounded-3xl bg-white shadow-2xl border border-black/10 overflow-hidden flex flex-col"
          style={{ maxHeight: "min(560px, calc(100vh - 8rem))" }}
        >
          <div className="px-4 py-3 flex items-center gap-3 text-white" style={{ background: BRAND_GRADIENT }}>
            <div className="size-9 rounded-full bg-white/20 grid place-items-center">
              <Sparkles className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Falar com a IA</div>
              <div className="text-[11px] text-white/85">Tire dúvidas antes de contratar</div>
            </div>
            <button onClick={() => setChatOpen(false)} className="size-8 grid place-items-center rounded-full hover:bg-white/15" aria-label="Fechar">
              <X className="size-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-[#FDF9F2]">
            {messages.map((m, i) => (
              <div key={i}>
                <div className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] text-[13px] bg-white rounded-2xl rounded-br-sm px-3 py-2 shadow-sm border border-black/5"
                        : "max-w-[88%] text-[13px] text-white rounded-2xl rounded-bl-sm px-3 py-2 shadow-md"
                    }
                    style={m.role === "ai" ? { background: BRAND_GRADIENT } : undefined}
                  >
                    {m.text}
                  </div>
                </div>
                {m.showHandoff && (
                  <div className="mt-2 flex flex-wrap gap-2 justify-start pl-1">
                    <button
                      onClick={() => handleUserText("Sim")}
                      className="text-[12px] font-semibold px-3 h-8 rounded-full bg-black text-white hover:opacity-90"
                    >
                      Sim, quero
                    </button>
                    <button
                      onClick={() => handleUserText("Não")}
                      className="text-[12px] font-semibold px-3 h-8 rounded-full bg-white border border-black/10 hover:bg-black/5"
                    >
                      Agora não
                    </button>
                  </div>
                )}
                {m.showWhats && (
                  <div className="mt-2 flex justify-start pl-1">
                    <a
                      href={buildWhatsappLink("Olá! Vim pelo site do ConciergeIA e gostaria de falar com a equipe.")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-[#25D366] text-white pl-3 pr-4 h-9 shadow-md hover:opacity-95 transition text-[12.5px] font-semibold"
                    >
                      <Phone className="size-4" />
                      Abrir WhatsApp · {WHATSAPP_DISPLAY}
                    </a>
                  </div>
                )}
              </div>
            ))}

            {showSuggestions && (
              <div className="pt-1 flex flex-wrap gap-1.5">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleUserText(q)}
                    className="text-[12px] px-3 py-1.5 rounded-full border border-black/10 bg-white hover:border-black/30 hover:bg-black/5 transition text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {sending && (
              <div className="flex justify-start">
                <div className="text-[12px] text-black/50 px-3 py-2">digitando…</div>
              </div>
            )}
          </div>

          <div className="p-2 border-t border-black/5 bg-white">
            <div className="flex items-center gap-2 rounded-full border border-black/10 pl-4 pr-1 py-1">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="Pergunte sobre planos, IA, integrações…"
                className="flex-1 bg-transparent text-sm outline-none py-1.5"
              />
              <button
                onClick={submit}
                disabled={!input.trim() || sending}
                className="size-9 rounded-full grid place-items-center text-white disabled:opacity-50"
                style={{ background: BRAND_GRADIENT }}
                aria-label="Enviar"
              >
                <Send className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single FAB — opens chat directly */}
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[55]">
        <button
          onClick={() => {
            metaPixelTrackCustom("ChatClick", { location: "landing" });
            setChatOpen((v) => !v);
          }}
          aria-label={chatOpen ? "Fechar chat" : "Falar com a IA"}
          className="btn-shine size-14 rounded-full grid place-items-center text-white shadow-2xl hover:scale-105 active:scale-95 transition"
          style={{ background: BRAND_GRADIENT }}
        >
          {chatOpen ? <X className="size-6" /> : <MessageCircle className="size-6" />}
        </button>
      </div>
    </>
  );
}


