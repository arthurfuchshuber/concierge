import { Link } from "@tanstack/react-router";
import { ArrowRight, Building2, Users, BookOpen, ClipboardList, Layers, Sparkles, UserCheck } from "lucide-react";
import { Reveal, Section, SectionHeading, Glow, GradientText, GlassCard } from "./primitives";
import { BrowserShot, PhoneShot } from "./ProductShot";
import shotGuias from "@/assets/landing/shot-guias.png.asset.json";
import shotStakeholders from "@/assets/landing/shot-stakeholders.png.asset.json";
import shotGuiaMobile from "@/assets/landing/shot-explorar-mobile.png.asset.json";

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

          <h1 className="mt-7 font-display text-[34px] font-extrabold leading-[1.06] tracking-tight text-balance sm:text-[56px]">
            O <GradientText>CÉREBRO</GradientText>!
          </h1>

          <p className="mx-auto mt-5 max-w-lg text-[14.5px] font-light leading-relaxed text-muted-foreground text-pretty sm:text-[17px]">
            Tudo em um só lugar! Rotinas, IA de atendimento ao hóspede, organização e visualização de pendências, entre
            outras.
          </p>

          <div className="mx-auto mt-8 flex w-full max-w-md flex-col items-stretch gap-3 sm:max-w-none sm:flex-row sm:flex-wrap sm:justify-center">
            <a
              href="#contato"
              className="inline-flex h-12 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-accent px-7 text-[14px] font-bold text-accent-foreground shadow-[0_0_28px_-6px_var(--accent)] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
            >
              Solicitar demonstração! <ArrowRight className="size-4 shrink-0" />
            </a>
          </div>
        </Reveal>
      </div>

      {/* Guia do hóspede no celular */}
      <Reveal delay={0.08}>
        <div className="relative mx-auto mt-12 flex w-full max-w-5xl justify-center px-5 sm:px-8">
          <PhoneShot
            src={shotGuiaMobile.url}
            alt="Guia do hóspede no celular com acesso, regras e recomendações da região"
            className="w-[min(340px,86%)]"
          />
        </div>
      </Reveal>
    </section>
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
        <SectionHeading eyebrow="Como funciona" title="A operação acontece em 4 camadas." />
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
        <SectionHeading eyebrow="Para quem é" title="Feito para operações em escala." />
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
                  <p className="font-display text-[16px] font-bold tracking-tight">{p.title}</p>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">{p.desc}</p>
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
    <footer className="border-t border-border py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 sm:px-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-display text-[15px] tracking-tight">ConciergeIA</p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-muted-foreground">
          <a href="#recursos" className="hover:text-foreground">
            Recursos
          </a>
          <a href="#planos" className="hover:text-foreground">
            Planos
          </a>
          <a href="#contato" className="hover:text-foreground">
            Contato
          </a>
          <Link to="/privacidade" className="hover:text-foreground">
            Privacidade
          </Link>
          <Link to="/termos" className="hover:text-foreground">
            Termos
          </Link>
          <Link to="/reembolso" className="hover:text-foreground">
            Reembolso
          </Link>
          <Link to="/confianca" className="hover:text-foreground">
            Confiança
          </Link>
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
