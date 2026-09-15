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
} from "lucide-react";

/**
 * Telas de RESULTADO (o que o hóspede recebe), desenhadas com a paleta,
 * tipografia e acentos da própria landing page — nunca capturas do painel
 * administrativo.
 */

const GRAD = "linear-gradient(135deg,#7c1ad8 0%,#e82dae 100%)";

function ScreenShell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-w-0 flex-col bg-[#0a0a0f] text-foreground">{children}</div>;
}

function ScreenHeader({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="relative px-5 pb-4 pt-9">
      <div aria-hidden className="absolute inset-0 opacity-[0.28]" style={{ background: GRAD, maskImage: "linear-gradient(180deg,#000,transparent)" }} />
      <div className="relative min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-[0.26em] text-accent">{eyebrow}</p>
        <p className="mt-2 font-display text-[18px] font-bold leading-tight tracking-tight text-pretty">{title}</p>
        {sub ? (
          <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
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
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <Icon className="size-3.5 shrink-0 text-accent" />
      <p className="min-w-0 text-[11px] leading-snug text-pretty">
        <span className="font-semibold">{label}</span> <span className="text-muted-foreground">{value}</span>
      </p>
    </div>
  );
}

/* ---------- 1. Guia digital ---------- */

const SECOES = ["Bem-vindo", "Acesso", "Wi-Fi", "Regras", "Equipamentos", "Check-out", "Contatos"];

export function GuiaScreen() {
  return (
    <ScreenShell>
      <ScreenHeader eyebrow="Guia do hóspede" title="Cobertura Beira-Mar" sub="Balneário Camboriú · SC" />
      <div className="min-w-0 space-y-2 px-4 pb-5">
        <Row icon={DoorOpen} label="Check-in" value="a partir das 15h" />
        <Row icon={LogOut} label="Check-out" value="até 11h" />
        <Row icon={Wifi} label="Wi-Fi" value="rede e senha no guia" />
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
          <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.2em] text-accent">
            <Sparkles className="size-3" /> Seções do guia
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {SECOES.map((s) => (
              <span key={s} className="rounded-full border border-white/12 px-2.5 py-1 text-[10px] text-muted-foreground">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </ScreenShell>
  );
}

/* ---------- 2. Atendimento IA ---------- */

const CONVERSA: Array<{ de: "hospede" | "ia"; texto: string }> = [
  { de: "hospede", texto: "Qual é a senha do wi-fi?" },
  { de: "ia", texto: "A rede é Beira-Mar 201 e a senha está no guia da casa, em Wi-Fi." },
  { de: "hospede", texto: "Posso fazer o check-in mais cedo?" },
  { de: "ia", texto: "Consigo verificar! Se a limpeza terminar antes das 15h, a equipe libera e eu te aviso por aqui." },
];

export function IaScreen() {
  return (
    <ScreenShell>
      <div className="flex min-w-0 items-center gap-2.5 border-b border-white/8 px-4 pb-3 pt-9">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: GRAD }}>
          <Bot className="size-4 text-white" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-[13px] font-bold tracking-tight">ConciergeIA</p>
          <p className="truncate text-[10px] text-muted-foreground">Responde com o conhecimento da sua operação</p>
        </div>
      </div>
      <div className="min-w-0 space-y-2.5 p-4">
        {CONVERSA.map((m, i) => (
          <div key={i} className={m.de === "hospede" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.de === "hospede"
                  ? "max-w-[86%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.05] px-3 py-2 text-[11.5px] leading-relaxed"
                  : "max-w-[86%] rounded-2xl rounded-bl-md border border-accent/30 bg-accent/10 px-3 py-2 text-[11.5px] leading-relaxed"
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

/* ---------- 3. Recomendações ---------- */

const DICAS = [
  { icon: Utensils, nome: "Trattoria del Mare", tag: "Jantar · 600 m" },
  { icon: Coffee, nome: "Café da Esquina", tag: "Café da manhã · 200 m" },
  { icon: Waves, nome: "Praia de Laranjeiras", tag: "Passeio · 15 min" },
];

export function RecomendacoesScreen() {
  return (
    <ScreenShell>
      <ScreenHeader eyebrow="Explorar a região" title="Selecionado pelo anfitrião" />
      <div className="min-w-0 space-y-2 px-4 pb-5">
        {DICAS.map((d) => (
          <div key={d.nome} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: GRAD }}>
              <d.icon className="size-4 text-white" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">{d.nome}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{d.tag}</p>
            </div>
          </div>
        ))}
        <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2.5">
          <Phone className="size-3.5 shrink-0 text-accent" />
          <p className="min-w-0 text-[10.5px] leading-snug text-muted-foreground text-pretty">
            Contatos importantes sempre à mão, do zelador ao suporte da operação.
          </p>
        </div>
      </div>
    </ScreenShell>
  );
}

/* ---------- 4. Check-in ---------- */

const PASSOS_CHECKIN = [
  { icon: MapPin, t: "Chegada", d: "Entrada pela Rua das Palmeiras, portão azul." },
  { icon: KeyRound, t: "Acesso", d: "Fechadura digital: código enviado no dia da chegada." },
  { icon: ShieldCheck, t: "Tudo pronto", d: "Limpeza conferida e enxoval trocado antes da entrada." },
];

export function CheckinScreen() {
  return (
    <ScreenShell>
      <ScreenHeader eyebrow="Check-in" title="Seu acesso, passo a passo" />
      <div className="min-w-0 space-y-2 px-4 pb-5">
        {PASSOS_CHECKIN.map((p, i) => (
          <div key={p.t} className="flex min-w-0 gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-white/12 text-[10px] font-bold text-accent">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                <p.icon className="size-3.5 shrink-0 text-accent" /> {p.t}
              </p>
              <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground text-pretty">{p.d}</p>
            </div>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

/* ---------- telas complementares ---------- */

export function AcessoScreen() {
  return (
    <ScreenShell>
      <ScreenHeader eyebrow="Guia do hóspede" title="Wi-Fi e acessos" />
      <div className="min-w-0 space-y-2 px-4 pb-5">
        <div className="rounded-2xl border border-accent/25 bg-accent/10 p-3">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-accent">Rede Wi-Fi</p>
          <p className="mt-1.5 font-display text-[15px] font-bold tracking-tight">Beira-Mar 201</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Senha: praia2026</p>
        </div>
        <Row icon={KeyRound} label="Portaria" value="interfone 201, 24h" />
        <Row icon={DoorOpen} label="Elevador" value="acesso liberado com a chave digital" />
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
    <ScreenShell>
      <ScreenHeader eyebrow="Guia do hóspede" title="Regras da casa" />
      <div className="min-w-0 space-y-2 px-4 pb-5">
        {REGRAS.map((r) => (
          <div key={r} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <p className="min-w-0 text-[11px] leading-snug text-muted-foreground text-pretty">{r}</p>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

const CONVERSA_2: Array<{ de: "hospede" | "ia"; texto: string }> = [
  { de: "hospede", texto: "A TV não está ligando." },
  { de: "ia", texto: "Vamos resolver: o controle da TV fica na gaveta do rack e usa a entrada HDMI 2." },
  { de: "hospede", texto: "Continua sem imagem." },
  { de: "ia", texto: "Registrei um chamado de manutenção para a equipe e já te aviso por aqui quando for atendido." },
];

export function IaManutencaoScreen() {
  return (
    <ScreenShell>
      <div className="flex min-w-0 items-center gap-2.5 border-b border-white/8 px-4 pb-3 pt-9">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: GRAD }}>
          <Bot className="size-4 text-white" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-[13px] font-bold tracking-tight">ConciergeIA</p>
          <p className="truncate text-[10px] text-muted-foreground">Abre chamados quando precisa de gente</p>
        </div>
      </div>
      <div className="min-w-0 space-y-2.5 p-4">
        {CONVERSA_2.map((m, i) => (
          <div key={i} className={m.de === "hospede" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.de === "hospede"
                  ? "max-w-[86%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.05] px-3 py-2 text-[11.5px] leading-relaxed"
                  : "max-w-[86%] rounded-2xl rounded-bl-md border border-accent/30 bg-accent/10 px-3 py-2 text-[11.5px] leading-relaxed"
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

const EXPERIENCIAS = [
  { icon: Waves, nome: "Passeio de escuna", tag: "Manhã · saída às 9h" },
  { icon: Sparkles, nome: "Mirante do Encanto", tag: "Pôr do sol · 10 min de carro" },
  { icon: Utensils, nome: "Feirinha noturna", tag: "Quinta a domingo · 800 m" },
];

export function ExperienciasScreen() {
  return (
    <ScreenShell>
      <ScreenHeader eyebrow="Explorar a região" title="Experiências por perto" />
      <div className="min-w-0 space-y-2 px-4 pb-5">
        {EXPERIENCIAS.map((d) => (
          <div key={d.nome} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: GRAD }}>
              <d.icon className="size-4 text-white" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">{d.nome}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{d.tag}</p>
            </div>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

const PASSOS_CHECKOUT = [
  { icon: LogOut, t: "Saída até 11h", d: "Avise pelo guia se precisar de mais tempo." },
  { icon: KeyRound, t: "Chaves", d: "Deixe sobre a bancada da cozinha." },
  { icon: ShieldCheck, t: "Antes de sair", d: "Feche as janelas e descarte o lixo na garagem." },
];

export function CheckoutScreen() {
  return (
    <ScreenShell>
      <ScreenHeader eyebrow="Check-out" title="Como deixar a casa" />
      <div className="min-w-0 space-y-2 px-4 pb-5">
        {PASSOS_CHECKOUT.map((p, i) => (
          <div key={p.t} className="flex min-w-0 gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-white/12 text-[10px] font-bold text-accent">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                <p.icon className="size-3.5 shrink-0 text-accent" /> {p.t}
              </p>
              <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground text-pretty">{p.d}</p>
            </div>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}

/** Cada recurso tem várias telas de exemplo; a seta avança dentro do recurso. */
export const RESULT_FEATURES = [
  { id: "guia", label: "Guia Digital", screens: [GuiaScreen, AcessoScreen, RegrasScreen] },
  { id: "ia", label: "Atendimento IA", screens: [IaScreen, IaManutencaoScreen] },
  { id: "recomendacoes", label: "Recomendações", screens: [RecomendacoesScreen, ExperienciasScreen] },
  { id: "checkin", label: "Check-in", screens: [CheckinScreen, CheckoutScreen] },
];
