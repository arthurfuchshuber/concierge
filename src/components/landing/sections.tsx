import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  House,
  LockKeyhole,
  MapPin,
  MessageSquare,
  Plus,
  Smartphone,
  UserCheck,
  Users,
} from "lucide-react";
import { Reveal, Section, SectionHeading } from "./primitives";
import { LiveGuideFrame } from "./LiveGuideFrame";
import { cn } from "@/lib/utils";

/*
 * LANDING — layout aprovado pelo cliente no canvas "ConciergeIA — nova
 * landing (proposta)" em 17/09/2026. Regras que valem para toda a página:
 * - grade de 1200 px, mesma distância entre seções (ver `Section`);
 * - um único texto de ação principal: "Agendar demonstração";
 * - nada de número, depoimento ou promessa que o sistema não faça.
 */

const CARD = "rounded-[20px] border border-white/[0.09] bg-white/[0.035]";

/* ---------------- HERO ---------------- */

const DESTAQUES_ESQ = [
  {
    icon: House,
    title: "Check-in guiado",
    desc: "Chegada, regras e saída passo a passo, no celular do hóspede.",
    short: "Chegada, regras e saída passo a passo.",
  },
  {
    icon: LockKeyhole,
    title: "Senhas protegidas",
    desc: "Wi-Fi, portão e fechadura só aparecem com reserva ativa.",
    short: "Só com reserva ativa.",
  },
];

const DESTAQUES_DIR = [
  {
    icon: MessageSquare,
    title: "IA que conhece o imóvel",
    desc: "Responde o hóspede a qualquer hora, em português e inglês.",
    short: "Responde em português e inglês.",
  },
  {
    icon: MapPin,
    title: "Dicas da cidade",
    desc: "Restaurantes, passeios e mercados perto de cada imóvel.",
    short: "Passeios e restaurantes perto.",
  },
];

function Destaque({ d }: { d: (typeof DESTAQUES_ESQ)[number] }) {
  return (
    <div className={cn(CARD, "w-[320px] p-6 text-left")}>
      <span className="grid size-10 place-items-center rounded-xl bg-[#e24fc9]/12 text-[#e97bd6]">
        <d.icon className="size-5" />
      </span>
      <h3 className="mt-4 font-display text-[18px] font-bold">{d.title}</h3>
      <p className="mt-1.5 text-[14px] leading-[1.55] text-[#a9a39b]">{d.desc}</p>
    </div>
  );
}

/**
 * Moldura do guia (17/09/2026, pedido do cliente com print): SEM carcaça de
 * celular e SEM borda — só a tela com cantos de 28 px, uma luz roxa/rosa bem
 * fraca ao fundo e o neon girando no contorno. O trecho parado do contorno é
 * transparente, senão ele aparece como uma linha.
 *
 * A intensidade da luz de fundo fica no próprio elemento (`opacity-30`), não só
 * na animação: quando a animação não roda (sistema com "reduzir movimento"),
 * a luz não pode aparecer com força total.
 */
function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="lp-breathe pointer-events-none absolute -inset-4 rounded-[42px] opacity-30 blur-[20px] lg:-inset-5 lg:rounded-[48px] lg:blur-[24px]"
        style={{ background: "linear-gradient(140deg, #7c1ad8, #e82dae)" }}
      />
      <div className="relative overflow-hidden rounded-[28px] p-[1.5px] shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)]">
        <div
          aria-hidden
          className="lp-ring"
          style={{
            background:
              "conic-gradient(from 0deg, rgba(139,43,226,0) 0deg, rgba(139,43,226,0) 240deg, #8b2be2 295deg, #e82dae 335deg, rgba(232,45,174,0) 360deg)",
          }}
        />
        <div className="relative overflow-hidden rounded-[26.5px] bg-[#07070d]">{children}</div>
      </div>
    </div>
  );
}

/**
 * Seletor do mockup (17/09/2026). Hoje só existe "O Guia Digital"; outros
 * mockups (painel etc.) entram como novos botões iguais, lado a lado, e o
 * ponto de luz passa para o que estiver selecionado. Discreto de propósito:
 * contorno de 1 px, sem fundo; no hover o contorno fica rosa.
 */
const DEMOS = [{ id: "guia", label: "O Guia Digital" }] as const;

function DemoTabs() {
  const ativo = "guia";
  return (
    <div className="mb-3.5 flex items-center justify-center gap-2.5 lg:gap-4">
      <span
        aria-hidden
        className="h-px w-6 lg:w-14"
        style={{
          background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(233,123,214,0.45))",
        }}
      />
      <div role="tablist" aria-label="Demonstrações" className="flex items-center gap-2">
        {DEMOS.map((d) => (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={d.id === ativo}
            className="inline-flex h-9 cursor-pointer items-center gap-2.5 rounded-full border border-white/[0.16] px-4 font-display text-[11.5px] font-semibold tracking-[0.24em] whitespace-nowrap text-[#f6f3ef] uppercase transition-colors duration-300 hover:border-[#e82dae]/55 hover:bg-[#e82dae]/[0.06]"
          >
            {d.id === ativo ? (
              <span
                aria-hidden
                className="lp-live size-[5px] rounded-full bg-[linear-gradient(135deg,#8b2be2,#e82dae)] shadow-[0_0_6px_rgba(232,45,174,0.8)]"
              />
            ) : null}
            {d.label}
          </button>
        ))}
      </div>
      <span
        aria-hidden
        className="h-px w-6 lg:w-14"
        style={{
          background: "linear-gradient(90deg, rgba(233,123,214,0.45), rgba(255,255,255,0))",
        }}
      />
    </div>
  );
}

/* ---------------- CONSTELAÇÃO (celular e tablet) ---------------- */

/**
 * Os 4 destaques em telas menores que 1280 px (17/09/2026, opção C aprovada):
 * uma esfera "IA" no centro, ligada aos 4 recursos por linhas tracejadas em
 * movimento. Espaçamentos no celular (17/09/2026, pedido do cliente: "um pouco
 * mais" que os 72 px anteriores): 96 px do celular até a constelação, da
 * constelação até a faixa de capacidades e da faixa até "Como funciona"
 * (88 px da seção + `mb-2` da faixa). Títulos com iniciais maiúsculas, como o
 * cliente editou no canvas.
 */
const CONSTELACAO = [
  { icon: House, title: "Check-in Guiado", desc: "Chegada, regras e saída passo a passo." },
  {
    icon: LockKeyhole,
    title: "Senhas Protegidas",
    desc: "Wi-Fi, portão e fechadura só com reserva ativa.",
  },
  {
    icon: MessageSquare,
    title: "IA de Atendimento",
    desc: "Responde o hóspede em português e inglês.",
  },
  { icon: MapPin, title: "Dicas da Cidade", desc: "Passeios, restaurantes e mercados perto." },
];

function ConstelacaoNo({ c, lado }: { c: (typeof CONSTELACAO)[number]; lado: "cima" | "baixo" }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center text-center",
        lado === "cima" ? "justify-end" : "justify-start",
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl border border-[#e82dae]/45 bg-[#14100e] text-[#f0a6e4] shadow-[0_0_24px_-6px_rgba(232,45,174,0.6)]">
        <c.icon className="size-[22px]" strokeWidth={1.8} />
      </span>
      <h3 className="mt-2.5 font-display text-[14.5px] leading-tight font-bold">{c.title}</h3>
      <p className="mt-1 text-[12.5px] leading-[1.45] text-[#a9a39b]">{c.desc}</p>
    </div>
  );
}

function Constelacao() {
  const linhas = [
    "M25 0 C 28 45, 42 58, 50 50",
    "M75 0 C 72 45, 58 58, 50 50",
    "M25 100 C 28 55, 42 42, 50 50",
    "M75 100 C 72 55, 58 42, 50 50",
  ];
  return (
    <div className="mx-auto mt-[96px] grid w-full max-w-[350px] grid-cols-2 gap-x-5 xl:hidden">
      <ConstelacaoNo c={CONSTELACAO[0]} lado="cima" />
      <ConstelacaoNo c={CONSTELACAO[1]} lado="cima" />

      <div className="relative col-span-2 h-[170px]">
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          <defs>
            <linearGradient id="lp-constelacao" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8b2be2" />
              <stop offset="1" stopColor="#e82dae" />
            </linearGradient>
          </defs>
          {linhas.map((d) => (
            <path
              key={d}
              d={d}
              className="lp-dash"
              stroke="url(#lp-constelacao)"
              strokeWidth={1.2}
              strokeDasharray="4 6"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div
          aria-hidden
          className="lp-spin-slow absolute top-1/2 left-1/2 -mt-[60px] -ml-[60px] size-[120px] rounded-full border border-dashed border-[#e97bd6]/35"
        />
        <div className="lp-pulse absolute top-1/2 left-1/2 -mt-[35px] -ml-[35px] grid size-[70px] place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#f7c6ec,#e82dae_40%,#7c1ad8_100%)] shadow-[0_0_50px_rgba(232,45,174,0.7)]">
          <span className="font-display text-[16px] font-extrabold text-white">IA</span>
        </div>
      </div>

      <ConstelacaoNo c={CONSTELACAO[2]} lado="baixo" />
      <ConstelacaoNo c={CONSTELACAO[3]} lado="baixo" />
    </div>
  );
}

export function Hero() {
  return (
    <section id="topo" className="relative overflow-x-clip pt-16 lg:pt-28">
      <div
        aria-hidden
        className="lp-grid pointer-events-none absolute inset-x-0 top-0 h-[620px] lg:h-[900px]"
      />
      <div
        aria-hidden
        className="lp-drift pointer-events-none absolute -top-40 left-1/2 -ml-[300px] h-[380px] w-[420px] rounded-full lg:-top-56 lg:-ml-[620px] lg:h-[560px] lg:w-[760px]"
        style={{
          background:
            "radial-gradient(closest-side, rgba(124,26,216,0.34), rgba(124,26,216,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="lp-drift-rev pointer-events-none absolute -top-32 left-1/2 -ml-[60px] h-[340px] w-[380px] rounded-full lg:-top-44 lg:-ml-[80px] lg:h-[520px] lg:w-[700px]"
        style={{
          background:
            "radial-gradient(closest-side, rgba(232,45,174,0.26), rgba(232,45,174,0) 70%)",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-[1200px] flex-col items-center px-5 text-center sm:px-8 xl:px-0">
        <Reveal className="flex flex-col items-center">
          <p className="inline-flex h-[30px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#cfc9c2] lg:h-[34px] lg:gap-2.5 lg:px-4 lg:text-[12px] lg:tracking-[0.2em]">
            <span className="size-1.5 rounded-full bg-[#e24fc9]" />
            <span className="lg:hidden">Software SaaS para hospedagem</span>
            <span className="hidden lg:inline">
              Software SaaS por assinatura para gestão de hospedagem
            </span>
          </p>

          <h1 className="mt-6 font-display text-[40px] leading-[1.08] font-extrabold tracking-[-0.03em] sm:text-[48px] lg:mt-8 lg:text-[64px] xl:text-[72px] lg:leading-[1.04] lg:tracking-[-0.035em]">
            <span className="lg:block lg:whitespace-nowrap">
              O <span className="lp-shimmer">cérebro</span> da sua operação
            </span>{" "}
            <span className="lg:block lg:whitespace-nowrap">de hospedagem.</span>
          </h1>

          <p className="mt-5 max-w-[680px] text-[16px] leading-relaxed text-[#b7b1a9] lg:mt-7 lg:max-w-none lg:text-[20px] lg:leading-[1.6]">
            <span className="lg:block lg:whitespace-nowrap">
              Sua equipe sabe exatamente o que fazer. Seu hóspede tem resposta na hora.
            </span>{" "}
            <span className="font-semibold text-[#f6f3ef] lg:block">
              E você para de apagar incêndio.
            </span>
          </p>

          <p className="mt-4 max-w-[680px] text-[14px] leading-relaxed text-[#8f8981] lg:text-[15px]">
            ConciergeIA é uma plataforma de software (SaaS) por assinatura, acessada pelo navegador.
            Todo o atendimento ao hóspede é feito automaticamente pelo aplicativo, com inteligência
            artificial — não é um serviço de concierge prestado por pessoas.
          </p>

          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:gap-4 lg:mt-10">
            <a
              href="#contato"
              className="inline-flex h-14 items-center justify-center gap-2.5 rounded-[14px] bg-[linear-gradient(100deg,#8b2be2,#e82dae)] px-6 text-[16px] font-bold whitespace-nowrap text-white shadow-[0_12px_40px_-12px_rgba(232,45,174,0.7)] transition-transform duration-200 hover:-translate-y-0.5 sm:w-[272px]"
            >
              Agendar demonstração <ArrowRight className="size-[18px]" />
            </a>
            <a
              href="#guia"
              className="inline-flex h-14 items-center justify-center gap-2.5 rounded-[14px] border border-white/[0.14] bg-white/[0.04] px-6 text-[16px] font-semibold whitespace-nowrap text-[#f6f3ef] transition-colors hover:border-white/25 sm:w-[272px]"
            >
              <Smartphone className="size-[18px]" /> Ver o guia ao vivo
            </a>
          </div>
        </Reveal>

        {/* Palco simétrico: 2 destaques | guia real | 2 destaques */}
        <Reveal delay={0.08} className="w-full">
          <div
            id="guia"
            className="mt-14 grid w-full scroll-mt-20 items-center gap-8 lg:mt-[88px] xl:grid-cols-[minmax(0,1fr)_380px_minmax(0,1fr)] xl:gap-14"
          >
            <div className="lp-float hidden flex-col items-end gap-6 xl:flex">
              {DESTAQUES_ESQ.map((d) => (
                <Destaque key={d.title} d={d} />
              ))}
            </div>

            <div className="mx-auto w-full max-w-[380px]">
              <DemoTabs />
              <PhoneShell>
                <LiveGuideFrame />
              </PhoneShell>
            </div>

            <div className="lp-float-late hidden flex-col items-start gap-6 xl:flex">
              {DESTAQUES_DIR.map((d) => (
                <Destaque key={d.title} d={d} />
              ))}
            </div>
          </div>

          {/* Telas menores que 1280 px: a constelação, 96 px abaixo do celular. */}
          <Constelacao />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- FAIXA DE CAPACIDADES ---------------- */

const CAPACIDADES = [
  { title: "Guia por imóvel", desc: "Link e QR code próprios", short: "Link e QR code" },
  { title: "PT + EN", desc: "Guia e IA bilíngues", short: "Guia e IA bilíngues" },
  { title: "Airbnb", desc: "Importação automática dos anúncios", short: "Importação automática" },
  { title: "Equipe junta", desc: "Limpeza, manutenção e atendimento", short: "Um fluxo só" },
];

export function CapabilityStrip() {
  return (
    <div className="mx-auto mt-[96px] mb-2 w-full max-w-[1200px] px-5 sm:px-8 lg:mt-[120px] lg:mb-0 xl:px-0">
      <Reveal>
        <div className="relative grid grid-cols-2 border-b border-white/[0.08] text-center lg:grid-cols-4">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(139,43,226,0.8) 30%, rgba(232,45,174,0.8) 70%, transparent)",
            }}
          />
          {CAPACIDADES.map((c, i) => (
            <div
              key={c.title}
              className={cn(
                "px-2 py-6 lg:px-6 lg:py-9",
                i % 2 === 1 && "border-l border-white/[0.08]",
                i < 2 && "border-b border-white/[0.08] lg:border-b-0",
                i === 2 && "lg:border-l lg:border-white/[0.08]",
              )}
            >
              <p className="font-display text-[17px] font-bold lg:text-[20px]">{c.title}</p>
              <p className="mt-1 text-[12.5px] text-[#a9a39b] lg:mt-1.5 lg:text-[14px]">
                <span className="lg:hidden">{c.short}</span>
                <span className="hidden lg:inline">{c.desc}</span>
              </p>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

/* ---------------- COMO FUNCIONA ---------------- */

const PASSOS = [
  {
    n: "01",
    title: "Registros e histórico",
    desc: "Inventário, fornecedores e ocorrências de cada imóvel, fora dos grupos e planilhas.",
  },
  {
    n: "02",
    title: "Operação conjunta",
    desc: "A equipe sabe o que precisa ser feito em cada imóvel, e quando.",
  },
  {
    n: "03",
    title: "IA com conhecimento",
    desc: "Respostas baseadas no histórico real de cada propriedade.",
  },
  {
    n: "04",
    title: "Hóspedes satisfeitos",
    desc: "Menos dúvidas repetidas e uma estadia que parece cuidada nos detalhes.",
  },
];

export function FlowSection() {
  return (
    <Section id="como">
      <Reveal>
        <SectionHeading
          eyebrow="Como funciona"
          title={
            <>
              Quatro camadas.
              <br />
              Uma operação só.
            </>
          }
          description={
            <span className="hidden lg:inline">
              Cada camada alimenta a próxima: o que a equipe registra vira resposta certa para o
              hóspede.
            </span>
          }
        />
      </Reveal>

      {/* Computador: linha do tempo com um ponto de luz percorrendo 01 → 04 */}
      <div className="relative mt-16 hidden grid-cols-4 gap-6 lg:grid">
        <div
          aria-hidden
          className="absolute top-11 right-[12.5%] left-[12.5%] h-px"
          style={{
            background: "linear-gradient(90deg, rgba(139,43,226,0.6), rgba(232,45,174,0.6))",
          }}
        >
          <span
            className="lp-travel absolute -top-[3px] -ml-[60px] h-[7px] w-[120px] rounded-full"
            style={{
              background:
                "radial-gradient(closest-side, #ffffff, rgba(232,45,174,0.8) 45%, rgba(232,45,174,0))",
            }}
          />
        </div>
        {PASSOS.map((p, i) => (
          <Reveal key={p.n} delay={0.05 * i}>
            <div className="relative flex flex-col items-center px-2 text-center">
              <Numero n={p.n} last={i === PASSOS.length - 1} size="lg" />
              <h3 className="mt-7 font-display text-[20px] font-bold">{p.title}</h3>
              <p className="mt-2.5 text-[15px] leading-relaxed text-[#a9a39b]">{p.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>

      {/* Celular: cartões com linha vertical e o mesmo ponto de luz, descendo */}
      <MobileTimeline />
    </Section>
  );
}

/**
 * A linha liga o centro do 01 ao centro do 04. Os cartões têm alturas
 * diferentes, então a distância é medida depois de montar (e ao redimensionar).
 */
function MobileTimeline() {
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef<HTMLDivElement | null>(null);
  const [lineHeight, setLineHeight] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (lastRef.current) setLineHeight(lastRef.current.offsetTop);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && listRef.current) ro.observe(listRef.current);
    return () => ro?.disconnect();
  }, []);

  return (
    <div ref={listRef} className="relative mt-10 flex flex-col gap-3 lg:hidden">
      {lineHeight > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute top-[42px] left-[42px] z-10 w-px"
          style={{
            height: lineHeight,
            background: "linear-gradient(180deg, rgba(139,43,226,0.6), rgba(232,45,174,0.6))",
          }}
        >
          <span
            className="lp-travel-y absolute -left-[3px] -mt-[45px] h-[90px] w-[7px] rounded-full"
            style={{
              background:
                "radial-gradient(closest-side, #ffffff, rgba(232,45,174,0.8) 45%, rgba(232,45,174,0))",
            }}
          />
        </div>
      ) : null}
      {PASSOS.map((p, i) => {
        const last = i === PASSOS.length - 1;
        return (
          <div key={p.n} ref={last ? lastRef : undefined} className={cn(CARD, "flex gap-4 p-5")}>
            <span className="relative z-20">
              <Numero n={p.n} last={last} size="sm" />
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-[17px] font-bold">{p.title}</h3>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#a9a39b]">{p.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Numero({ n, last, size }: { n: string; last: boolean; size: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-display font-bold",
        size === "lg" ? "size-[88px] text-[22px]" : "size-11 text-[15px]",
        last
          ? "bg-[linear-gradient(135deg,#7c1ad8,#e82dae)] text-white"
          : "border border-[#e82dae]/45 bg-[#0e0b09] text-[#e97bd6]",
      )}
    >
      {n}
    </span>
  );
}

/* ---------------- PARA QUEM É ---------------- */

const PERFIS = [
  {
    icon: UserCheck,
    title: "Anfitriões profissionais",
    desc: "Padrão e qualidade em cada detalhe da experiência, sem improviso.",
    short: "Padrão e qualidade em cada detalhe, sem improviso.",
  },
  {
    icon: Building2,
    title: "Múltiplas propriedades",
    desc: "Vários imóveis e proprietários com visão completa de cada unidade.",
    short: "Visão completa de cada unidade e proprietário.",
  },
  {
    icon: Users,
    title: "Equipes operacionais",
    desc: "Limpeza, manutenção e atendimento no mesmo fluxo, sem ruído.",
    short: "Limpeza, manutenção e atendimento no mesmo fluxo.",
  },
];

export function AudienceSection() {
  return (
    <Section id="para-quem">
      <Reveal>
        <SectionHeading
          eyebrow="Para quem é"
          title={
            <>
              <span className="lg:hidden">Para quem quer uma operação estruturada.</span>
              <span className="hidden lg:inline">
                Para quem quer uma operação
                <br />
                estruturada e escalável.
              </span>
            </>
          }
        />
      </Reveal>

      <div className="mt-10 grid gap-3 lg:mt-16 lg:grid-cols-3 lg:gap-6">
        {PERFIS.map((p, i) => (
          <Reveal key={p.title} delay={0.05 * i} className="h-full">
            <div className="group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-white/[0.09] px-6 py-7 text-center transition-[transform,border-color] duration-300 ease-[cubic-bezier(.22,1,.36,1)] hover:-translate-y-1 hover:border-[#e82dae]/45 bg-[radial-gradient(120%_70%_at_50%_0%,rgba(139,43,226,0.14),rgba(255,255,255,0.02)_60%)] lg:items-center lg:rounded-[24px] lg:px-8 lg:py-10">
              <div
                aria-hidden
                className="absolute inset-x-[20%] top-0 h-px"
                style={{ background: "linear-gradient(90deg, transparent, #e82dae, transparent)" }}
              />
              <span className="hidden size-14 place-items-center rounded-2xl bg-[#e24fc9]/12 text-[#e97bd6] lg:grid">
                <p.icon className="size-[26px]" strokeWidth={1.8} />
              </span>
              <h3 className="font-display text-[19px] font-bold lg:mt-6 lg:text-[22px]">
                {p.title}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.55] text-[#a9a39b] lg:mt-3 lg:text-[15px] lg:leading-relaxed">
                <span className="lg:hidden">{p.short}</span>
                <span className="hidden lg:inline">{p.desc}</span>
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ---------------- DÚVIDAS ---------------- */

/**
 * Perguntas frequentes (17/09/2026). Cada resposta foi conferida no código:
 * guia abre no navegador (link/QR), senhas só com código de reserva ativo ou
 * PIN (`guest-access.server.ts`), edição manual sem Airbnb, bilíngue PT/EN,
 * gestão de equipe no Business, cancelamento pelo Paddle.
 */
const FAQ = [
  {
    q: "O hóspede precisa baixar um aplicativo?",
    qShort: "O hóspede precisa baixar um app?",
    a: "Não. O guia abre direto no navegador, por link ou QR code.",
  },
  {
    q: "As senhas do imóvel ficam protegidas?",
    qShort: "As senhas ficam protegidas?",
    a: "Sim. Wi-Fi, portão e fechadura só são liberados para quem informa uma reserva ativa ou o PIN do imóvel.",
  },
  {
    q: "Preciso ter anúncio no Airbnb?",
    a: "Não. A importação do Airbnb é opcional: dá para cadastrar e editar tudo manualmente.",
  },
  {
    q: "A IA atende em outros idiomas?",
    a: "O guia e o atendimento por IA funcionam em português e inglês.",
  },
  {
    q: "Minha equipe consegue usar junto?",
    qShort: "Minha equipe usa junto?",
    a: "Sim. No plano Business você convida a equipe e define o que cada pessoa pode ver e fazer.",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Sim. A assinatura pode ser cancelada a qualquer momento.",
  },
];

export function FaqSection() {
  return (
    <section
      id="faq"
      className="relative mt-[88px] scroll-mt-16 lg:scroll-mt-20 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.03)_20%,rgba(255,255,255,0.03)_80%,rgba(255,255,255,0)_100%)] py-16 lg:mt-[136px] lg:py-28"
    >
      <div aria-hidden className="lp-dots pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-[1200px] px-5 sm:px-8 xl:px-0">
        <Reveal>
          <SectionHeading eyebrow="Dúvidas" title="Perguntas frequentes" />
        </Reveal>
        <div className="mt-10 grid items-start gap-2.5 lg:mt-16 lg:grid-cols-2 lg:gap-x-6 lg:gap-y-4">
          {FAQ.map((f, i) => (
            <details
              key={f.q}
              open={i === 0}
              className="group rounded-2xl border border-white/[0.09] bg-[#14100e] px-5 py-5 lg:rounded-[20px] lg:px-8 lg:py-7"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[15.5px] font-semibold [&::-webkit-details-marker]:hidden lg:text-[18px]">
                <span>
                  <span className="lg:hidden">{f.qShort ?? f.q}</span>
                  <span className="hidden lg:inline">{f.q}</span>
                </span>
                <Plus className="size-4 shrink-0 text-[#e97bd6] transition-transform duration-300 group-open:rotate-45" />
              </summary>
              <p className="mt-2.5 text-[14px] leading-[1.55] text-[#a9a39b] lg:mt-3 lg:text-[15px] lg:leading-relaxed">
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- RODAPÉ ---------------- */

const LINKS_PRODUTO = [
  { href: "#como", label: "Como funciona" },
  { href: "#planos", label: "Planos" },
  { href: "#faq", label: "Dúvidas" },
];

const LINKS_INSTITUCIONAL = [
  { to: "/termos", label: "Termos de Serviço" },
  { to: "/privacidade", label: "Política de Privacidade" },
  { to: "/reembolso", label: "Política de Reembolso" },
  { to: "/confianca", label: "Confiança" },
] as const;

export function LandingFooter() {
  return (
    <footer className="mt-[88px] border-t border-white/[0.07] lg:mt-[136px]">
      <div className="mx-auto w-full max-w-[1200px] px-5 pt-12 pb-8 sm:px-8 lg:pt-16 lg:pb-10 xl:px-0">
        {/* Computador: 3 colunas iguais (esquerda, centro, direita) */}
        <div className="hidden grid-cols-3 gap-6 lg:grid">
          <div>
            <p className="font-display text-[18px] font-bold">ConciergeIA</p>
            <p className="mt-3 max-w-[320px] text-[14px] leading-relaxed text-[#a9a39b]">
              Software (SaaS) por assinatura para gestão de hospedagem. Atendimento ao hóspede
              automatizado por inteligência artificial, sem operação manual.
            </p>
          </div>
          <nav className="flex flex-col items-center gap-2.5 text-[14px]">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#7d776f]">
              Produto
            </p>
            {LINKS_PRODUTO.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-[#a9a39b] transition-colors hover:text-white"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <nav className="flex flex-col items-end gap-2.5 text-[14px]">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#7d776f]">
              Institucional
            </p>
            {LINKS_INSTITUCIONAL.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="text-[#a9a39b] transition-colors hover:text-white"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Celular: tudo centralizado */}
        <div className="flex flex-col items-center gap-6 text-center lg:hidden">
          <p className="font-display text-[18px] font-bold">ConciergeIA</p>
          <nav className="grid grid-cols-2 gap-x-8 gap-y-3 text-[14px]">
            {LINKS_INSTITUCIONAL.map((l) => (
              <Link key={l.to} to={l.to} className="text-[#a9a39b]">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <p
          aria-hidden
          className="lp-wordmark mt-8 overflow-hidden text-center font-display text-[54px] leading-none font-extrabold tracking-[-0.05em] whitespace-nowrap select-none lg:mt-10 lg:text-[188px]"
        >
          ConciergeIA
        </p>

        <div className="mt-6 flex flex-col items-center gap-1 border-white/[0.07] text-center text-[12.5px] leading-relaxed text-[#7d776f] lg:flex-row lg:justify-between lg:border-t lg:pt-6 lg:text-[13px]">
          <p>© {new Date().getFullYear()} ConciergeIA. Todos os direitos reservados.</p>
          <p>
            Uma solução{" "}
            <a
              href="https://www.anfitriaosigma.com.br"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:text-white hover:underline"
            >
              Anfitrião Sigma
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
