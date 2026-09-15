import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  Users,
  Bot,
  BookOpen,
  ClipboardList,
  Layers,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { Reveal, Section, SectionHeading, Glow, GradientText, GlassCard } from "./primitives";
import { DashboardMockup } from "./DashboardMockup";
import {
  ChatVisual,
  TasksVisual,
  GuideVisual,
  PortfolioVisual,
  MaintenanceVisual,
  KnowledgeVisual,
} from "./visuals";

/* ---------------- HERO ---------------- */

export function Hero() {
  return (
    <section id="topo" className="relative overflow-hidden pt-14 pb-12 sm:pt-24 sm:pb-16">
      <Glow className="left-1/2 top-[-220px] h-[420px] w-[760px] max-w-[130vw] -translate-x-1/2" />

      <div className="mx-auto w-full max-w-4xl px-5 text-center sm:px-8">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
            <span className="min-w-0">Inteligência para hospedagem</span>
          </p>

          <h1 className="mt-7 font-display text-[34px] font-extrabold leading-[1.06] tracking-tight text-balance sm:text-[56px]">
            O cérebro operacional da sua{" "}
            <GradientText>hospedagem.</GradientText>
          </h1>

          <p className="mx-auto mt-5 max-w-lg text-[14.5px] font-light leading-relaxed text-muted-foreground text-pretty sm:text-[17px]">
            Imóveis, equipe, rotinas e atendimento ao hóspede em um só sistema.
          </p>
        </Reveal>
      </div>

      {/* Painel do sistema */}
      <Reveal delay={0.08}>
        <div className="mx-auto mt-10 w-full max-w-5xl px-5 sm:px-8">
          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-px rounded-[26px] opacity-30 blur-md"
              style={{ background: "linear-gradient(120deg,#7c1ad8 0%,#e82dae 100%)" }}
            />
            <div className="relative">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </Reveal>

      <div className="mx-auto mt-9 w-full max-w-md px-5 sm:px-8">
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <a
            href="#contato"
            className="inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-xl bg-accent px-7 text-[14px] font-bold text-accent-foreground shadow-[0_0_28px_-6px_var(--accent)] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
          >
            Conhecer o ConciergeIA <ArrowRight className="size-4 shrink-0" />
          </a>
          <a
            href="#contato"
            className="inline-flex h-12 min-w-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.03] px-7 text-[14px] font-semibold text-muted-foreground backdrop-blur transition-colors duration-200 hover:border-accent/40 hover:text-foreground"
          >
            Solicitar uma demonstração
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------------- PAINEL VIVO ---------------- */

export function LivePanelSection() {
  return (
    <Section id="painel" className="relative overflow-hidden">
      <Glow className="right-[-160px] top-10 h-[300px] w-[380px]" />
      <Reveal>
        <SectionHeading
          eyebrow="Na prática"
          title="A operação inteira, visível em tempo real."
        />
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        <Reveal>
          <GlassCard edge className="h-full">
            <ChatVisual />
            <p className="mt-5 font-display text-[16px] font-bold tracking-tight">Atendimento ao hóspede</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
              Respostas com base no conhecimento cadastrado de cada imóvel.
            </p>
          </GlassCard>
        </Reveal>
        <Reveal delay={0.05}>
          <GlassCard className="h-full">
            <TasksVisual />
            <p className="mt-5 font-display text-[16px] font-bold tracking-tight">Rotinas do dia</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
              Limpezas, chegadas e saídas registradas no lugar certo.
            </p>
          </GlassCard>
        </Reveal>
        <Reveal delay={0.1}>
          <GlassCard className="h-full">
            <PortfolioVisual />
            <p className="mt-5 font-display text-[16px] font-bold tracking-tight">Imóveis e pessoas</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
              Unidades, proprietários e fornecedores em uma base única.
            </p>
          </GlassCard>
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------------- RECURSOS EM CARROSSEL ---------------- */

const RECURSOS = [
  {
    title: "Guia do hóspede",
    desc: "Um guia digital por imóvel, com acessos, regras e recomendações.",
    visual: <GuideVisual />,
  },
  {
    title: "Manutenções",
    desc: "Do chamado ao encerramento, com histórico por unidade.",
    visual: <MaintenanceVisual />,
  },
  {
    title: "Base de conhecimento",
    desc: "Tudo o que a operação sabe, estruturado no mesmo padrão.",
    visual: <KnowledgeVisual />,
  },
  {
    title: "Atendimento IA",
    desc: "Responde no seu padrão e encaminha à equipe o que exige decisão.",
    visual: <ChatVisual />,
  },
];

export function FeatureRail() {
  return (
    <Section id="recursos" className="relative overflow-hidden">
      <Glow className="left-[-160px] top-24 h-[320px] w-[400px]" />
      <Reveal>
        <SectionHeading
          eyebrow="Recursos"
          title="Cada parte da operação com o seu próprio lugar."
        />
      </Reveal>

      {/* Mobile: trilho que desliza com encaixe. Desktop: grade. */}
      <div className="mt-12">
        <div className="ds-scroll-x -mx-5 flex snap-x snap-mandatory gap-4 px-5 pb-2 md:mx-0 md:grid md:grid-cols-2 md:px-0 lg:grid-cols-4">
          {RECURSOS.map((r, i) => (
            <div key={r.title} className="w-[78vw] max-w-[320px] snap-center md:w-auto md:max-w-none">
              <Reveal delay={0.04 * i}>
                <GlassCard className="h-full">
                  <div className="grid min-h-[168px] place-items-center rounded-2xl border border-white/8 bg-background/40 p-3">
                    {r.visual}
                  </div>
                  <p className="mt-5 font-display text-[16px] font-bold tracking-tight">{r.title}</p>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
                    {r.desc}
                  </p>
                </GlassCard>
              </Reveal>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ---------------- FLUXO DA OPERAÇÃO ---------------- */

const PASSOS = [
  { n: "01", icon: Layers, title: "Informação", desc: "Imóveis, acessos e contatos cadastrados em um só lugar." },
  { n: "02", icon: ClipboardList, title: "Organização", desc: "Instruções e rotinas estruturadas no mesmo padrão." },
  { n: "03", icon: Sparkles, title: "Inteligência", desc: "A IA responde com base no que está cadastrado." },
  { n: "04", icon: BookOpen, title: "Experiência", desc: "O hóspede recebe um guia claro do começo ao fim." },
];

export function FlowSection() {
  return (
    <Section id="produto" className="relative overflow-hidden">
      <Reveal>
        <SectionHeading eyebrow="Como funciona" title="Quatro camadas, na ordem em que a operação acontece." />
      </Reveal>

      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PASSOS.map((p, i) => (
          <Reveal key={p.n} delay={0.05 * i}>
            <GlassCard className="h-full">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-xl"
                  style={{ background: "linear-gradient(135deg,#7c1ad8 0%,#e82dae 100%)" }}
                >
                  <p.icon className="size-5 text-white" />
                </span>
                <span className="text-[10.5px] font-bold uppercase tracking-[0.28em] text-muted-foreground/70">
                  {p.n}
                </span>
              </div>
              <p className="mt-5 font-display text-[17px] font-bold tracking-tight">{p.title}</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">{p.desc}</p>
            </GlassCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ---------------- PARA QUEM É ---------------- */

const PERFIS = [
  {
    icon: UserCheck,
    title: "Anfitriões profissionais",
    desc: "Quem trata a hospedagem como operação e quer padrão em cada detalhe.",
  },
  {
    icon: Building2,
    title: "Gestores de múltiplos imóveis",
    desc: "Quem administra unidades de vários proprietários e precisa de tudo centralizado.",
  },
  {
    icon: Users,
    title: "Operações com equipe",
    desc: "Quem depende de limpeza, manutenção e atendimento alinhados à mesma informação.",
  },
];

export function AudienceSection() {
  return (
    <Section id="para-quem">
      <Reveal>
        <SectionHeading eyebrow="Para quem é" title="Feito para operações que já têm complexidade." />
      </Reveal>

      <div className="mt-12 grid gap-3 md:grid-cols-3">
        {PERFIS.map((p, i) => (
          <Reveal key={p.title} delay={0.05 * i}>
            <GlassCard className="h-full">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <p.icon className="size-5 text-accent" />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-[16px] font-bold tracking-tight">{p.title}</p>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
                    {p.desc}
                  </p>
                </div>
              </div>
            </GlassCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ---------------- BOT (referência de ícone usada no mockup) ---------------- */
export const _icons = { Bot };

/* ---------------- FOOTER ---------------- */

export function LandingFooter() {
  return (
    <footer className="border-t border-border py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 sm:px-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-display text-[15px] tracking-tight">ConciergeIA</p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-muted-foreground">
          <a href="#recursos" className="hover:text-foreground">Recursos</a>
          <a href="#planos" className="hover:text-foreground">Planos</a>
          <a href="#contato" className="hover:text-foreground">Contato</a>
          <Link to="/privacidade" className="hover:text-foreground">Privacidade</Link>
          <Link to="/termos" className="hover:text-foreground">Termos</Link>
          <Link to="/reembolso" className="hover:text-foreground">Reembolso</Link>
          <Link to="/confianca" className="hover:text-foreground">Confiança</Link>
        </nav>
      </div>
      <div className="mx-auto mt-6 flex w-full max-w-6xl flex-col gap-2 border-t border-border px-5 pt-6 text-[11.5px] text-muted-foreground/70 sm:flex-row sm:justify-between sm:px-8">
        <p>© {new Date().getFullYear()} ConciergeIA — Todos os direitos reservados.</p>
        <p>
          Uma solução{" "}
          <a
            href="https://www.anfitriaosigma.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Anfitrião Sigma
          </a>
        </p>
      </div>
    </footer>
  );
}
