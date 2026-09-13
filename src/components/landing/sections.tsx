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
  MessageSquare,
  Table2,
  StickyNote,
  FileStack,
  Brain,
  Check,
} from "lucide-react";
import { Reveal, Section, SectionHeading, Surface, Glow, Eyebrow } from "./primitives";
import { DashboardMockup } from "./DashboardMockup";
import { ChatMockup } from "./ChatMockup";
import { GuideMockup } from "./GuideMockup";

/* ---------------- HERO ---------------- */

export function Hero() {
  return (
    <section id="topo" className="relative overflow-hidden pt-16 pb-20 sm:pt-24 sm:pb-28">
      <Glow className="left-1/2 top-[-160px] h-[420px] w-[680px] -translate-x-1/2" />
      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-accent" />
            O sistema operacional inteligente da sua hospedagem
          </p>
          <h1 className="mt-6 font-display text-[34px] leading-[1.06] tracking-tight text-balance sm:text-[52px]">
            Tudo o que você precisa para operar sua hospedagem.{" "}
            <span className="text-accent">Em um só lugar.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground text-pretty sm:text-[17px]">
            Do inventário às instruções do imóvel. Dos dados dos proprietários aos fornecedores. Do atendimento ao
            hóspede ao seu guia personalizado. Tudo organizado, acessível e inteligente.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#contato"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-[14px] font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5"
            >
              Conhecer o ConciergeIA <ArrowRight className="size-4" />
            </a>
            <a
              href="#como-funciona"
              className="inline-flex h-11 items-center rounded-full border border-border px-6 text-[14px] text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
            >
              Ver como funciona
            </a>
          </div>
        </Reveal>

        <DashboardMockup />
      </div>
    </section>
  );
}

/* ---------------- FRASE DE IMPACTO ---------------- */

const DISPERSOS = [
  { icon: MessageSquare, label: "WhatsApp" },
  { icon: Table2, label: "Planilhas" },
  { icon: StickyNote, label: "Anotações" },
  { icon: FileStack, label: "Documentos" },
  { icon: Brain, label: "Memória" },
  { icon: ClipboardList, label: "Informações espalhadas" },
];

export function ScatterToUnified() {
  return (
    <Section id="produto" className="relative overflow-hidden">
      <Glow className="right-[-120px] top-10 h-[320px] w-[420px]" />
      <Reveal>
        <SectionHeading
          eyebrow="Ponto de partida"
          title="Sua operação já tem todas essas informações. A questão é onde elas estão."
        />
      </Reveal>

      <div className="mt-14 grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.85fr)]">
        <Reveal delay={0.05}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2">
            {DISPERSOS.map((d) => (
              <div
                key={d.label}
                className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground"
              >
                <d.icon className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{d.label}</span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="flex items-center justify-center lg:h-full lg:flex-col">
            <span className="hidden h-px w-16 bg-gradient-to-r from-transparent via-accent/50 to-transparent lg:block" />
            <ArrowRight className="size-5 rotate-90 text-accent lg:rotate-0" />
            <span className="hidden h-px w-16 bg-gradient-to-r from-transparent via-accent/50 to-transparent lg:block" />
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <Surface className="p-7 text-center">
            <p className="font-display text-[22px] tracking-tight">ConciergeIA</p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground text-pretty">
              Uma única fonte de verdade para sua operação.
            </p>
          </Surface>
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------------- PROBLEMA ---------------- */

const PROBLEMAS = [
  "Informações espalhadas",
  "Dependência de pessoas específicas",
  "Processos não padronizados",
  "Instruções difíceis de encontrar",
  "Inventários desatualizados",
  "Informações perdidas no WhatsApp",
  "Equipe sem uma fonte central de conhecimento",
];

export function ProblemSection() {
  return (
    <Section id="para-quem">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="O problema"
            title="Quando a operação cresce, a informação se espalha."
            description="Cada imóvel tem suas particularidades. Cada proprietário tem suas informações. Cada fornecedor tem seus contatos. Cada equipe precisa saber o que fazer. E o hóspede espera respostas rápidas e precisas."
          />
          <p className="mt-8 border-l-2 border-accent/60 pl-5 font-display text-[18px] leading-snug tracking-tight text-balance sm:text-[21px]">
            O problema não é ter informação. É conseguir encontrá-la quando você precisa.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <ul className="space-y-1.5">
            {PROBLEMAS.map((p) => (
              <li
                key={p}
                className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-4 py-3.5 text-[13.5px] text-muted-foreground"
              >
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                <span className="min-w-0">{p}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------------- SOLUÇÃO / ECOSSISTEMA ---------------- */

const ECOSSISTEMA = [
  "Imóveis",
  "Proprietários",
  "Fornecedores",
  "Inventário",
  "Instruções",
  "Registros",
  "Atendimento",
  "Guia",
  "IA",
];

export function EcosystemSection() {
  return (
    <Section id="como-funciona" className="relative overflow-hidden">
      <Glow className="left-[-140px] bottom-0 h-[340px] w-[440px]" />
      <Reveal>
        <SectionHeading
          eyebrow="A solução"
          title="O ConciergeIA organiza o conhecimento da sua operação."
          description="Uma camada central que conecta pessoas, imóveis, processos e informação."
        />
      </Reveal>

      <Reveal delay={0.08}>
        <div className="relative mt-14">
          <div className="grid gap-2.5 sm:grid-cols-3">
            {ECOSSISTEMA.map((e, i) => (
              <div
                key={e}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/50 px-4 py-3.5 transition-colors duration-300 hover:border-accent/35"
              >
                <span className="min-w-0 truncate text-[13.5px]">{e}</span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <p className="font-display text-[19px] tracking-tight text-balance sm:text-[22px]">
              Uma operação inteira conectada em um único ambiente.
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

/* ---------------- MÓDULOS ---------------- */

const MODULOS = [
  { icon: Building2, title: "Imóveis", desc: "Tenha todas as informações de cada imóvel organizadas e acessíveis." },
  { icon: Users, title: "Proprietários", desc: "Centralize dados e informações importantes dos proprietários." },
  { icon: Wrench, title: "Fornecedores", desc: "Saiba quem são seus fornecedores, o que fazem e como acioná-los." },
  { icon: Boxes, title: "Inventário", desc: "Controle os itens e recursos de cada imóvel sem depender de planilhas dispersas." },
  { icon: ClipboardList, title: "Instruções", desc: "Transforme conhecimento operacional em instruções claras e acessíveis." },
  { icon: FileText, title: "Registros", desc: "Registre ocorrências, informações e acontecimentos importantes da operação." },
  { icon: Bot, title: "IA de Atendimento", desc: "Uma inteligência preparada para responder aos hóspedes com base no conhecimento da sua operação." },
  { icon: BookOpen, title: "Guia do Hóspede", desc: "Entregue uma experiência sofisticada com um guia digital completo e personalizado." },
];

export function ModulesSection() {
  return (
    <Section id="recursos">
      <Reveal>
        <SectionHeading eyebrow="Módulos" title="Tudo conectado. Tudo acessível." />
      </Reveal>

      <div className="mt-14 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {MODULOS.map((m, i) => (
          <Reveal key={m.title} delay={Math.min(i * 0.04, 0.24)}>
            <Surface hover className="h-full p-5">
              <m.icon className="size-4 text-accent" />
              <p className="mt-4 font-display text-[14.5px] tracking-tight">{m.title}</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">{m.desc}</p>
            </Surface>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ---------------- IA ---------------- */

export function AiSection() {
  return (
    <Section className="relative overflow-hidden">
      <Glow className="right-[-100px] top-0 h-[300px] w-[380px]" />
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="Inteligência"
            title="Uma IA que conhece a sua operação."
            description="O ConciergeIA utiliza as informações da sua operação para ajudar no atendimento ao hóspede, tornando respostas e orientações mais rápidas, consistentes e alinhadas ao seu padrão."
          />
          <ul className="mt-8 space-y-2.5">
            {[
              "Responde com base no que está cadastrado, não em suposições.",
              "Mantém o mesmo padrão de resposta em todos os imóveis.",
              "Encaminha para a equipe quando o assunto exige decisão humana.",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[13.5px] text-muted-foreground">
                <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                <span className="min-w-0">{t}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.08}>
          <ChatMockup />
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------------- GUIA ---------------- */

export function GuideSection() {
  return (
    <Section>
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-16">
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="Experiência do hóspede"
            title="Seu imóvel merece mais do que um manual."
            description="Crie uma experiência digital sofisticada para orientar seus hóspedes antes, durante e depois da estadia."
          />
        </Reveal>
        <Reveal delay={0.08}>
          <GuideMockup />
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------------- ANTES / DEPOIS ---------------- */

const PERGUNTAS = [
  "Qual era mesmo a senha do Wi-Fi?",
  "Onde está a instrução desse imóvel?",
  "Qual fornecedor atende esse apartamento?",
  "Quando foi feita a última manutenção?",
  "Quem é o proprietário desse imóvel?",
];

export function BeforeAfter() {
  return (
    <Section className="relative overflow-hidden">
      <Reveal>
        <SectionHeading eyebrow="No dia a dia" title="Menos procura. Mais controle." />
      </Reveal>

      <div className="mt-14 grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.8fr)]">
        <Reveal delay={0.05}>
          <div className="space-y-2">
            {PERGUNTAS.map((p) => (
              <p
                key={p}
                className="rounded-xl border border-dashed border-border px-4 py-3 text-[13px] italic text-muted-foreground/80"
              >
                “{p}”
              </p>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="flex items-center justify-center">
            <ArrowRight className="size-5 rotate-90 text-accent lg:rotate-0" />
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <Surface className="p-8 text-center">
            <p className="font-display text-[21px] leading-snug tracking-tight text-balance">
              Está tudo no ConciergeIA.
            </p>
          </Surface>
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------------- MULTI-IMÓVEL ---------------- */

const CONECTADOS = ["Pessoas", "Informações", "Inventário", "Processos", "Fornecedores", "Atendimento", "IA"];

export function MultiPropertySection() {
  return (
    <Section className="relative overflow-hidden">
      <Glow className="left-1/2 top-1/2 h-[300px] w-[520px] -translate-x-1/2 -translate-y-1/2" />
      <Reveal>
        <SectionHeading
          eyebrow="Escala"
          title="De um imóvel a dezenas. A organização continua."
          description="Quanto maior sua operação, maior o valor de ter tudo centralizado."
        />
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-14 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card/50 px-3.5 py-3 text-[12.5px] text-muted-foreground"
              >
                Imóvel {String(i + 1).padStart(2, "0")}
              </div>
            ))}
          </div>

          <Surface className="p-6">
            <Eyebrow>Conectados a</Eyebrow>
            <div className="mt-4 flex flex-wrap gap-2">
              {CONECTADOS.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          </Surface>
        </div>
      </Reveal>
    </Section>
  );
}

/* ---------------- DIFERENCIAL ---------------- */

const ISOLADAS = ["WhatsApp", "Planilhas", "Documentos", "Anotações", "CRM", "Manuais"];

export function DifferentiatorSection() {
  return (
    <Section>
      <Reveal>
        <SectionHeading
          eyebrow="Diferencial"
          title="Não é apenas gestão. É conhecimento operacional."
          description="Softwares tradicionais organizam tarefas. O ConciergeIA organiza o conhecimento que faz sua operação funcionar."
        />
      </Reveal>

      <div className="mt-14 grid gap-3 lg:grid-cols-2">
        <Reveal delay={0.05}>
          <div className="h-full rounded-2xl border border-dashed border-border p-6">
            <Eyebrow>Ferramentas isoladas</Eyebrow>
            <div className="mt-4 flex flex-wrap gap-2">
              {ISOLADAS.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-5 text-[13px] leading-relaxed text-muted-foreground text-pretty">
              Cada informação em um lugar diferente. O conhecimento depende de quem lembra dele.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <Surface className="h-full p-6">
            <Eyebrow>ConciergeIA</Eyebrow>
            <p className="mt-4 font-display text-[19px] tracking-tight text-balance">
              Uma fonte central de conhecimento operacional.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground text-pretty">
              Imóveis, pessoas, processos e atendimento no mesmo ambiente — acessível para toda a equipe, no padrão
              que você definiu.
            </p>
          </Surface>
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------------- PROVA SOCIAL (placeholders) ---------------- */

export function SocialProofSection() {
  return (
    <Section>
      <Reveal>
        <SectionHeading eyebrow="Prova social" title="Operações que já organizaram seu conhecimento." />
      </Reveal>

      <Reveal delay={0.06}>
        <div className="mt-12 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="grid h-16 place-items-center rounded-xl border border-dashed border-border text-[11px] text-muted-foreground/70"
            >
              Espaço para logo {i + 1}
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-3 grid gap-2.5 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-dashed border-border p-6">
              <p className="text-[12.5px] leading-relaxed text-muted-foreground/70">
                Espaço reservado para depoimento de cliente.
              </p>
              <p className="mt-5 text-[11px] text-muted-foreground/60">Nome · Operação · Cidade</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.14}>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {["Imóveis atendidos", "Operações ativas", "Cidades"].map((k) => (
            <div key={k} className="rounded-2xl border border-dashed border-border p-6 text-center">
              <p className="font-display text-[22px] text-muted-foreground/50">—</p>
              <p className="mt-2 text-[11.5px] text-muted-foreground/70">{k}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <p className="mt-6 text-center text-[11px] text-muted-foreground/60">
        Números, logos e depoimentos serão publicados conforme autorização dos clientes.
      </p>
    </Section>
  );
}

/* ---------------- CTA FINAL ---------------- */

export function FinalCTA() {
  return (
    <Section className="relative overflow-hidden">
      <Glow className="left-1/2 top-1/2 h-[360px] w-[620px] -translate-x-1/2 -translate-y-1/2" />
      <Reveal>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-[28px] leading-[1.1] tracking-tight text-balance sm:text-[44px]">
            Sua operação merece um lugar para chamar de casa.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-relaxed text-muted-foreground text-pretty sm:text-[17px]">
            Centralize sua operação, organize seu conhecimento e transforme a maneira como você administra seus
            imóveis.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#contato"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-[14px] font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5"
            >
              Conhecer o ConciergeIA <ArrowRight className="size-4" />
            </a>
            <a
              href="#contato"
              className="inline-flex h-11 items-center rounded-full border border-border px-6 text-[14px] text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
            >
              Solicitar demonstração
            </a>
          </div>
        </div>
      </Reveal>
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
