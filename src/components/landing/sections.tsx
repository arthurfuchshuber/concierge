import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  Users,
  Wrench,
  Boxes,
  FileText,
  Bot,
  BookOpen,
  ClipboardList,
  Layers,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { Reveal, Section, SectionHeading, Glow, GradientText, BentoCard } from "./primitives";
import { DashboardMockup } from "./DashboardMockup";

/* ---------------- HERO ---------------- */

export function Hero() {
  return (
    <section id="topo" className="relative overflow-hidden pt-16 pb-14 sm:pt-24 sm:pb-20">
      <Glow className="left-1/2 top-[-220px] h-[420px] w-[760px] max-w-[130vw] -translate-x-1/2" />

      <div className="mx-auto w-full max-w-4xl px-5 text-center sm:px-8">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
            <span className="min-w-0">Sistema operacional de hospedagem</span>
          </p>

          <h1 className="mt-8 font-display text-[36px] font-extrabold leading-[1.06] tracking-tight text-balance sm:text-[58px]">
            Sua operação de hospedagem,{" "}
            <GradientText>organizada em um só lugar.</GradientText>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-[15px] font-light leading-relaxed text-muted-foreground text-pretty sm:text-[17px]">
            Imóveis, proprietários, fornecedores, rotinas e atendimento ao hóspede na mesma base de conhecimento.
          </p>

          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <a
              href="#contato"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-7 text-[14px] font-bold text-accent-foreground shadow-[0_0_28px_-6px_var(--accent)] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
            >
              Conhecer o ConciergeIA <ArrowRight className="size-4" />
            </a>
            <a
              href="#contato"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-card/40 px-7 text-[14px] font-semibold text-muted-foreground backdrop-blur transition-colors duration-200 hover:border-accent/40 hover:text-foreground"
            >
              Solicitar uma demonstração
            </a>
          </div>
        </Reveal>
      </div>

      {/* Painel do sistema */}
      <div className="mx-auto mt-14 w-full max-w-5xl px-5 sm:px-8">
        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-px rounded-[26px] opacity-20 blur-md"
            style={{ background: "linear-gradient(120deg,#7c1ad8 0%,#e82dae 100%)" }}
          />
          <div className="relative">
            <DashboardMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- O PROBLEMA ---------------- */

const PROBLEMAS = [
  {
    n: "01",
    title: "A informação se espalha",
    desc: "Instruções no WhatsApp, inventário na planilha, contatos na cabeça de alguém. Encontrar leva mais tempo do que resolver.",
  },
  {
    n: "02",
    title: "O padrão depende de pessoas",
    desc: "Cada imóvel tem suas particularidades e cada pessoa da equipe responde de um jeito. Sem uma fonte central, o padrão se perde.",
  },
];

export function ProblemSection() {
  return (
    <Section id="problema" className="relative overflow-hidden">
      <Reveal>
        <SectionHeading
          eyebrow="O problema"
          title="Quando a operação cresce, o conhecimento se dispersa."
        />
      </Reveal>

      <div className="mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-2">
        {PROBLEMAS.map((p, i) => (
          <Reveal key={p.n} delay={0.05 * i}>
            <BentoCard className="h-full">
              <span className="font-display text-[22px] font-bold tracking-tight text-accent">{p.n}</span>
              <h3 className="mt-4 font-display text-[18px] font-bold tracking-tight">{p.title}</h3>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground text-pretty">{p.desc}</p>
            </BentoCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ---------------- NARRATIVA ---------------- */

const PASSOS = [
  {
    n: "01",
    icon: Layers,
    title: "Informação",
    desc: "Tudo o que a sua operação já sabe — imóveis, acessos, contatos, particularidades — cadastrado em um só lugar.",
  },
  {
    n: "02",
    icon: ClipboardList,
    title: "Organização",
    desc: "Instruções, inventários e rotinas estruturados no mesmo padrão, disponíveis para toda a equipe.",
  },
  {
    n: "03",
    icon: Sparkles,
    title: "Inteligência",
    desc: "A IA responde com base no que está cadastrado e encaminha à equipe o que exige decisão humana.",
  },
  {
    n: "04",
    icon: BookOpen,
    title: "Experiência",
    desc: "O hóspede recebe um guia digital claro, com tudo o que precisa antes, durante e depois da estadia.",
  },
];

export function NarrativeSection() {
  return (
    <Section id="produto" className="relative overflow-hidden">
      <Glow className="right-[-140px] top-16 h-[300px] w-[380px]" />
      <Reveal>
        <SectionHeading
          eyebrow="Como funciona"
          title="Da informação solta à experiência do hóspede."
          description="Quatro camadas que se apoiam umas nas outras, na ordem em que a operação acontece."
        />
      </Reveal>

      <div className="mx-auto mt-14 max-w-3xl">
        <ol className="relative space-y-4 border-l border-border pl-6 sm:pl-8">
          {PASSOS.map((p, i) => (
            <Reveal key={p.n} delay={0.05 * i}>
              <li className="relative">
                <span
                  aria-hidden
                  className="absolute -left-[31px] top-6 size-2 rounded-full bg-accent sm:-left-[39px]"
                />
                <BentoCard className="p-6 sm:p-7">
                  <div className="flex min-w-0 items-start gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background/50">
                      <p.icon className="size-5 text-accent" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.28em] text-muted-foreground/70">
                        {p.n}
                      </p>
                      <h3 className="mt-1.5 font-display text-[18px] font-bold tracking-tight">{p.title}</h3>
                      <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground text-pretty">
                        {p.desc}
                      </p>
                    </div>
                  </div>
                </BentoCard>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </Section>
  );
}

/* ---------------- GRADE BENTO ---------------- */

const BENTO_COMPACTOS = [
  { icon: Building2, title: "Gestão de imóveis", desc: "Particularidades, acessos e histórico de cada unidade." },
  { icon: Users, title: "Proprietários", desc: "Dados, preferências e combinados de cada proprietário." },
  { icon: Wrench, title: "Fornecedores", desc: "Quem atende o quê e como acionar, sem depender de memória." },
  { icon: Boxes, title: "Inventário", desc: "Itens e recursos de cada imóvel sob controle." },
];

export function BentoSection() {
  return (
    <Section id="recursos" className="relative overflow-hidden">
      <Glow className="left-[-160px] top-24 h-[320px] w-[400px]" />
      <Reveal>
        <SectionHeading
          eyebrow="Recursos"
          title="Cada parte da operação com o seu próprio lugar."
          description="Uma camada central que conecta pessoas, imóveis, processos e informação."
        />
      </Reveal>

      <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Atendimento IA — destaque */}
        <Reveal className="lg:col-span-2 lg:row-span-2">
          <BentoCard glow className="h-full">
            <span
              className="mb-6 grid size-12 shrink-0 place-items-center rounded-xl"
              style={{ background: "linear-gradient(135deg,#7c1ad8 0%,#e82dae 100%)" }}
            >
              <Bot className="size-6 text-white" />
            </span>
            <h3 className="font-display text-[22px] font-bold tracking-tight sm:text-[26px]">Atendimento IA</h3>
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground text-pretty">
              Uma inteligência preparada para responder aos hóspedes com base no conhecimento cadastrado da sua
              operação — no seu padrão, sem suposições, e com encaminhamento à equipe quando o assunto exige
              decisão humana.
            </p>
            <div className="mt-8 space-y-2.5">
              {[
                "Responde com base no que está cadastrado.",
                "Mantém o mesmo padrão em todos os imóveis.",
                "Registra o que foi tratado com cada hóspede.",
              ].map((t) => (
                <p
                  key={t}
                  className="rounded-xl border border-border bg-background/40 px-4 py-3 text-[12.5px] text-muted-foreground"
                >
                  {t}
                </p>
              ))}
            </div>
          </BentoCard>
        </Reveal>

        {/* Guia do hóspede */}
        <Reveal delay={0.05} className="lg:col-span-2">
          <BentoCard className="h-full overflow-hidden">
            <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <span className="mb-5 grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-background/50">
                  <BookOpen className="size-5 text-accent" />
                </span>
                <h3 className="font-display text-[19px] font-bold tracking-tight sm:text-[22px]">
                  Guia do hóspede
                </h3>
                <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground text-pretty">
                  Um guia digital personalizado por imóvel, com instruções, recomendações e contatos.
                </p>
              </div>
              <div
                aria-hidden
                className="relative hidden h-40 w-28 shrink-0 rotate-6 rounded-2xl border border-border bg-background/50 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.95)] sm:block"
              >
                <div className="absolute inset-3 space-y-2 rounded-xl border border-border bg-card/60 p-3">
                  <div className="h-2 w-2/3 rounded-full bg-accent/40" />
                  <div className="h-1.5 w-full rounded-full bg-muted-foreground/20" />
                  <div className="h-1.5 w-5/6 rounded-full bg-muted-foreground/20" />
                  <div className="mt-3 h-8 rounded-lg border border-border bg-background/60" />
                </div>
              </div>
            </div>
          </BentoCard>
        </Reveal>

        {/* Registros */}
        <Reveal delay={0.1} className="lg:col-span-2">
          <BentoCard className="h-full">
            <span className="mb-5 grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-background/50">
              <FileText className="size-5 text-accent" />
            </span>
            <h3 className="font-display text-[19px] font-bold tracking-tight sm:text-[22px]">
              Registros e rotinas
            </h3>
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground text-pretty">
              Chegadas, saídas, limpezas e ocorrências registradas no lugar certo, com histórico consultável.
            </p>
          </BentoCard>
        </Reveal>

        {/* Compactos */}
        {BENTO_COMPACTOS.map((m, i) => (
          <Reveal key={m.title} delay={0.15 + i * 0.05}>
            <BentoCard className="h-full">
              <m.icon className="size-5 text-accent" />
              <p className="mt-5 font-display text-[16px] font-bold tracking-tight">{m.title}</p>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">{m.desc}</p>
            </BentoCard>
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
    desc: "Quem trata a hospedagem como operação e quer padrão em cada detalhe da estadia.",
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

      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {PERFIS.map((p, i) => (
          <Reveal key={p.title} delay={0.05 * i}>
            <BentoCard className="h-full">
              <span className="mb-5 grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-background/50">
                <p.icon className="size-5 text-accent" />
              </span>
              <p className="font-display text-[17px] font-bold tracking-tight">{p.title}</p>
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground text-pretty">{p.desc}</p>
            </BentoCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

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
