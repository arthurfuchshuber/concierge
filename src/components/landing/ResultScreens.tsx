import { createContext, useContext } from "react";
import conciergeLogo from "@/assets/concierge-logo.png";
import recWaterfall from "@/assets/rec-waterfall.jpg";
import recCafe from "@/assets/rec-cafe.jpg";
import recRestaurant from "@/assets/rec-restaurant.jpg";
import recBeach from "@/assets/rec-beach.jpg";
import recMarket from "@/assets/rec-market.jpg";
import {
  Wifi,
  DoorOpen,
  LogOut,
  MapPin,
  Phone,
  Utensils,
  Coffee,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Home,
  Compass,
  Landmark,
  Search,
  SlidersHorizontal,
  Clock,
  Tv,
  WashingMachine,
  Star,
  MessageCircle,
  ChevronRight,
  ChevronDown,
  Wrench,
  CloudSun,
  Trees,
  BookOpen,
  Mic,
  Plus,
  X,
  RotateCcw,
  Check,
  Eye,
  Sun,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Brush,
  Camera,
  Users,
  CircleDollarSign,
} from "lucide-react";
import sceneApto from "@/assets/landing/scene-apto.jpg.asset.json";
import { cn } from "@/lib/utils";


/**
 * Telas de RESULTADO (o que o hóspede e a equipe realmente veem), recriadas
 * com a paleta e a tipografia da landing, espelhando fielmente o layout real
 * do guia digital, do atendimento IA (hóspede), do assistente interno e do
 * onboarding de chegada do hóspede.
 */

const GRAD = "linear-gradient(135deg,#7c1ad8 0%,#e82dae 100%)";

type NavKey = "home" | "checkin" | "saida" | "residencia" | "explore";

const NAV: Array<{ key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }> =
  [
    { key: "home", label: "Início", icon: Home },
    { key: "checkin", label: "Chegada", icon: KeyRound },
    { key: "saida", label: "Saída", icon: LogOut },
    { key: "explore", label: "Explorar", icon: Compass },
  ];

/** Permite que a barra inferior do mockup troque a tela exibida no celular. */
export const ScreenNavContext = createContext<((key: NavKey) => void) | null>(null);

function BottomBar({ active }: { active: NavKey }) {
  const onSelect = useContext(ScreenNavContext);
  return (
    <div className="mt-auto border-t border-white/8 bg-[#080815]/90 px-3 pb-3 pt-2 backdrop-blur">
      <ul className="flex items-stretch justify-around gap-1">
        {NAV.map((n) => {
          const on = n.key === active;
          return (
            <li key={n.key} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelect?.(n.key)}
                aria-current={on || undefined}
                className="flex w-full flex-col items-center gap-1 py-0.5 transition-transform active:scale-[0.96]"
              >
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-[0.3rem]",
                    on ? "text-white" : "text-white/55",
                  )}
                  style={on ? { background: GRAD } : undefined}
                >
                  <n.icon className="size-4" />
                </span>
                <span
                  className={cn("truncate text-[9px] font-bold", on ? "text-white" : "text-white/50")}
                >
                  {n.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ScreenShell({
  children,
  active,
  bar = true,
}: {
  children: React.ReactNode;
  active: NavKey;
  bar?: boolean;
}) {
  return (
    <div className="flex h-full min-h-[460px] min-w-0 flex-col bg-[#0a0a0f] text-foreground">
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      {bar ? <BottomBar active={active} /> : null}
    </div>
  );
}

/** Topo real do guia: marca + cidade + botão de tema. */
function GuideTopBar() {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 pt-3">
      <img src={conciergeLogo} alt="" aria-hidden className="size-4 shrink-0 object-contain" />
      <p className="truncate font-display text-[12.5px] font-extrabold tracking-tight">ConciergeIA</p>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1">
        <span className="size-1.5 rounded-full bg-emerald-400" />
        <span className="text-[8.5px] font-bold uppercase tracking-[0.18em] text-white/75">
          Foz do Iguaçu
        </span>
      </span>
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.05] text-white/70">
        <Sun className="size-3" />
      </span>
    </div>
  );
}

/** Capa real: foto escurecida com título serifado, subtítulo e indicador de fotos. */
function HeroCover({
  title,
  sub = "Tudo o que você precisa para uma estadia incrível.",
}: {
  title: string;
  sub?: string;
}) {
  return (
    <div className="px-3 pt-3">
      <div className="relative min-w-0 overflow-hidden rounded-[0.7rem] border border-white/10">
        <img
          src={sceneApto.url}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,8,18,0.15) 0%, rgba(8,8,18,0.55) 55%, rgba(8,8,18,0.92) 100%)",
          }}
        />
        <div className="relative flex min-h-[158px] flex-col justify-end p-3.5">
          <p className="font-display text-[19px] font-extrabold leading-[1.12] tracking-tight text-pretty">
            {title}
          </p>
          <p className="mt-1 text-[10.5px] leading-snug text-white/70 text-pretty">{sub}</p>
        </div>
        <div className="absolute bottom-2.5 right-3 flex items-center gap-1.5">
          <span className="h-[3px] w-5 rounded-full bg-white/85" />
          <span className="size-[3px] rounded-full bg-white/40" />
          <span className="size-[3px] rounded-full bg-white/40" />
          <span className="size-[3px] rounded-full bg-white/40" />
        </div>
      </div>
    </div>
  );
}


function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-1 text-[8.5px] font-bold uppercase tracking-[0.24em] text-white/60">
      <span className="size-1.5 rounded-full" style={{ background: GRAD }} />
      {children}
    </p>
  );
}

function Cover({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="relative px-4 pb-3 pt-9">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.3]"
        style={{ background: GRAD, maskImage: "linear-gradient(180deg,#000,transparent)" }}
      />
      <div className="relative min-w-0">
        <p className="text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">{eyebrow}</p>
        <p className="mt-1.5 font-display text-[17px] font-extrabold leading-tight tracking-tight text-pretty">
          {title}
        </p>
        {sub ? (
          <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground text-pretty">
            <MapPin className="size-3 shrink-0" /> {sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[0.6rem] border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <Icon className="size-3.5 shrink-0 text-accent" />
      <p className="min-w-0 text-[11px] leading-snug text-pretty">
        <span className="font-semibold">{label}</span>{" "}
        <span className="text-muted-foreground">{value}</span>
      </p>
    </div>
  );
}

function Step({
  n,
  icon: Icon,
  t,
  d,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  t: string;
  d: string;
}) {
  return (
    <div className="flex min-w-0 gap-3 rounded-[0.7rem] border border-white/10 bg-white/[0.04] p-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-[0.4rem] border border-white/12 text-[10px] font-bold text-accent">
        {n}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold">
          <Icon className="size-3.5 shrink-0 text-accent" /> {t}
        </p>
        <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground text-pretty">{d}</p>
      </div>
    </div>
  );
}

function Thumb({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <span
      className="grid size-12 shrink-0 place-items-center rounded-[0.5rem] border border-white/10"
      style={{
        background: "linear-gradient(140deg,rgba(124,26,216,0.55) 0%,rgba(232,45,174,0.35) 100%)",
      }}
    >
      <Icon className="size-5 text-white" />
    </span>
  );
}

/* =================== GUIA DIGITAL (layout real) =================== */

/** Tela inicial real: capa, contagem para o check-in, aviso e acessos rápidos. */
export function GuiaHomeScreen() {
  return (
    <ScreenShell active="home">
      <GuideTopBar />
      <HeroCover title="Casa Charmosa Próx. a Avenida das Cataratas" />
      <div className="min-w-0 space-y-2.5 px-3 pt-2.5">
        <div className="min-w-0 rounded-[0.3rem] border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Clock className="size-3.5 shrink-0 text-amber-400" />
            <p className="min-w-0 text-[11px] text-white/80">
              check-in libera em{" "}
              <span className="font-bold tabular-nums text-amber-300">11h42</span>
            </p>
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[10.5px] tabular-nums text-ice">
              15:00 <ChevronDown className="size-3 text-white/45" />
            </span>
          </div>
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/5 rounded-full bg-gradient-to-r from-amber-500 to-amber-300" />
          </div>
        </div>

        <div className="flex min-w-0 gap-2.5 rounded-[0.3rem] border border-amber-400/20 bg-amber-400/[0.06] p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[0.35rem] bg-amber-400/15 text-amber-300">
            <DoorOpen className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[8.5px] font-bold uppercase tracking-[0.2em] text-white/55">
              Importante · check-in
            </p>
            <p className="mt-1 text-[11.5px] leading-snug text-white/90 text-pretty">
              Nos mantenha informados a partir de 1 hora de distância da residência.
            </p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 px-1">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: GRAD }} />
          <p className="shrink-0 text-[8.5px] font-bold uppercase tracking-[0.24em] text-white/70">
            Acessos rápidos
          </p>
          <span className="h-px min-w-0 flex-1 bg-white/10" />
        </div>

        <div
          className="relative min-w-0 overflow-hidden rounded-[0.5rem] border border-white/10 p-3.5"
          style={{
            background: "linear-gradient(120deg,rgba(124,26,216,0.22),rgba(232,45,174,0.10))",
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-full border border-accent/25 bg-[#2a0f3d] text-accent">
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[17px] font-extrabold tracking-tight">
                Chegada
              </p>
              <p className="truncate text-[10.5px] text-white/60">Check-in a partir das 15h</p>
            </div>
          </div>
          <div className="mt-2.5 flex justify-end">
            <span
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white"
              style={{ background: GRAD }}
            >
              Comece aqui <ArrowRight className="size-3" />
            </span>
          </div>
        </div>
      </div>
    </ScreenShell>
  );
}

/** Continuação real da home: saída, Explorar, clima e bloco do Concierge IA. */
export function GuiaInteligenciaScreen() {
  return (
    <ScreenShell active="home">
      <div className="min-w-0 space-y-2.5 px-3 pt-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            { i: LogOut, t: "Saída", d: "Check-out até 11h" },
            { i: Wifi, t: "Wi-Fi", d: "Rede e senha" },
          ].map((a) => (
            <div
              key={a.t}
              className="min-w-0 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-3"
            >
              <span
                className="grid size-8 place-items-center rounded-[0.35rem]"
                style={{ background: GRAD }}
              >
                <a.i className="size-4 text-white" />
              </span>
              <p className="mt-2 truncate font-display text-[13px] font-bold">{a.t}</p>
              <p className="mt-0.5 truncate text-[10px] text-white/55">{a.d}</p>
            </div>
          ))}
        </div>

        <div className="flex min-w-0 items-center gap-3 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-3">
          <Thumb icon={Compass} />
          <div className="min-w-0">
            <p className="truncate font-display text-[13px] font-bold">Explore a região</p>
            <p className="truncate text-[10px] text-muted-foreground">
              388 lugares curados pelo anfitrião
            </p>
          </div>
          <ChevronRight className="ml-auto size-4 shrink-0 text-white/40" />
        </div>

        <div className="grid grid-cols-5 gap-2">
          <div className="col-span-2 min-w-0 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-3">
            <CloudSun className="size-5 text-accent" />
            <p className="mt-1.5 font-display text-[18px] font-extrabold leading-none">17°C</p>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">Garoa</p>
          </div>
          <div className="col-span-3 flex min-w-0 items-center justify-between gap-1 rounded-[0.5rem] border border-white/10 bg-white/[0.04] px-2.5 py-3">
            {[
              { d: "Hoje", a: "23°", b: "14°" },
              { d: "Qua", a: "24°", b: "10°" },
              { d: "Qui", a: "27°", b: "13°" },
            ].map((f) => (
              <div key={f.d} className="min-w-0 text-center">
                <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-white/50">
                  {f.d}
                </p>
                <CloudSun className="mx-auto mt-1 size-4 text-white/70" />
                <p className="mt-1 text-[9.5px] font-semibold">
                  {f.a} <span className="text-white/45">{f.b}</span>
                </p>
              </div>
            ))}
          </div>
        </div>

        <div
          className="min-w-0 rounded-[0.5rem] border border-accent/25 p-3"
          style={{
            background: "linear-gradient(135deg,rgba(124,26,216,0.22),rgba(232,45,174,0.14))",
          }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-full"
              style={{ background: GRAD }}
            >
              <Sparkles className="size-4 text-white" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-[13px] font-bold leading-tight text-pretty">
                Perguntar mais ao Atendimento ao Hóspede
              </p>
              <p className="mt-0.5 text-[10px] text-white/65 text-pretty">
                Respostas imediatas e personalizadas
              </p>
            </div>
            <span
              className="ml-auto grid size-8 shrink-0 place-items-center rounded-full"
              style={{ background: GRAD }}
            >
              <ChevronRight className="size-4 text-white" />
            </span>
          </div>
          <div className="mt-2.5 flex min-w-0 flex-wrap gap-1.5">
            {[
              { i: Landmark, t: "Cataratas hoje" },
              { i: MapPin, t: "Ir ao Paraguai" },
              { i: Utensils, t: "Onde jantar?" },
            ].map((c) => (
              <span
                key={c.t}
                className="flex min-w-0 items-center gap-1.5 rounded-[0.3rem] border border-white/12 bg-[#0a0a0f]/70 px-2.5 py-1.5 text-[10px] font-medium"
              >
                <c.i className="size-3 shrink-0 text-accent" /> {c.t}
              </span>
            ))}
          </div>
        </div>

        <SectionLabel>O que rola em Foz do Iguaçu</SectionLabel>
      </div>
    </ScreenShell>
  );
}

/** Última parte real da home: feed da cidade, FAQ e assinatura do guia. */
export function GuiaFinalScreen() {
  return (
    <ScreenShell active="home">
      <div className="min-w-0 space-y-2.5 px-3 pt-4">
        <SectionLabel>O que rola em Foz do Iguaçu</SectionLabel>
        {[
          {
            img: recWaterfall,
            t: "Cataratas com horário estendido no fim de semana",
            d: "Parque Nacional · hoje",
          },
          {
            img: recMarket,
            t: "Feira de artesanato na Praça da Paz",
            d: "Centro · a partir das 18h",
          },
        ].map((n) => (
          <div
            key={n.t}
            className="flex min-w-0 gap-3 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-2.5"
          >
            <div className="relative size-14 shrink-0 overflow-hidden rounded-[0.4rem] bg-white/5">
              <img src={n.img} alt="" className="absolute inset-0 size-full object-cover" />
            </div>
            <div className="min-w-0 self-center">
              <p className="line-clamp-2 text-[11.5px] font-semibold leading-snug text-pretty">
                {n.t}
              </p>
              <p className="mt-0.5 truncate text-[9.5px] text-muted-foreground">{n.d}</p>
            </div>
          </div>
        ))}

        <div className="flex min-w-0 items-center gap-3 rounded-[0.5rem] border border-accent/20 bg-accent/[0.08] p-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[0.4rem]" style={{ background: GRAD }}>
            <BookOpen className="size-4 text-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[13px] font-bold">Dúvidas frequentes</p>
            <p className="truncate text-[10px] text-white/60">Tudo sobre a casa em um toque</p>
          </div>
          <ChevronRight className="ml-auto size-4 shrink-0 text-white/40" />
        </div>

        <div className="flex min-w-0 items-center justify-center gap-2 pt-4">
          <img src={conciergeLogo} alt="" aria-hidden className="size-3.5 object-contain opacity-80" />
          <p className="text-[8.5px] font-semibold uppercase tracking-[0.3em] text-white/70">
            Seu concierge. Sua experiência.
          </p>
        </div>
      </div>
    </ScreenShell>
  );
}

export function ChegadaScreen() {
  return (
    <ScreenShell active="checkin">
      <Cover eyebrow="Estadia" title="Chegada" sub="Tudo para chegar e se acomodar." />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <Row icon={Clock} label="Horário" value="check-in a partir das 15h" />
        <Row icon={MapPin} label="Endereço" value="Rua das Palmeiras, 280 — portão azul" />
        <Row icon={KeyRound} label="Acesso" value="fechadura digital e portão" />
        <Row icon={Wifi} label="Wi-Fi" value="rede e senha liberadas na chegada" />
        <div className="flex min-w-0 items-center gap-2.5 rounded-[0.7rem] border border-accent/25 bg-accent/10 px-3 py-2.5">
          <ShieldCheck className="size-4 shrink-0 text-accent" />
          <p className="min-w-0 text-[11px] leading-snug text-pretty">
            Limpeza conferida e enxoval trocado antes da sua chegada.
          </p>
        </div>
      </div>
    </ScreenShell>
  );
}

export function ResidenciaScreen() {
  return (
    <ScreenShell active="residencia">
      <Cover eyebrow="Estadia" title="A Residência" sub="Equipamentos e como usar." />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <Row icon={Tv} label="TV" value="controle na gaveta do rack, entrada HDMI 2" />
        <Row icon={WashingMachine} label="Lavanderia" value="máquina na área de serviço" />
        <Row icon={Wifi} label="Wi-Fi" value="rede Casa Charmosa · senha no guia" />
        <Row icon={Wrench} label="Algo com defeito?" value="abra um chamado pelo guia" />
      </div>
    </ScreenShell>
  );
}

export function RegrasScreen() {
  return (
    <ScreenShell active="residencia">
      <Cover eyebrow="Estadia" title="Regras da casa" sub="O que não é permitido." />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <Row icon={ShieldCheck} label="Silêncio" value="das 22h às 8h" />
        <Row icon={ShieldCheck} label="Festas" value="não são permitidas" />
        <Row icon={ShieldCheck} label="Visitantes" value="somente hóspedes cadastrados" />
        <Row icon={ShieldCheck} label="Fumar" value="proibido em ambiente interno" />
      </div>
    </ScreenShell>
  );
}

export function SaidaScreen() {
  return (
    <ScreenShell active="saida">
      <Cover eyebrow="Estadia" title="Saída" sub="Passo a passo do check-out." />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <Step n={1} icon={Clock} t="Até as 11h" d="Horário limite para deixar a residência." />
        <Step n={2} icon={KeyRound} t="Chaves" d="Deixe sobre a bancada da cozinha." />
        <Step n={3} icon={DoorOpen} t="Antes de sair" d="Feche as janelas e tranque a porta." />
      </div>
    </ScreenShell>
  );
}

export function ContatosScreen() {
  return (
    <ScreenShell active="home">
      <Cover eyebrow="Guia" title="Dúvidas & Contatos" sub="Fale com quem cuida da casa." />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <Row icon={MessageCircle} label="Concierge IA" value="resposta imediata, 24h" />
        <Row icon={Phone} label="Anfitrião" value="atendimento das 8h às 22h" />
        <Row icon={Wrench} label="Manutenção" value="chamado registrado na hora" />
        <Row icon={ShieldCheck} label="Emergência" value="orientações no guia" />
      </div>
    </ScreenShell>
  );
}

/* =================== ATENDIMENTO IA (hóspede + interna) =================== */

/** Painel do atendimento ao hóspede, no tom da landing. */
function GuestChat({
  children,
  title = "Atendimento ao Hóspede",
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex h-full min-h-[460px] min-w-0 flex-col bg-[#0a0a0f]">
      <div className="flex-1" />
      <div className="mx-2 mb-2 flex min-w-0 flex-col overflow-hidden rounded-[0.8rem] border border-white/12 bg-[#0e0e18] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
        <div className="flex min-w-0 items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <span
            className="grid size-6 shrink-0 place-items-center rounded-full"
            style={{ background: GRAD }}
          >
            <MessageCircle className="size-3.5 text-white" />
          </span>
          <p className="truncate font-display text-[12.5px] font-bold">{title}</p>
          <span className="ml-auto truncate text-[10px] text-white/45">Casa Charmosa</span>
          <X className="size-3.5 shrink-0 text-white/40" />
        </div>
        <div className="min-w-0 space-y-2 px-3 py-3">{children}</div>
        <div className="flex min-w-0 items-center gap-2 border-t border-white/10 px-3 py-2.5">
          <Plus className="size-4 shrink-0 text-white/40" />
          <span className="min-w-0 flex-1 truncate rounded-full border border-accent/35 px-3 py-1.5 text-[11px] text-white/35">
            Mensagem...
          </span>
          <Mic className="size-4 shrink-0 text-white/40" />
        </div>
        <p className="px-4 pb-2.5 text-center text-[8.5px] leading-snug text-white/35 text-pretty">
          A IA usa as informações do guia. Confirme detalhes críticos com o anfitrião.
        </p>
      </div>
    </div>
  );
}

function GuestMsg({ from, children }: { from: "hospede" | "ia"; children: React.ReactNode }) {
  const mine = from === "hospede";
  return (
    <div className={cn("flex min-w-0", mine ? "justify-end" : "justify-start")}>
      <p
        className={cn(
          "max-w-[85%] rounded-[0.7rem] px-3 py-2 text-[11.5px] leading-snug text-pretty",
          mine
            ? "border border-accent/30 bg-accent/15 text-ice"
            : "border border-white/10 bg-white/[0.05] text-white/85",
        )}
      >
        {children}
      </p>
    </div>
  );
}


export function IaWifiScreen() {
  return (
    <GuestChat>
      <GuestMsg from="hospede">Qual é a senha do wi-fi?</GuestMsg>
      <GuestMsg from="ia">
        A rede é <b>Casa Charmosa</b> e a senha está no guia, na seção Wi-Fi — libero para você agora.
      </GuestMsg>
      <GuestMsg from="hospede">Posso fazer o check-in mais cedo?</GuestMsg>
      <GuestMsg from="ia">
        Consigo verificar! Se a limpeza terminar antes das 15h, a equipe libera e eu te aviso por aqui.
      </GuestMsg>
    </GuestChat>
  );
}

export function IaManutencaoScreen() {
  return (
    <GuestChat>
      <GuestMsg from="hospede">A TV não está ligando.</GuestMsg>
      <GuestMsg from="ia">
        Vamos resolver: o controle fica na gaveta do rack e a entrada correta é a <b>HDMI 2</b>.
      </GuestMsg>
      <GuestMsg from="hospede">Continua sem imagem.</GuestMsg>
      <GuestMsg from="ia">
        Registrei um chamado de manutenção para a equipe e te aviso por aqui assim que for atendido.
      </GuestMsg>
    </GuestChat>
  );
}

export function IaDicasScreen() {
  return (
    <GuestChat>
      <GuestMsg from="ia">
        Bom dia! Quer uma recomendação personalizada para hoje?
      </GuestMsg>
      <GuestMsg from="hospede">Onde jantar perto daqui?</GuestMsg>
      <GuestMsg from="ia">
        A <b>Trattoria del Mare</b> fica a 6 minutos a pé e costuma ter mesa até as 22h. Quer que eu
        monte um roteiro leve para amanhã?
      </GuestMsg>
    </GuestChat>
  );
}

/** Assistente interno da operação, no tom da landing. */
function InternalChat({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[460px] min-w-0 flex-col bg-[#0a0a0f] pt-3">
      <div className="mx-2 mb-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[0.8rem] border border-white/12 bg-[#0e0e18]">
        <div className="flex min-w-0 items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <span
            className="grid size-6 shrink-0 place-items-center rounded-full"
            style={{ background: GRAD }}
          >
            <Sparkles className="size-3.5 text-white" />
          </span>
          <p className="truncate font-display text-[12.5px] font-bold">Assistente</p>
          <RotateCcw className="ml-auto size-3.5 shrink-0 text-white/40" />
          <X className="size-3.5 shrink-0 text-white/40" />
        </div>
        <div className="min-w-0 flex-1 space-y-2 px-3 py-3">{children}</div>
        <div className="flex min-w-0 items-center gap-2 border-t border-white/10 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate rounded-full border border-white/12 px-3 py-1.5 text-[11px] text-white/35">
            Pergunte alguma coisa...
          </span>
          <Mic className="size-4 shrink-0 text-white/40" />
        </div>
      </div>
    </div>
  );
}

function InternalUser({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 justify-end">
      <p className="max-w-[88%] rounded-[0.7rem] border border-accent/30 bg-accent/15 px-3 py-2 text-[11.5px] leading-snug text-ice text-pretty">
        {children}
      </p>
    </div>
  );
}

function InternalAi({ children, tags }: { children: React.ReactNode; tags?: string[] }) {
  return (
    <div className="min-w-0">
      <div className="max-w-[92%] rounded-[0.7rem] border border-white/10 bg-white/[0.05] px-3 py-2 text-[11.5px] leading-snug text-white/85 text-pretty">
        {children}
      </div>
      {tags?.length ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="truncate rounded-[0.3rem] border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] font-medium text-white/55"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}


export function IaInternaPendenciasScreen() {
  return (
    <InternalChat>
      <InternalUser>Quais pendências estão em aberto hoje em todos os imóveis?</InternalUser>
      <InternalAi tags={["pendências", "3 imóveis"]}>
        Há <b>11 pendências</b> abertas: limpeza dos filtros dos ares-condicionados, maçaneta solta e
        mesa solta, entre outras.
      </InternalAi>
      <InternalUser>Marque as três primeiras como resolvidas.</InternalUser>
      <InternalAi tags={["atualizarPendencia"]}>
        Feito. As três pendências foram concluídas e a equipe recebeu o aviso na rotina do dia.
      </InternalAi>
    </InternalChat>
  );
}

export function IaInternaOperacaoScreen() {
  return (
    <InternalChat>
      <InternalUser>Como está a operação de amanhã?</InternalUser>
      <InternalAi tags={["reservas", "limpezas"]}>
        Amanhã: <b>4 check-ins</b>, 2 check-outs e 3 limpezas. Só a Casa Jardim Sul ainda está sem
        responsável de limpeza definido.
      </InternalAi>
      <InternalUser>Atribua para a equipe que fez a última.</InternalUser>
      <InternalAi tags={["atribuirTarefa"]}>
        Atribuído. A tarefa já aparece na rotina da equipe com o horário sugerido antes do check-in.
      </InternalAi>
    </InternalChat>
  );
}

/* =================== RECOMENDAÇÕES (Explorar real) =================== */

const CATEGORIAS = [
  {
    t: "Experiências",
    d: "Passeios, atrações e programas imperdíveis por perto.",
    n: 51,
    i: Landmark,
    img: recWaterfall,
  },
  {
    t: "Cafés & Padarias",
    d: "Da primeira xícara do dia ao lanche da tarde.",
    n: 54,
    i: Coffee,
    img: recCafe,
  },
  {
    t: "Restaurantes",
    d: "Onde comer bem, do almoço rápido ao jantar especial.",
    n: 96,
    i: Utensils,
    img: recRestaurant,
  },
  {
    t: "Parques e Praças",
    d: "Áreas verdes para respirar e caminhar sem pressa.",
    n: 11,
    i: Trees,
    img: recBeach,
  },
];

function CategoriaCard({
  t,
  d,
  n,
  i: Icon,
  img,
}: {
  t: string;
  d: string;
  n: number;
  i: React.ComponentType<{ className?: string }>;
  img: string;
}) {
  return (
    <div className="flex min-w-0 gap-3 rounded-[0.9rem] border border-white/10 bg-white/[0.04] p-2.5">
      <div className="relative size-[74px] shrink-0 overflow-hidden rounded-[0.7rem] bg-white/5">
        <img src={img} alt="" className="absolute inset-0 size-full object-cover" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <p className="flex min-w-0 items-center gap-1.5 truncate text-[8.5px] font-bold uppercase tracking-[0.2em] text-accent">
          <Icon className="size-3 shrink-0" /> {n} lugares
        </p>
        <p className="truncate font-serif text-[16px] leading-tight">{t}</p>
        <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground text-pretty">{d}</p>
      </div>
    </div>
  );
}

export function ExplorarScreen() {
  return (
    <ScreenShell active="explore">
      <div className="min-w-0 px-4 pt-6">
        <p className="text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">ConciergeIA</p>
        <p className="mt-1.5 font-serif text-[24px] leading-tight text-pretty">Explore a Região</p>
        <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground text-pretty">
          Uma curadoria de lugares e experiências próximas a Casa Charmosa Próx. a Avenida das
          Cataratas.
        </p>
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2 px-4">
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-[0.5rem] border border-white/12 bg-white/[0.04] px-2.5 py-2 text-[10.5px] text-white/40">
          <Search className="size-3.5 shrink-0" /> Buscar por nome, categoria ou descrição…
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium text-white/70">
          <SlidersHorizontal className="size-3.5" /> Filtros
        </span>
      </div>
      <div className="mt-3 min-w-0 space-y-2.5 px-4 pb-4">
        {CATEGORIAS.map((c) => (
          <CategoriaCard key={c.t} {...c} />
        ))}
      </div>
    </ScreenShell>
  );
}

function PlaceCard({ t, d, n, img }: { t: string; d: string; n: string; img: string }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-[0.9rem] border border-white/10 bg-white/[0.04] p-2.5">
      <div className="relative size-[74px] shrink-0 overflow-hidden rounded-[0.7rem] bg-white/5">
        <img src={img} alt="" className="absolute inset-0 size-full object-cover" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <p className="flex min-w-0 items-center gap-1 text-[9.5px] font-bold text-accent">
          <Star className="size-3 shrink-0" /> {n}
        </p>
        <p className="truncate font-serif text-[15px] leading-tight">{t}</p>
        <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground text-pretty">{d}</p>
      </div>
    </div>
  );
}

export function RestaurantesScreen() {
  return (
    <ScreenShell active="explore">
      <div className="min-w-0 px-4 pt-6">
        <p className="flex items-center gap-1.5 text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">
          <Utensils className="size-3" /> 96 lugares
        </p>
        <p className="mt-1.5 font-serif text-[24px] leading-tight">Restaurantes</p>
        <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground text-pretty">
          Onde comer bem, do almoço rápido ao jantar especial.
        </p>
      </div>
      <div className="ds-scroll-x mt-3 flex gap-1.5 px-4">
        {["Avaliação", "Mais perto", "Nome"].map((f, idx) => (
          <span
            key={f}
            className={cn(
              "whitespace-nowrap rounded-full border px-2.5 py-1 text-[9.5px] font-semibold",
              idx === 0
                ? "border-accent/40 bg-accent/15 text-ice"
                : "border-white/10 bg-white/[0.03] text-white/50",
            )}
          >
            {f}
          </span>
        ))}
      </div>
      <div className="mt-3 min-w-0 space-y-2.5 px-4 pb-4">
        <PlaceCard
          t="Trattoria del Mare"
          d="Italiano · 6 min a pé · massas artesanais"
          n="4,8"
          img={recRestaurant}
        />
        <PlaceCard
          t="Cantina da Vila"
          d="Brasileiro · 12 min de carro · pratos para dividir"
          n="4,7"
          img={recMarket}
        />
        <PlaceCard
          t="Café da Esquina"
          d="Café · 4 min a pé · abre às 7h"
          n="4,6"
          img={recCafe}
        />
      </div>
    </ScreenShell>
  );
}

export function LugarDetalheScreen() {
  return (
    <ScreenShell active="explore">
      <div className="relative h-[150px] w-full overflow-hidden">
        <img src={recRestaurant} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/25 to-transparent" />
        <div className="absolute inset-x-4 bottom-2.5 min-w-0">
          <p className="flex items-center gap-1 text-[9.5px] font-bold text-accent">
            <Star className="size-3" /> 4,8 · Italiano
          </p>
          <p className="mt-0.5 truncate font-serif text-[20px] leading-tight">Trattoria del Mare</p>
        </div>
      </div>
      <div className="min-w-0 space-y-2 px-4 pb-4 pt-3">
        <p className="text-[11px] leading-snug text-muted-foreground text-pretty">
          Massas artesanais e atendimento tranquilo. Costuma ter mesa livre até as 22h nos dias de
          semana.
        </p>
        <Row icon={Clock} label="Horário" value="18h às 23h30" />
        <Row icon={MapPin} label="Como chegar" value="rota aberta no mapa com um toque" />
        <Row icon={Sparkles} label="Dica do anfitrião" value="peça a entrada do dia" />
      </div>
    </ScreenShell>
  );
}

export function ExperienciasScreen() {
  return (
    <ScreenShell active="explore">
      <div className="min-w-0 px-4 pt-6">
        <p className="flex items-center gap-1.5 text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">
          <Landmark className="size-3" /> 51 lugares
        </p>
        <p className="mt-1.5 font-serif text-[24px] leading-tight">Experiências</p>
        <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground text-pretty">
          Passeios, atrações e programas imperdíveis por perto.
        </p>
      </div>
      <div className="mt-3 min-w-0 space-y-2.5 px-4 pb-4">
        <PlaceCard
          t="Cataratas do Iguaçu"
          d="Dia inteiro · ingresso antecipado"
          n="4,9"
          img={recWaterfall}
        />
        <PlaceCard
          t="Mirante do Encanto"
          d="Fim de tarde · 20 min de carro"
          n="4,7"
          img={recBeach}
        />
        <PlaceCard
          t="Feirinha noturna"
          d="A partir das 18h · quinta a domingo"
          n="4,5"
          img={recMarket}
        />
      </div>
    </ScreenShell>
  );
}

/* =================== ETAPAS DO HÓSPEDE (onboarding real) =================== */

function OnbShell({
  step,
  total = 3,
  children,
}: {
  step: number;
  total?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[460px] min-w-0 flex-col justify-center bg-[#0a0a0f] px-4 py-6">
      <div className="min-w-0 rounded-[0.4rem] border border-[#a855f7]/25 bg-white/[0.04] p-4 shadow-[0_28px_70px_-18px_rgba(0,0,0,0.65)] backdrop-blur">
        <div className="mb-3 flex min-w-0 items-center gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 rounded-full",
                i === step - 1 ? "w-6" : "w-3 bg-[#a855f7]/25",
              )}
              style={i === step - 1 ? { background: GRAD } : undefined}
            />
          ))}
          <span className="ml-auto text-[8.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Passo {step}/{total}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function OnbButtons({ label }: { label: string }) {
  return (
    <div className="mt-4 flex min-w-0 gap-2">
      <span className="grid h-[38px] shrink-0 place-items-center px-3 text-[11.5px] font-medium text-muted-foreground">
        ← Voltar
      </span>
      <span
        className="grid h-[38px] min-w-0 flex-1 place-items-center rounded-[0.3rem] text-[12px] font-bold text-white"
        style={{ background: GRAD }}
      >
        {label}
      </span>
    </div>
  );
}

export function EtapaConfirmacaoScreen() {
  return (
    <OnbShell step={1}>
      <p className="font-display text-[19px] font-extrabold leading-[1.14] tracking-tight text-pretty">
        Tudo certo, Helena!
      </p>
      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground text-pretty">
        Confere os dados e veja onde vai estar sua senha.
      </p>
      <div className="mt-3 min-w-0 rounded-[0.3rem] border border-white/10 bg-white/[0.03] px-3">
        {[
          { l: "Check-in", v: "sex, 12/06 a partir das 15h" },
          { l: "Check-out", v: "seg, 15/06 até 11h" },
          { l: "Endereço", v: "Rua das Palmeiras, 280" },
        ].map((r, i) => (
          <div
            key={r.l}
            className={cn(
              "flex min-w-0 items-center justify-between gap-3 py-2.5",
              i < 2 && "border-b border-white/10",
            )}
          >
            <p className="shrink-0 text-[11px] text-muted-foreground">{r.l}</p>
            <p className="min-w-0 text-right text-[11px] font-bold text-pretty">{r.v}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex min-w-0 items-start gap-2.5 rounded-[0.3rem] border border-[#a855f7]/35 bg-[#a855f7]/[0.08] p-3">
        <KeyRound className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <p className="min-w-0 text-[11px] leading-snug text-pretty">
          Tudo que você precisa para entrar fica na aba <b>Chegada</b>, liberado automaticamente no
          horário do seu check-in.
        </p>
      </div>
      <OnbButtons label="Está tudo certo →" />
    </OnbShell>
  );
}

export function EtapaPassosScreen() {
  return (
    <OnbShell step={2}>
      <p className="text-[8.5px] font-bold uppercase tracking-[0.24em] text-accent">Chegada</p>
      <p className="mt-1 font-display text-[16px] font-extrabold leading-tight tracking-tight text-pretty">
        Passo a passo da chegada
      </p>
      <div className="mt-3 min-w-0 space-y-2">
        <Step n={1} icon={MapPin} t="Chegue pela Rua das Palmeiras" d="O portão azul fica à direita." />
        <Step n={2} icon={DoorOpen} t="Abra o portão" d="Use o código do portão liberado no guia." />
        <Step n={3} icon={KeyRound} t="Destranque a porta" d="Fechadura digital, código + tecla #." />
      </div>
      <OnbButtons label="Entendi →" />
    </OnbShell>
  );
}

export function EtapaSenhasScreen() {
  return (
    <OnbShell step={3}>
      <p className="text-[8.5px] font-bold uppercase tracking-[0.24em] text-accent">Chegada</p>
      <p className="mt-1 font-display text-[16px] font-extrabold leading-tight tracking-tight text-pretty">
        Senhas de acesso
      </p>
      <div className="mt-3 min-w-0 space-y-2">
        {[
          { i: KeyRound, t: "Fechadura", d: "código liberado no horário do check-in" },
          { i: Wifi, t: "Wi-Fi", d: "Rede: Casa Charmosa" },
          { i: DoorOpen, t: "Portão da garagem", d: "toque para revelar" },
        ].map((p) => (
          <div
            key={p.t}
            className="flex min-w-0 items-center gap-2.5 rounded-[0.5rem] border border-white/10 bg-white/[0.04] px-3 py-2.5"
          >
            <p.i className="size-3.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-semibold">{p.t}</p>
              <p className="truncate text-[10px] text-muted-foreground">{p.d}</p>
            </div>
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] font-bold text-white/60">
              ••••• <Eye className="size-3.5" />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex min-w-0 items-start gap-2.5 rounded-[0.3rem] border border-[#a855f7]/25 bg-[#a855f7]/10 p-3">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <p className="min-w-0 text-[11px] leading-snug text-pretty">
          Toque no olho para revelar cada senha — elas valem até o check-out, às 11h.
        </p>
      </div>
      <OnbButtons label="Perfeito →" />
    </OnbShell>
  );
}

export function EtapaFinalScreen() {
  return (
    <div className="flex h-full min-h-[460px] min-w-0 flex-col justify-center bg-[#0a0a0f] px-5 py-6 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full border-2 border-emerald-500 bg-emerald-500/15 text-emerald-400">
        <Check className="size-5" />
      </span>
      <p className="mt-4 font-display text-[18px] font-extrabold tracking-tight">
        Tudo pronto, Helena!
      </p>
      <p className="mx-auto mt-1.5 max-w-[260px] text-[11.5px] leading-snug text-muted-foreground text-pretty">
        Você já sabe onde encontrar as senhas e o passo a passo. Conseguiu fazer o check-in sem
        problema?
      </p>
      <div className="mx-auto mt-5 w-full min-w-0 space-y-2">
        <span className="grid h-[40px] w-full place-items-center rounded-[0.3rem] bg-gradient-to-r from-emerald-400 to-emerald-500 text-[12px] font-bold text-white">
          Sim, deu tudo certo
        </span>
        <span className="grid h-[40px] w-full place-items-center rounded-[0.3rem] border border-white/12 text-[12px] font-semibold text-white/75">
          Estou com dificuldade
        </span>
        <span className="mx-auto mt-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-accent">
          <BookOpen className="size-3.5" /> Acessar o Guia Digital
        </span>
      </div>
    </div>
  );
}

/* =================== OPERAÇÃO (painel do anfitrião) =================== */

function AdminShell({ tab, children }: { tab: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[460px] min-w-0 flex-col bg-[#0a0a0f]">
      <div className="flex min-w-0 items-center gap-2 px-3 pt-7">
        <img src={conciergeLogo} alt="" aria-hidden className="size-4 shrink-0 object-contain" />
        <p className="truncate font-display text-[12.5px] font-extrabold tracking-tight">{tab}</p>
        <span className="ml-auto shrink-0 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[9px] font-semibold text-white/60">
          Hoje
        </span>
      </div>
      <div className="min-w-0 flex-1 px-3 pb-4 pt-3">{children}</div>
    </div>
  );
}

function OpCard({
  icon: Icon,
  title,
  sub,
  right,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  right?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-[0.35rem] border border-white/10 bg-white/[0.05] text-accent">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11.5px] font-semibold">{title}</p>
        <p className="truncate text-[10px] text-muted-foreground">{sub}</p>
      </div>
      {right ? (
        <span className="ml-auto shrink-0 text-[10px] font-bold text-white/60">{right}</span>
      ) : null}
    </div>
  );
}

export function OpResumoScreen() {
  return (
    <AdminShell tab="Resumo">
      <div className="grid grid-cols-3 gap-2">
        {[
          { n: "4", l: "Chegadas" },
          { n: "2", l: "Saídas" },
          { n: "11", l: "Pendências" },
        ].map((k) => (
          <div
            key={k.l}
            className="min-w-0 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-2.5"
          >
            <p className="font-display text-[19px] font-extrabold leading-none">{k.n}</p>
            <p className="mt-1 truncate text-[9.5px] uppercase tracking-[0.12em] text-white/50">
              {k.l}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-2.5 min-w-0 space-y-2">
        <SectionLabel>Chegadas de hoje</SectionLabel>
        <OpCard icon={KeyRound} title="Cobertura Beira-Mar" sub="Helena · 15h00" right="no prazo" />
        <OpCard icon={KeyRound} title="Casa Charmosa" sub="Rafael · 16h30" right="a caminho" />
        <SectionLabel>Saídas</SectionLabel>
        <OpCard icon={LogOut} title="Apto 402 — Centro" sub="Ana · até 11h" right="concluída" />
      </div>
    </AdminShell>
  );
}

export function OpKanbanScreen() {
  const cols = [
    { t: "Chegada", items: ["Cobertura Beira-Mar", "Casa Charmosa"] },
    { t: "Estadia", items: ["Studio Estação"] },
    { t: "Saída", items: ["Apto 402"] },
  ];
  return (
    <AdminShell tab="Kanban">
      <div className="ds-scroll-x flex gap-2">
        {cols.map((c) => (
          <div
            key={c.t}
            className="w-[128px] min-w-0 rounded-[0.5rem] border border-white/10 bg-white/[0.03] p-2"
          >
            <p className="truncate text-[9px] font-bold uppercase tracking-[0.16em] text-white/55">
              {c.t}
            </p>
            <div className="mt-2 space-y-1.5">
              {c.items.map((i) => (
                <div
                  key={i}
                  className="min-w-0 rounded-[0.35rem] border border-white/10 bg-white/[0.05] p-2"
                >
                  <p className="truncate text-[10.5px] font-semibold">{i}</p>
                  <p className="mt-0.5 truncate text-[9px] text-white/45">equipe definida</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AdminShell>
  );
}

export function OpCalendarioScreen() {
  const imoveis = ["Cobertura Beira-Mar", "Casa Charmosa", "Apto 402", "Studio Estação"];
  return (
    <AdminShell tab="Calendário">
      <div className="min-w-0 overflow-hidden rounded-[0.5rem] border border-white/10 bg-white/[0.03]">
        <div className="flex min-w-0 items-center border-b border-white/10 px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[9px] font-bold uppercase tracking-[0.14em] text-white/45">
            Imóvel
          </span>
          {["12", "13", "14", "15", "16", "17"].map((d) => (
            <span key={d} className="w-6 shrink-0 text-center text-[9px] text-white/45">
              {d}
            </span>
          ))}
        </div>
        {imoveis.map((n, r) => (
          <div key={n} className="flex min-w-0 items-center px-2 py-2">
            <span className="min-w-0 flex-1 truncate pr-2 text-[10px] font-medium">{n}</span>
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="w-6 shrink-0 px-0.5">
                <span
                  className={cn(
                    "block h-3 rounded-[2px]",
                    (i + r) % 3 === 0 ? "bg-white/[0.06]" : "",
                  )}
                  style={(i + r) % 3 !== 0 ? { background: GRAD, opacity: 0.55 } : undefined}
                />
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[9.5px] text-white/45 text-pretty">
        Ocupação por imóvel, sincronizada com as reservas.
      </p>
    </AdminShell>
  );
}

export function OpLimpezaScreen() {
  return (
    <AdminShell tab="Limpeza">
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-2.5">
          <Brush className="size-4 text-accent" />
          <p className="mt-1.5 font-display text-[18px] font-extrabold leading-none">18</p>
          <p className="mt-1 text-[9.5px] text-white/50">limpezas no mês</p>
        </div>
        <div className="min-w-0 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-2.5">
          <CircleDollarSign className="size-4 text-accent" />
          <p className="mt-1.5 font-display text-[18px] font-extrabold leading-none">R$ 2.340</p>
          <p className="mt-1 text-[9.5px] text-white/50">custo acumulado</p>
        </div>
      </div>
      <div className="mt-2.5 space-y-2">
        <OpCard icon={Brush} title="Apto 402 — Centro" sub="Camila · 11h20" right="concluída" />
        <OpCard icon={Brush} title="Casa Charmosa" sub="Bruna · hoje 13h" right="em rota" />
        <OpCard icon={Brush} title="Studio Estação" sub="sem responsável" right="pendente" />
      </div>
    </AdminShell>
  );
}

export function OpRegistrosScreen() {
  return (
    <AdminShell tab="Registros">
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="grid aspect-square min-w-0 place-items-center rounded-[0.4rem] border border-white/10 bg-white/[0.05] text-white/35"
          >
            <Camera className="size-4" />
          </div>
        ))}
      </div>
      <div className="mt-2.5 space-y-2">
        <OpCard icon={ClipboardList} title="Maçaneta solta" sub="Casa Charmosa · nota" right="aberta" />
        <OpCard icon={Users} title="Enxoval trocado" sub="Apto 402 · equipe" right="ok" />
        <OpCard icon={CalendarDays} title="Vistoria pós-saída" sub="Cobertura · fotos" right="ok" />
      </div>
    </AdminShell>
  );
}

/** Cada recurso tem várias telas de exemplo; a seta avança dentro do recurso. */
export const RESULT_FEATURES = [
  {
    id: "guia",
    label: "Guia Digital",
    screens: [GuiaHomeScreen, GuiaInteligenciaScreen, GuiaFinalScreen],
  },
  {
    id: "instrucoes",
    label: "Instruções",
    screens: [ChegadaScreen, ResidenciaScreen, RegrasScreen, SaidaScreen, ContatosScreen],
  },
  {
    id: "ia",
    label: "Atendimento IA",
    screens: [
      IaWifiScreen,
      IaManutencaoScreen,
      IaDicasScreen,
      IaInternaPendenciasScreen,
      IaInternaOperacaoScreen,
    ],
  },
  {
    id: "recomendacoes",
    label: "Recomendações",
    screens: [ExplorarScreen, RestaurantesScreen, LugarDetalheScreen, ExperienciasScreen],
  },
  {
    id: "operacao",
    label: "Operação",
    screens: [
      OpResumoScreen,
      OpKanbanScreen,
      OpCalendarioScreen,
      OpLimpezaScreen,
      OpRegistrosScreen,
    ],
  },
  {
    id: "etapas",
    label: "Etapas Hóspede",
    screens: [EtapaConfirmacaoScreen, EtapaPassosScreen, EtapaSenhasScreen, EtapaFinalScreen],
  },
];

