import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronRight,
  Building2,
  Users,
  BookOpen,
  ClipboardList,
  Layers,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { Reveal, Section, SectionHeading, Glow, GradientText, GlassCard } from "./primitives";
import { PhoneFrame } from "./ProductShot";
import { RESULT_FEATURES, ScreenNavContext } from "./ResultScreens";
import { LiveGuideFrame } from "./LiveGuideFrame";
import { cn } from "@/lib/utils";

/* ---------------- HERO ---------------- */

export function Hero() {
  return (
    <section id="topo" className="relative overflow-hidden pt-14 pb-14 sm:pt-24 sm:pb-20">
      <Glow className="left-1/2 top-[-220px] h-[440px] w-[820px] max-w-[130vw] -translate-x-1/2" />

      <div className="mx-auto w-full max-w-4xl px-5 text-center sm:px-8">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
            <span className="min-w-0">Inteligência para hospedagem</span>
          </p>

          <h1 className="mt-7 font-display text-[34px] font-extrabold leading-[1.5] tracking-tight text-balance sm:text-[56px]">
            O <GradientText shine>CÉREBRO</GradientText>!
          </h1>

          <p className="mx-auto mt-5 max-w-lg text-[14.5px] font-light leading-relaxed text-muted-foreground text-pretty sm:text-[17px]">
            Rotinas, IA de atendimento ao hóspede, organização e visualização de pendências, entre outras.
            <span className="mt-2 block font-medium text-ice">Tudo em um só lugar!</span>
          </p>
        </Reveal>
      </div>

      <Reveal delay={0.08}>
        <ResultShowcase />
      </Reveal>
    </section>
  );
}

/* --------- vitrine de telas de resultado (o que o hóspede recebe) --------- */

/**
 * Abas da vitrine. A primeira é o guia DEMONSTRATIVO de verdade (navegável,
 * com atendimento por IA embutido); as outras seguem em telas ilustradas.
 */
const ABAS = [
  { id: "guia", label: "Guia Digital", live: true as const },
  ...RESULT_FEATURES.map((f) => ({ id: f.id, label: f.label, live: false as const })),
];

function ResultShowcase() {
  const [feat, setFeat] = useState(0);
  const [shot, setShot] = useState(0);
  const liveTab = ABAS[feat].live;
  const screens = liveTab ? [] : RESULT_FEATURES[feat - 1].screens;
  const Screen = liveTab ? null : screens[shot % screens.length];

  return (
    <div className="mx-auto mt-10 w-full max-w-5xl px-5 text-left sm:px-8">
      {/* barra de recursos */}
      <div className="ds-scroll-x -mx-5 flex justify-center gap-2.5 px-5 sm:mx-0 sm:gap-3 sm:px-0">
        {ABAS.map((s, idx) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setFeat(idx);
              setShot(0);
            }}
            aria-current={idx === feat}
            className={cn(
              "rounded-full border px-4 py-2 text-[12px] font-semibold whitespace-nowrap transition-colors",
              idx === feat
                ? "border-accent/40 bg-accent/12 text-foreground"
                : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* celular centralizado + seta de avanço dentro do recurso */}
      <div className="mx-auto mt-8 w-[min(440px,92%)] min-w-0">
        <div className="relative">
          <ScreenNavContext.Provider value={() => {}}>
            <PhoneFrame className="w-full">{liveTab || !Screen ? <LiveGuideFrame /> : <Screen />}</PhoneFrame>
          </ScreenNavContext.Provider>

          {!liveTab ? (
            <button
              type="button"
              onClick={() => setShot((v) => (v + 1) % screens.length)}
              aria-label="Ver próximo exemplo deste recurso"
              className="absolute top-1/2 -right-3 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-[#12121c]/90 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:border-accent/40 hover:text-foreground sm:-right-6"
            >
              <ChevronRight className="size-5" />
            </button>
          ) : null}
        </div>

        <a
          href="#contato"
          className="btn-shine mt-8 flex h-12 w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-accent px-7 text-[14px] font-bold text-accent-foreground shadow-[0_0_28px_-6px_var(--accent)] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
        >
          Solicitar demonstração! <ArrowRight className="size-4 shrink-0" />
        </a>
      </div>
    </div>
  );
}

/* ---------------- FLUXO DA OPERAÇÃO ---------------- */

const PASSOS = [
  {
    n: "01",
    icon: Layers,
    title: "Conhecimento Operacional",
    desc: "Sem informações espalhadas em grupos, planilhas e conversas. Mantém o histórico do imóvel, inventário, fornecedores e registros de ocorrências em um único lugar.",
  },
  {
    n: "02",
    icon: ClipboardList,
    title: "Operação sem Gargalos",
    desc: "Coordenação da rotina operacional sem preocupações, e informações precisas sobre o que precisa ser feito em cada imóvel.",
  },
  {
    n: "03",
    icon: Sparkles,
    title: "IA com Conhecimento",
    desc: "Respostas e sugestões efetivas, com base em insights do histórico real de cada propriedade, transformando dados operacionais em decisões inteligentes.",
  },
  {
    n: "04",
    icon: BookOpen,
    title: "Hóspedes + Satisfeitos",
    desc: "Experiência única, moderna e organizada ao hóspede, reduzindo dúvidas recorrentes, aumentando engajamento e elevando a percepção de valor da sua hospedagem.",
  },
];

export function FlowSection() {
  return (
    <Section id="produto" className="relative overflow-hidden">
      <Reveal>
        <SectionHeading eyebrow="Como funciona" title="As 4 camadas operacionais:" />
      </Reveal>

      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PASSOS.map((p, i) => (
          <Reveal key={p.n} delay={0.05 * i} className="h-full">
            <GlassCard className="h-full">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-xl"
                  style={{ background: "linear-gradient(135deg,#7c1ad8 0%,#e82dae 100%)" }}
                >
                  <p.icon className="size-5 text-white" />
                </span>
                <p className="min-w-0 font-display text-[17px] font-bold leading-[1.5] tracking-tight">{p.title}</p>
              </div>
              <p className="ds-text-fill mt-4 text-[12.5px] leading-relaxed text-muted-foreground">{p.desc}</p>
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
    title: "Anfitriões Profissionais",
    desc: "Para quem busca padronização, controle e qualidade em cada detalhe da experiência do hóspede, eliminando improvisos e elevando o nível da operação.",
  },
  {
    icon: Building2,
    title: "Gestores de Múltiplas Propriedades",
    desc: "Ideal para quem administra diversos imóveis e proprietários, precisando centralizar informações, automatizar processos e manter total visibilidade sobre cada unidade.",
  },
  {
    icon: Users,
    title: "Equipes Operacionais",
    desc: "Conecte limpeza, manutenção, inspeções e atendimento em um único fluxo operacional, reduzindo falhas de comunicação e aumentando a eficiência da equipe.",
  },
];

export function AudienceSection() {
  return (
    <Section id="para-quem">
      <Reveal>
        <SectionHeading
          eyebrow="Feito para quem quer"
          title="Transformar Imóveis em uma Operação Estruturada e Escalável"
        />
      </Reveal>

      <div className="mt-12 grid gap-3 md:grid-cols-3">
        {PERFIS.map((p, i) => (
          <Reveal key={p.title} delay={0.05 * i} className="h-full">
            <GlassCard className="h-full">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <p.icon className="size-5 text-accent" />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-[16px] font-bold leading-[1.5] tracking-tight">{p.title}</p>
                  <p className="ds-text-fill mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{p.desc}</p>
                </div>
              </div>
            </GlassCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ---------------- FOOTER ---------------- */

export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-border pt-12 pb-10">
      <Glow className="left-1/2 bottom-[-260px] h-[360px] w-[720px] max-w-[130vw] -translate-x-1/2 opacity-50" />
      <div className="relative mx-auto grid w-full max-w-6xl gap-9 px-5 sm:grid-cols-[1.4fr_1fr_1fr] sm:gap-12 sm:px-8">
        <div className="min-w-0">
          <p className="font-display text-[18px] font-extrabold leading-[1.5] tracking-tight">
            <GradientText>ConciergeIA</GradientText>
          </p>
          <p className="ds-text-fill mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground sm:max-w-sm">
            O sistema operacional inteligente da sua hospedagem: rotinas, equipes, guia do hóspede e atendimento por IA
            em um só lugar.
          </p>
          <a
            href="#contato"
            className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:text-foreground"
          >
            Solicitar demonstração <ArrowRight className="size-3.5" />
          </a>
        </div>

        <nav className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground/70">Produto</p>
          <ul className="mt-3 space-y-2 text-[12.5px] text-muted-foreground">
            <li>
              <a href="#produto" className="hover:text-foreground">
                Como funciona
              </a>
            </li>
            <li>
              <a href="#para-quem" className="hover:text-foreground">
                Para quem é
              </a>
            </li>
            <li>
              <a href="#planos" className="hover:text-foreground">
                Planos
              </a>
            </li>
            <li>
              <a href="#contato" className="hover:text-foreground">
                Contato
              </a>
            </li>
          </ul>
        </nav>

        <nav className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground/70">Institucional</p>
          <ul className="mt-3 space-y-2 text-[12.5px] text-muted-foreground">
            <li>
              <Link to="/privacidade" className="hover:text-foreground">
                Privacidade
              </Link>
            </li>
            <li>
              <Link to="/termos" className="hover:text-foreground">
                Termos
              </Link>
            </li>
            <li>
              <Link to="/reembolso" className="hover:text-foreground">
                Reembolso
              </Link>
            </li>
            <li>
              <Link to="/confianca" className="hover:text-foreground">
                Confiança
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="relative mx-auto mt-10 flex w-full max-w-6xl flex-col gap-2 border-t border-border px-5 pt-6 text-[11.5px] text-muted-foreground/70 sm:flex-row sm:justify-between sm:px-8">
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
