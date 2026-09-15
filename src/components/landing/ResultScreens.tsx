import {
  Wifi,
  DoorOpen,
  LogOut,
  MapPin,
  Phone,
  Bot,
  Utensils,
  Waves,
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
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Telas de RESULTADO (o que o hóspede recebe), recriadas com a paleta e a
 * tipografia da landing, espelhando o layout real do guia digital.
 */

const GRAD = "linear-gradient(135deg,#7c1ad8 0%,#e82dae 100%)";

type NavKey = "home" | "checkin" | "saida" | "residencia" | "explore";

const NAV: Array<{ key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "home", label: "Início", icon: Home },
  { key: "checkin", label: "Chegada", icon: KeyRound },
  { key: "saida", label: "Saída", icon: LogOut },
  { key: "explore", label: "Explorar", icon: Compass },
];

function BottomBar({ active }: { active: NavKey }) {
  return (
    <div className="mt-auto border-t border-white/8 bg-[#080815]/90 px-3 pb-3 pt-2 backdrop-blur">
      <ul className="flex items-stretch justify-around gap-1">
        {NAV.map((n) => {
          const on = n.key === active;
          return (
            <li key={n.key} className="min-w-0 flex-1">
              <div className="flex flex-col items-center gap-1 py-0.5">
                <span
                  className={cn("grid size-8 place-items-center rounded-[0.3rem]", on ? "text-white" : "text-white/55")}
                  style={on ? { background: GRAD } : undefined}
                >
                  <n.icon className="size-4" />
                </span>
                <span className={cn("truncate text-[9px] font-bold", on ? "text-white" : "text-white/50")}>
                  {n.label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ScreenShell({ children, active }: { children: React.ReactNode; active: NavKey }) {
  return (
    <div className="flex h-full min-h-[460px] min-w-0 flex-col bg-[#0a0a0f] text-foreground">
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      <BottomBar active={active} />
    </div>
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
        <span className="font-semibold">{label}</span> <span className="text-muted-foreground">{value}</span>
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
      style={{ background: "linear-gradient(140deg,rgba(124,26,216,0.55) 0%,rgba(232,45,174,0.35) 100%)" }}
    >
      <Icon className="size-5 text-white" />
    </span>
  );
}

/* =================== GUIA DIGITAL =================== */

const ATALHOS = [
  { icon: KeyRound, t: "Chegada", d: "Acesso e instruções" },
  { icon: Wifi, t: "Wi-Fi", d: "Rede e senha" },
  { icon: Home, t: "A casa", d: "Equipamentos e regras" },
  { icon: Compass, t: "Explorar", d: "Dicas da região" },
];

export function GuiaHomeScreen() {
  return (
    <ScreenShell active="home">
      <Cover eyebrow="ConciergeIA" title="Cobertura Beira-Mar" sub="Balneário Camboriú · SC" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <div className="rounded-[0.7rem] border border-accent/25 bg-accent/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.2em] text-accent">
            <Clock className="size-3" /> Faltam 2 dias para sua chegada
          </p>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            Seu acesso será liberado automaticamente no dia do check-in.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {ATALHOS.map((a) => (
            <div key={a.t} className="min-w-0 rounded-[0.7rem] border border-white/10 bg-white/[0.04] p-3">
              <span className="grid size-8 place-items-center rounded-[0.4rem]" style={{ background: GRAD }}>
                <a.icon className="size-4 text-white" />
              </span>
              <p className="mt-2 truncate text-[12px] font-semibold">{a.t}</p>
              <p className="truncate text-[10px] text-muted-foreground">{a.d}</p>
            </div>
          ))}
        </div>
      </div>
    </ScreenShell>
  );
}

export function ChegadaScreen() {
  return (
    <ScreenShell active="checkin">
      <Cover eyebrow="Chegada" title="Seu acesso, passo a passo" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <Step n={1} icon={MapPin} t="Endereço" d="Rua das Palmeiras, 201 — portão azul, ao lado da praça." />
        <Step n={2} icon={KeyRound} t="Fechadura digital" d="Código 4821 e depois a tecla de confirmação." />
        <Step n={3} icon={ShieldCheck} t="Tudo pronto" d="Limpeza conferida e enxoval trocado antes da entrada." />
      </div>
    </ScreenShell>
  );
}

export function SaidaScreen() {
  return (
    <ScreenShell active="saida">
      <Cover eyebrow="Saída" title="Como deixar a casa" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <Row icon={Clock} label="Check-out" value="até 11h" />
        <Step n={1} icon={KeyRound} t="Chaves" d="Deixe sobre a bancada da cozinha." />
        <Step n={2} icon={LogOut} t="Antes de sair" d="Feche as janelas e descarte o lixo na garagem." />
      </div>
    </ScreenShell>
  );
}

export function ResidenciaScreen() {
  return (
    <ScreenShell active="home">
      <Cover eyebrow="A casa" title="Equipamentos e senhas" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <div className="rounded-[0.7rem] border border-accent/25 bg-accent/10 p-3">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-accent">Rede Wi-Fi</p>
          <p className="mt-1 font-display text-[15px] font-bold tracking-tight">Beira-Mar 201</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Senha: praia2026</p>
        </div>
        <Row icon={Tv} label="TV" value="controle na gaveta do rack, entrada HDMI 2" />
        <Row icon={WashingMachine} label="Lavadora" value="programa rápido leva 40 minutos" />
        <Row icon={ShieldCheck} label="Garagem" value="vaga 42, subsolo 1" />
      </div>
    </ScreenShell>
  );
}

const REGRAS = [
  "Silêncio das 22h às 8h.",
  "Não são permitidas festas ou visitantes não cadastrados.",
  "Pets bem-vindos mediante aviso prévio.",
  "Proibido fumar em áreas internas.",
];

export function RegrasScreen() {
  return (
    <ScreenShell active="home">
      <Cover eyebrow="A casa" title="Regras da casa" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        {REGRAS.map((r) => (
          <div
            key={r}
            className="flex min-w-0 items-start gap-2.5 rounded-[0.6rem] border border-white/10 bg-white/[0.04] px-3 py-2.5"
          >
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <p className="min-w-0 text-[11px] leading-snug text-muted-foreground text-pretty">{r}</p>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

const CONTATOS = [
  { icon: Phone, t: "Suporte da operação", d: "WhatsApp · resposta em minutos" },
  { icon: Wrench, t: "Manutenção", d: "Chamado aberto direto pelo guia" },
  { icon: ShieldCheck, t: "Portaria 24h", d: "Interfone 201" },
];

export function ContatosScreen() {
  return (
    <ScreenShell active="home">
      <Cover eyebrow="Contatos" title="Quem te atende" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        {CONTATOS.map((c) => (
          <div
            key={c.t}
            className="flex min-w-0 items-center gap-3 rounded-[0.7rem] border border-white/10 bg-white/[0.04] p-3"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[0.45rem]" style={{ background: GRAD }}>
              <c.icon className="size-4 text-white" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">{c.t}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{c.d}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-white/30" />
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

/* =================== ATENDIMENTO IA =================== */

function ChatScreen({ sub, mensagens }: { sub: string; mensagens: Array<{ de: "hospede" | "ia"; texto: string }> }) {
  return (
    <ScreenShell active="home">
      <div className="flex min-w-0 items-center gap-2.5 border-b border-white/8 px-4 pb-3 pt-9">
        <span className="grid size-8 shrink-0 place-items-center rounded-[0.45rem]" style={{ background: GRAD }}>
          <Bot className="size-4 text-white" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-[13px] font-bold tracking-tight">ConciergeIA</p>
          <p className="truncate text-[10px] text-muted-foreground">{sub}</p>
        </div>
      </div>
      <div className="min-w-0 space-y-2.5 p-4">
        {mensagens.map((m, i) => (
          <div key={i} className={m.de === "hospede" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.de === "hospede"
                  ? "max-w-[86%] rounded-[0.8rem] rounded-br-[0.3rem] border border-white/10 bg-white/[0.05] px-3 py-2 text-[11.5px] leading-relaxed"
                  : "max-w-[86%] rounded-[0.8rem] rounded-bl-[0.3rem] border border-accent/30 bg-accent/10 px-3 py-2 text-[11.5px] leading-relaxed"
              }
            >
              {m.texto}
            </div>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

export function IaWifiScreen() {
  return (
    <ChatScreen
      sub="Responde com o conhecimento da sua operação"
      mensagens={[
        { de: "hospede", texto: "Qual é a senha do wi-fi?" },
        { de: "ia", texto: "A rede é Beira-Mar 201 e a senha é praia2026. Também está em A casa › Wi-Fi." },
        { de: "hospede", texto: "Posso fazer o check-in mais cedo?" },
        { de: "ia", texto: "Se a limpeza terminar antes das 15h, a equipe libera e eu te aviso por aqui." },
      ]}
    />
  );
}

export function IaManutencaoScreen() {
  return (
    <ChatScreen
      sub="Abre chamados quando precisa de gente"
      mensagens={[
        { de: "hospede", texto: "A TV não está ligando." },
        { de: "ia", texto: "O controle fica na gaveta do rack e a entrada é HDMI 2. Pode testar?" },
        { de: "hospede", texto: "Continua sem imagem." },
        { de: "ia", texto: "Abri um chamado de manutenção para a equipe e te aviso aqui quando for atendido." },
      ]}
    />
  );
}

export function IaDicasScreen() {
  return (
    <ChatScreen
      sub="Recomendações cadastradas pelo anfitrião"
      mensagens={[
        { de: "hospede", texto: "Onde jantar hoje sem sair de carro?" },
        { de: "ia", texto: "A Trattoria del Mare fica a 600 m, abre às 19h e aceita reserva pelo telefone do guia." },
        { de: "hospede", texto: "E para o café da manhã?" },
        { de: "ia", texto: "O Café da Esquina, a 200 m, abre às 7h. Está salvo em Explorar › Cafés & Padarias." },
      ]}
    />
  );
}

export function IaCheckoutScreen() {
  return (
    <ChatScreen
      sub="Sempre com a informação da casa certa"
      mensagens={[
        { de: "hospede", texto: "Como faço o check-out?" },
        { de: "ia", texto: "Até 11h: deixe as chaves na bancada, feche as janelas e leve o lixo à garagem." },
        { de: "hospede", texto: "Consigo sair mais tarde?" },
        { de: "ia", texto: "Vou consultar a agenda de limpeza e retorno aqui em instantes." },
      ]}
    />
  );
}

/* =================== EXPLORAR / RECOMENDAÇÕES =================== */

const CATEGORIAS = [
  { icon: Landmark, n: "51 lugares", t: "Experiências" },
  { icon: Coffee, n: "54 lugares", t: "Cafés & Padarias" },
  { icon: Utensils, n: "143 lugares", t: "Restaurantes" },
  { icon: Waves, n: "11 lugares", t: "Praias & Lagos" },
];

export function ExplorarScreen() {
  return (
    <ScreenShell active="explore">
      <div className="relative px-4 pb-3 pt-9">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.3]"
          style={{ background: GRAD, maskImage: "linear-gradient(180deg,#000,transparent)" }}
        />
        <div className="relative min-w-0">
          <p className="text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">ConciergeIA</p>
          <p className="mt-1.5 font-display text-[19px] font-extrabold leading-tight tracking-tight">
            Explore a Região
          </p>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground text-pretty">
            Uma curadoria de lugares e experiências próximas à Cobertura Beira-Mar.
          </p>
          <div className="mt-3 flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-2 rounded-[0.5rem] border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[10.5px] text-muted-foreground">
              <Search className="size-3.5 shrink-0" /> Buscar por nome
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] font-semibold">
              <SlidersHorizontal className="size-3.5" /> Filtros
            </span>
          </div>
        </div>
      </div>
      <div className="min-w-0 space-y-2 px-4 pb-4">
        {CATEGORIAS.map((c) => (
          <div
            key={c.t}
            className="flex min-w-0 items-center gap-3 rounded-[0.7rem] border border-white/10 bg-white/[0.03] p-2.5"
          >
            <Thumb icon={c.icon} />
            <div className="min-w-0">
              <p className="truncate text-[9px] font-bold uppercase tracking-[0.2em] text-accent">{c.n}</p>
              <p className="truncate font-display text-[14px] font-bold tracking-tight">{c.t}</p>
            </div>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

const RESTAURANTES = [
  { icon: Utensils, t: "Trattoria del Mare", d: "Italiana · 600 m · abre 19h", nota: "4,8" },
  { icon: Utensils, t: "Cantina da Vila", d: "Brasileira · 1,1 km · abre 18h", nota: "4,6" },
  { icon: Coffee, t: "Café da Esquina", d: "Café · 200 m · abre 7h", nota: "4,9" },
];

export function RestaurantesScreen() {
  return (
    <ScreenShell active="explore">
      <Cover eyebrow="Explorar" title="Restaurantes" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        {RESTAURANTES.map((r) => (
          <div
            key={r.t}
            className="flex min-w-0 items-center gap-3 rounded-[0.7rem] border border-white/10 bg-white/[0.03] p-2.5"
          >
            <Thumb icon={r.icon} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold">{r.t}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{r.d}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-semibold text-accent">
              <Star className="size-3" /> {r.nota}
            </span>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

export function LugarDetalheScreen() {
  return (
    <ScreenShell active="explore">
      <div className="relative">
        <div className="h-24 w-full" style={{ background: GRAD, opacity: 0.55 }} />
        <div className="min-w-0 px-4 pb-4 pt-3">
          <p className="text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">Restaurantes</p>
          <p className="mt-1 font-display text-[17px] font-extrabold tracking-tight">Trattoria del Mare</p>
          <p className="mt-1 flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <MapPin className="size-3 shrink-0" /> 600 m da casa · Av. Atlântica, 1200
          </p>
          <div className="mt-3 space-y-2">
            <Row icon={Clock} label="Horário" value="19h às 23h, todos os dias" />
            <Row icon={Star} label="Recomendado" value="pelo anfitrião · massas frescas" />
            <Row icon={Phone} label="Reservas" value="pelo telefone salvo no guia" />
          </div>
        </div>
      </div>
    </ScreenShell>
  );
}

export function ExperienciasScreen() {
  return (
    <ScreenShell active="explore">
      <Cover eyebrow="Explorar" title="Experiências por perto" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        {[
          { icon: Waves, t: "Passeio de escuna", d: "Manhã · saída às 9h" },
          { icon: Sparkles, t: "Mirante do Encanto", d: "Pôr do sol · 10 min de carro" },
          { icon: Landmark, t: "Centro histórico", d: "Caminhada guiada · 2 km" },
        ].map((e) => (
          <div
            key={e.t}
            className="flex min-w-0 items-center gap-3 rounded-[0.7rem] border border-white/10 bg-white/[0.03] p-2.5"
          >
            <Thumb icon={e.icon} />
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">{e.t}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{e.d}</p>
            </div>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

/* =================== CHECK-IN =================== */

export function AcessoGuiaScreen() {
  return (
    <ScreenShell active="checkin">
      <div className="min-w-0 px-4 pb-4 pt-10">
        <div className="rounded-[0.9rem] border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">Boas-vindas</p>
          <p className="mt-1.5 font-display text-[16px] font-extrabold leading-tight tracking-tight text-pretty">
            Cobertura Beira-Mar
          </p>
          <p className="mt-1 text-[10.5px] text-muted-foreground">Rápido preenchimento para liberar o guia.</p>
          <div className="mt-3 space-y-2">
            {["Nome como aparece na reserva", "Código da reserva (ex.: HMABC1234)"].map((ph) => (
              <div
                key={ph}
                className="truncate rounded-[0.5rem] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[10.5px] text-muted-foreground"
              >
                {ph}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              {["Chegada", "Saída"].map((l) => (
                <div key={l} className="rounded-[0.5rem] border border-white/10 bg-white/[0.04] px-3 py-2">
                  <p className="text-[8.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{l}</p>
                  <p className="text-[12px] font-semibold">—</p>
                </div>
              ))}
            </div>
            <div
              className="grid place-items-center rounded-[0.5rem] py-2.5 text-[12px] font-bold text-white"
              style={{ background: GRAD }}
            >
              Acessar guia →
            </div>
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-[9.5px] text-muted-foreground">
            <ShieldCheck className="size-3 shrink-0" /> Seus dados ficam seguros e privados.
          </p>
        </div>
      </div>
    </ScreenShell>
  );
}

export function ContagemScreen() {
  return (
    <ScreenShell active="checkin">
      <Cover eyebrow="Chegada" title="Falta pouco para sua estadia" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <div className="rounded-[0.8rem] border border-accent/25 bg-accent/10 p-4 text-center">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-accent">Check-in em</p>
          <p className="mt-1 font-display text-[28px] font-extrabold leading-none tracking-tight">2 dias</p>
          <p className="mt-1.5 text-[10.5px] text-muted-foreground">Sexta, a partir das 15h</p>
        </div>
        <Row icon={KeyRound} label="Acesso" value="código liberado no dia da chegada" />
        <Row icon={MessageCircle} label="Dúvidas" value="atendimento pelo guia, 24h" />
      </div>
    </ScreenShell>
  );
}

export function PosCheckinScreen() {
  return (
    <ScreenShell active="checkin">
      <Cover eyebrow="Chegada" title="Você já está na casa" />
      <div className="min-w-0 space-y-2 px-4 pb-4">
        <div className="flex min-w-0 items-center gap-2.5 rounded-[0.7rem] border border-accent/25 bg-accent/10 px-3 py-2.5">
          <ShieldCheck className="size-4 shrink-0 text-accent" />
          <p className="min-w-0 text-[11px] leading-snug text-pretty">Check-in confirmado às 15h12.</p>
        </div>
        <Row icon={Wifi} label="Wi-Fi" value="Beira-Mar 201 · praia2026" />
        <Row icon={DoorOpen} label="Garagem" value="vaga 42, subsolo 1" />
        <Row icon={Phone} label="Suporte" value="fale com a equipe pelo guia" />
      </div>
    </ScreenShell>
  );
}

/** Cada recurso tem várias telas de exemplo; a seta avança dentro do recurso. */
export const RESULT_FEATURES = [
  {
    id: "guia",
    label: "Guia Digital",
    screens: [GuiaHomeScreen, ChegadaScreen, ResidenciaScreen, RegrasScreen, SaidaScreen, ContatosScreen],
  },
  {
    id: "ia",
    label: "Atendimento IA",
    screens: [IaWifiScreen, IaManutencaoScreen, IaDicasScreen, IaCheckoutScreen],
  },
  {
    id: "recomendacoes",
    label: "Recomendações",
    screens: [ExplorarScreen, RestaurantesScreen, LugarDetalheScreen, ExperienciasScreen],
  },
  {
    id: "checkin",
    label: "Check-in",
    screens: [AcessoGuiaScreen, ContagemScreen, PosCheckinScreen],
  },
];
