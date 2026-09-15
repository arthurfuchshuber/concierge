/**
 * Guia do hóspede DEMONSTRATIVO e interativo.
 *
 * Não são imagens: tudo aqui é o layout real do guia reimplementado com
 * estado — o visitante navega pela barra inferior, abre categorias do
 * Explorar, entra no detalhe de um lugar, marca os itens da saída e conversa
 * com o Atendimento ao Hóspede (respostas roteirizadas, sem chamar IA).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Coffee,
  Compass,
  DoorOpen,
  Home,
  KeyRound,
  Landmark,
  LogOut,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trees,
  Utensils,
  Wifi,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import conciergeLogo from "@/assets/concierge-logo.png";
import sceneApto from "@/assets/landing/scene-apto.jpg.asset.json";
import recWaterfall from "@/assets/rec-waterfall.jpg";
import recCafe from "@/assets/rec-cafe.jpg";
import recRestaurant from "@/assets/rec-restaurant.jpg";
import recBeach from "@/assets/rec-beach.jpg";
import recMarket from "@/assets/rec-market.jpg";

const GRAD = "linear-gradient(135deg,#7c1ad8 0%,#e82dae 100%)";

type Tab = "home" | "chegada" | "saida" | "explorar";

/* ------------------------------ dados demo ------------------------------ */

type Lugar = { nome: string; desc: string; nota: string; img: string; horario: string; dica: string };

const CATEGORIAS: {
  id: string;
  titulo: string;
  desc: string;
  icone: typeof Landmark;
  img: string;
  lugares: Lugar[];
}[] = [
  {
    id: "experiencias",
    titulo: "Experiências",
    desc: "Passeios, atrações e programas imperdíveis por perto.",
    icone: Landmark,
    img: recWaterfall,
    lugares: [
      {
        nome: "Cataratas do Iguaçu",
        desc: "Dia inteiro · ingresso antecipado",
        nota: "4,9",
        img: recWaterfall,
        horario: "9h às 17h",
        dica: "vá cedo para pegar as trilhas vazias",
      },
      {
        nome: "Mirante do Encanto",
        desc: "Fim de tarde · 20 min de carro",
        nota: "4,7",
        img: recBeach,
        horario: "todos os dias, até 19h",
        dica: "o pôr do sol é o melhor horário",
      },
    ],
  },
  {
    id: "cafes",
    titulo: "Cafés & Padarias",
    desc: "Da primeira xícara do dia ao lanche da tarde.",
    icone: Coffee,
    img: recCafe,
    lugares: [
      {
        nome: "Café da Esquina",
        desc: "Café · 4 min a pé",
        nota: "4,6",
        img: recCafe,
        horario: "7h às 19h",
        dica: "peça o pão na chapa com café coado",
      },
      {
        nome: "Padaria Central",
        desc: "Padaria · 9 min a pé",
        nota: "4,5",
        img: recMarket,
        horario: "6h às 20h",
        dica: "as broas saem quentes às 16h",
      },
    ],
  },
  {
    id: "restaurantes",
    titulo: "Restaurantes",
    desc: "Onde comer bem, do almoço rápido ao jantar especial.",
    icone: Utensils,
    img: recRestaurant,
    lugares: [
      {
        nome: "Trattoria del Mare",
        desc: "Italiano · 6 min a pé",
        nota: "4,8",
        img: recRestaurant,
        horario: "18h às 23h30",
        dica: "peça a entrada do dia",
      },
      {
        nome: "Cantina da Vila",
        desc: "Brasileiro · 12 min de carro",
        nota: "4,7",
        img: recMarket,
        horario: "11h30 às 15h",
        dica: "pratos servem duas pessoas",
      },
    ],
  },
  {
    id: "parques",
    titulo: "Parques e Praças",
    desc: "Áreas verdes para respirar e caminhar sem pressa.",
    icone: Trees,
    img: recBeach,
    lugares: [
      {
        nome: "Parque das Aves",
        desc: "Manhã · 15 min de carro",
        nota: "4,8",
        img: recBeach,
        horario: "8h30 às 17h",
        dica: "compre o ingresso online e evite fila",
      },
    ],
  },
];

const RESPOSTAS: { gatilhos: string[]; texto: string }[] = [
  {
    gatilhos: ["wifi", "wi-fi", "senha", "internet"],
    texto: "A rede é Beira-Mar 201 e a senha é praia2026. Ela também fica salva no guia, em Wi-Fi.",
  },
  {
    gatilhos: ["check-in", "checkin", "chegar", "antes", "entrada"],
    texto:
      "O check-in libera às 15h. Se a limpeza terminar antes, a equipe libera e eu te aviso por aqui.",
  },
  {
    gatilhos: ["check-out", "checkout", "sair", "saída", "saida"],
    texto:
      "A saída é até as 11h. Deixe as chaves sobre a bancada, feche as janelas e leve o lixo até a garagem.",
  },
  {
    gatilhos: ["tv", "controle", "quebrou", "não funciona", "nao funciona", "manutenção"],
    texto:
      "O controle fica na gaveta do rack e a TV usa a entrada HDMI 2. Se continuar sem imagem, eu abro um chamado para a equipe agora mesmo.",
  },
  {
    gatilhos: ["comer", "jantar", "restaurante", "almoço", "almoco"],
    texto:
      "Perto da casa recomendo a Trattoria del Mare (6 min a pé) e a Cantina da Vila. Ambas estão em Explorar → Restaurantes.",
  },
  {
    gatilhos: ["cataratas", "passeio", "fazer", "programa"],
    texto:
      "As Cataratas abrem às 9h e vale ir cedo. Também tem o Mirante do Encanto para o fim de tarde — os dois estão em Explorar → Experiências.",
  },
];

const SUGESTOES = ["Qual é a senha do wi-fi?", "Posso chegar mais cedo?", "Onde jantar hoje?"];

function responderComo(pergunta: string) {
  const texto = pergunta.toLowerCase();
  const achou = RESPOSTAS.find((r) => r.gatilhos.some((g) => texto.includes(g)));
  return (
    achou?.texto ??
    "Anotei sua pergunta! Nesta demonstração eu respondo sobre wi-fi, horários de chegada e saída, manutenção e dicas da região."
  );
}

/* ------------------------------ peças de UI ----------------------------- */

function Secao({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-1 text-[8.5px] font-bold uppercase tracking-[0.24em] text-white/60">
      <span className="size-1.5 rounded-full" style={{ background: GRAD }} />
      {children}
    </p>
  );
}

function Linha({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wifi;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="text-[8.5px] font-bold uppercase tracking-[0.2em] text-white/50">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/85 text-pretty">{value}</p>
      </div>
    </div>
  );
}

function Acordeao({
  titulo,
  children,
  aberto,
  onToggle,
}: {
  titulo: string;
  children: React.ReactNode;
  aberto: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[0.5rem] border border-white/10 bg-white/[0.04]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left"
      >
        <p className="min-w-0 flex-1 text-[11.5px] font-semibold text-pretty">{titulo}</p>
        <ChevronDown
          className={cn("size-4 shrink-0 text-white/45 transition-transform", aberto && "rotate-180")}
        />
      </button>
      {aberto ? (
        <p className="px-3 pb-3 text-[10.5px] leading-snug text-white/70 text-pretty">{children}</p>
      ) : null}
    </div>
  );
}

/* --------------------------------- abas --------------------------------- */

function TelaInicio({ ir }: { ir: (t: Tab) => void }) {
  const [faq, setFaq] = useState<number | null>(null);
  return (
    <div className="min-w-0 pb-5">
      <div className="flex min-w-0 items-center gap-2 px-3 pt-3">
        <img src={conciergeLogo} alt="" aria-hidden className="size-4 shrink-0 object-contain" />
        <p className="truncate font-display text-[12.5px] font-extrabold tracking-tight">ConciergeIA</p>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[8.5px] font-bold uppercase tracking-[0.18em] text-white/60">
          <span className="size-1.5 rounded-full bg-emerald-400" /> Foz do Iguaçu
        </span>
      </div>

      <div className="relative mx-3 mt-3 h-[150px] overflow-hidden rounded-[0.6rem]">
        <img src={sceneApto.url} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/35 to-transparent" />
        <div className="absolute inset-x-3 bottom-3 min-w-0">
          <p className="font-serif text-[19px] leading-tight text-pretty">
            Casa Charmosa Próx. a Avenida das Cataratas
          </p>
          <p className="mt-1 text-[10px] text-white/70">
            Tudo o que você precisa para uma estadia incrível.
          </p>
        </div>
      </div>

      <div className="mt-2.5 min-w-0 space-y-2.5 px-3">
        <div className="min-w-0 rounded-[0.3rem] border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Clock className="size-3.5 shrink-0 text-amber-400" />
            <p className="min-w-0 text-[11px] text-white/80">
              check-in libera em <span className="font-bold tabular-nums text-amber-300">11h42</span>
            </p>
            <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-ice">15:00</span>
          </div>
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/5 rounded-full bg-gradient-to-r from-amber-500 to-amber-300" />
          </div>
        </div>

        <div className="min-w-0 rounded-[0.5rem] border border-amber-400/20 bg-amber-400/[0.07] p-3">
          <p className="text-[8.5px] font-bold uppercase tracking-[0.22em] text-amber-300">
            Importante · Check-in
          </p>
          <p className="mt-1 text-[11px] leading-snug text-white/85 text-pretty">
            Nos mantenha informados a partir de 1 hora de distância da residência.
          </p>
        </div>

        <Secao>Acessos rápidos</Secao>

        <button
          type="button"
          onClick={() => ir("chegada")}
          className="w-full min-w-0 rounded-[0.5rem] border border-accent/25 p-3 text-left transition-colors hover:border-accent/50"
          style={{ background: "linear-gradient(120deg,rgba(124,26,216,0.22),rgba(232,45,174,0.10))" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full border border-accent/25 bg-[#2a0f3d] text-accent">
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[16px] font-extrabold tracking-tight">Chegada</p>
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
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => ir("saida")}
            className="min-w-0 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-3 text-left transition-colors hover:border-accent/35"
          >
            <span className="grid size-8 place-items-center rounded-[0.35rem]" style={{ background: GRAD }}>
              <LogOut className="size-4 text-white" />
            </span>
            <p className="mt-2 truncate font-display text-[13px] font-bold">Saída</p>
            <p className="mt-0.5 truncate text-[10px] text-white/55">Check-out até 11h</p>
          </button>
          <button
            type="button"
            onClick={() => ir("chegada")}
            className="min-w-0 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-3 text-left transition-colors hover:border-accent/35"
          >
            <span className="grid size-8 place-items-center rounded-[0.35rem]" style={{ background: GRAD }}>
              <Wifi className="size-4 text-white" />
            </span>
            <p className="mt-2 truncate font-display text-[13px] font-bold">Wi-Fi</p>
            <p className="mt-0.5 truncate text-[10px] text-white/55">Rede e senha</p>
          </button>
        </div>

        <button
          type="button"
          onClick={() => ir("explorar")}
          className="flex w-full min-w-0 items-center gap-3 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-3 text-left transition-colors hover:border-accent/35"
        >
          <span
            className="grid size-11 shrink-0 place-items-center rounded-[0.5rem] border border-white/10"
            style={{ background: "linear-gradient(140deg,rgba(124,26,216,0.55),rgba(232,45,174,0.35))" }}
          >
            <Compass className="size-5 text-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[13px] font-bold">Explore a região</p>
            <p className="truncate text-[10px] text-white/55">388 lugares curados pelo anfitrião</p>
          </div>
          <ChevronRight className="ml-auto size-4 shrink-0 text-white/40" />
        </button>

        <Secao>O que rola em Foz do Iguaçu</Secao>
        {[
          { img: recWaterfall, t: "Cataratas com horário estendido no fim de semana", d: "Parque Nacional · hoje" },
          { img: recMarket, t: "Feira de artesanato na Praça da Paz", d: "Centro · a partir das 18h" },
        ].map((n) => (
          <div
            key={n.t}
            className="flex min-w-0 gap-3 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-2.5"
          >
            <div className="relative size-14 shrink-0 overflow-hidden rounded-[0.4rem]">
              <img src={n.img} alt="" className="absolute inset-0 size-full object-cover" />
            </div>
            <div className="min-w-0 self-center">
              <p className="line-clamp-2 text-[11.5px] font-semibold leading-snug text-pretty">{n.t}</p>
              <p className="mt-0.5 truncate text-[9.5px] text-white/55">{n.d}</p>
            </div>
          </div>
        ))}

        <Secao>Dúvidas frequentes</Secao>
        {[
          { q: "Posso levar pet?", a: "Sim, mediante aviso prévio ao anfitrião antes da chegada." },
          { q: "Tem estacionamento?", a: "Sim: vaga 42, no subsolo 1, com acesso pelo portão lateral." },
          { q: "Qual o horário de silêncio?", a: "Das 22h às 8h, conforme o regulamento do condomínio." },
        ].map((f, i) => (
          <Acordeao key={f.q} titulo={f.q} aberto={faq === i} onToggle={() => setFaq(faq === i ? null : i)}>
            {f.a}
          </Acordeao>
        ))}

        <div className="flex min-w-0 items-center justify-center gap-2 pt-3">
          <img src={conciergeLogo} alt="" aria-hidden className="size-3.5 object-contain opacity-80" />
          <p className="text-[8.5px] font-semibold uppercase tracking-[0.3em] text-white/70">
            Seu concierge. Sua experiência.
          </p>
        </div>
      </div>
    </div>
  );
}

function TelaChegada() {
  const [passo, setPasso] = useState<number | null>(0);
  const passos = [
    { t: "Como chegar", d: "Rua das Palmeiras, 128 — portão azul, ao lado da padaria." },
    { t: "Abrir a porta", d: "Fechadura digital: o código é enviado no dia da chegada, às 12h." },
    { t: "Estacionamento", d: "Vaga 42, subsolo 1. O controle fica no armário da entrada." },
    { t: "Wi-Fi", d: "Rede Beira-Mar 201 · senha praia2026." },
  ];
  return (
    <div className="min-w-0 space-y-2.5 px-3 pb-5 pt-5">
      <p className="text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">Chegada</p>
      <p className="font-serif text-[22px] leading-tight">Seu check-in, passo a passo</p>
      <p className="text-[10.5px] leading-snug text-white/60 text-pretty">
        Toque em cada etapa para ver as instruções completas.
      </p>
      <div className="space-y-2 pt-1">
        {passos.map((p, i) => (
          <Acordeao
            key={p.t}
            titulo={`${i + 1}. ${p.t}`}
            aberto={passo === i}
            onToggle={() => setPasso(passo === i ? null : i)}
          >
            {p.d}
          </Acordeao>
        ))}
      </div>
      <Linha icon={ShieldCheck} label="Tudo pronto" value="limpeza conferida e enxoval trocado" />
      <Linha icon={Phone} label="Contato" value="fale com o anfitrião pelo botão do Atendimento" />
    </div>
  );
}

function TelaSaida() {
  const [feitos, setFeitos] = useState<number[]>([]);
  const itens = [
    "Deixar as chaves sobre a bancada",
    "Fechar todas as janelas",
    "Descartar o lixo na garagem",
    "Desligar o ar-condicionado",
  ];
  const alternar = (i: number) =>
    setFeitos((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i]));
  const pronto = feitos.length === itens.length;
  return (
    <div className="min-w-0 space-y-2.5 px-3 pb-5 pt-5">
      <p className="text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">Saída</p>
      <p className="font-serif text-[22px] leading-tight">Check-out até as 11h</p>
      <p className="text-[10.5px] leading-snug text-white/60 text-pretty">
        Marque cada item — o anfitrião acompanha em tempo real.
      </p>
      <div className="space-y-2 pt-1">
        {itens.map((t, i) => {
          const ok = feitos.includes(i);
          return (
            <button
              key={t}
              type="button"
              onClick={() => alternar(i)}
              className={cn(
                "flex w-full min-w-0 items-center gap-2.5 rounded-[0.5rem] border p-3 text-left transition-colors",
                ok ? "border-accent/45 bg-accent/12" : "border-white/10 bg-white/[0.04]",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-[0.25rem] border text-[10px] font-black",
                  ok ? "border-transparent text-white" : "border-white/25 text-transparent",
                )}
                style={ok ? { background: GRAD } : undefined}
              >
                ✓
              </span>
              <span className={cn("min-w-0 text-[11.5px] text-pretty", ok && "text-white")}>{t}</span>
            </button>
          );
        })}
      </div>
      <div
        className={cn(
          "min-w-0 rounded-[0.5rem] border p-3 text-[11px] text-pretty transition-colors",
          pronto ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/[0.03] text-white/60",
        )}
      >
        {pronto
          ? "Tudo certo! A equipe de limpeza já foi avisada da sua saída."
          : `${feitos.length} de ${itens.length} itens concluídos.`}
      </div>
    </div>
  );
}

function TelaExplorar() {
  const [cat, setCat] = useState<string | null>(null);
  const [lugar, setLugar] = useState<Lugar | null>(null);
  const [busca, setBusca] = useState("");

  const categoria = CATEGORIAS.find((c) => c.id === cat) ?? null;

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return CATEGORIAS;
    return CATEGORIAS.filter(
      (c) => c.titulo.toLowerCase().includes(termo) || c.desc.toLowerCase().includes(termo),
    );
  }, [busca]);

  if (lugar) {
    return (
      <div className="min-w-0 pb-5">
        <div className="relative h-[150px] w-full overflow-hidden">
          <img src={lugar.img} alt="" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/25 to-transparent" />
          <button
            type="button"
            onClick={() => setLugar(null)}
            className="absolute left-3 top-3 grid size-8 place-items-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur"
            aria-label="Voltar"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="absolute inset-x-4 bottom-2.5 min-w-0">
            <p className="flex items-center gap-1 text-[9.5px] font-bold text-accent">
              <Star className="size-3" /> {lugar.nota}
            </p>
            <p className="mt-0.5 truncate font-serif text-[20px] leading-tight">{lugar.nome}</p>
          </div>
        </div>
        <div className="min-w-0 space-y-2 px-4 pt-3">
          <p className="text-[11px] leading-snug text-white/70 text-pretty">{lugar.desc}</p>
          <Linha icon={Clock} label="Horário" value={lugar.horario} />
          <Linha icon={MapPin} label="Como chegar" value="rota aberta no mapa com um toque" />
          <Linha icon={Sparkles} label="Dica do anfitrião" value={lugar.dica} />
        </div>
      </div>
    );
  }

  if (categoria) {
    return (
      <div className="min-w-0 pb-5">
        <div className="min-w-0 px-4 pt-5">
          <button
            type="button"
            onClick={() => setCat(null)}
            className="flex items-center gap-1.5 text-[10px] font-semibold text-white/60 hover:text-white"
          >
            <ArrowLeft className="size-3.5" /> Todas as categorias
          </button>
          <p className="mt-2.5 flex items-center gap-1.5 text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">
            <categoria.icone className="size-3" /> {categoria.lugares.length} lugares
          </p>
          <p className="mt-1 font-serif text-[23px] leading-tight">{categoria.titulo}</p>
          <p className="mt-1 text-[10.5px] leading-snug text-white/60 text-pretty">{categoria.desc}</p>
        </div>
        <div className="mt-3 min-w-0 space-y-2.5 px-4">
          {categoria.lugares.map((l) => (
            <button
              key={l.nome}
              type="button"
              onClick={() => setLugar(l)}
              className="flex w-full min-w-0 gap-3 rounded-[0.9rem] border border-white/10 bg-white/[0.04] p-2.5 text-left transition-colors hover:border-accent/35"
            >
              <div className="relative size-[74px] shrink-0 overflow-hidden rounded-[0.7rem]">
                <img src={l.img} alt="" className="absolute inset-0 size-full object-cover" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                <p className="flex items-center gap-1 text-[9.5px] font-bold text-accent">
                  <Star className="size-3 shrink-0" /> {l.nota}
                </p>
                <p className="truncate font-serif text-[15px] leading-tight">{l.nome}</p>
                <p className="line-clamp-2 text-[10px] leading-snug text-white/60 text-pretty">{l.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 pb-5">
      <div className="min-w-0 px-4 pt-6">
        <p className="text-[8.5px] font-bold uppercase tracking-[0.26em] text-accent">ConciergeIA</p>
        <p className="mt-1.5 font-serif text-[24px] leading-tight">Explore a Região</p>
        <p className="mt-1.5 text-[10.5px] leading-snug text-white/60 text-pretty">
          Uma curadoria de lugares e experiências próximas a Casa Charmosa.
        </p>
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2 px-4">
        <span className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[0.5rem] border border-white/12 bg-white/[0.04] px-2.5">
          <Search className="size-3.5 shrink-0 text-white/40" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome"
            className="min-w-0 flex-1 bg-transparent text-[10.5px] text-ice outline-none placeholder:text-white/40"
          />
        </span>
        <span className="flex h-9 shrink-0 items-center gap-1.5 text-[10.5px] font-medium text-white/70">
          <SlidersHorizontal className="size-3.5" /> Filtros
        </span>
      </div>
      <div className="mt-3 min-w-0 space-y-2.5 px-4">
        {lista.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCat(c.id)}
            className="flex w-full min-w-0 gap-3 rounded-[0.9rem] border border-white/10 bg-white/[0.04] p-2.5 text-left transition-colors hover:border-accent/35"
          >
            <div className="relative size-[74px] shrink-0 overflow-hidden rounded-[0.7rem]">
              <img src={c.img} alt="" className="absolute inset-0 size-full object-cover" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
              <p className="flex min-w-0 items-center gap-1.5 truncate text-[8.5px] font-bold uppercase tracking-[0.2em] text-accent">
                <c.icone className="size-3 shrink-0" /> {c.lugares.length} lugares
              </p>
              <p className="truncate font-serif text-[16px] leading-tight">{c.titulo}</p>
              <p className="line-clamp-2 text-[10px] leading-snug text-white/60 text-pretty">{c.desc}</p>
            </div>
          </button>
        ))}
        {lista.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] text-white/50">
            Nada encontrado para “{busca}”.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------- chat da IA ------------------------------ */

type Msg = { de: "hospede" | "ia"; texto: string };

function ChatIA({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { de: "ia", texto: "Oi! Sou o atendimento da casa. Pode perguntar o que precisar da estadia." },
  ]);
  const [texto, setTexto] = useState("");
  const [digitando, setDigitando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [msgs, digitando]);

  const enviar = (pergunta: string) => {
    const p = pergunta.trim();
    if (!p || digitando) return;
    setMsgs((m) => [...m, { de: "hospede", texto: p }]);
    setTexto("");
    setDigitando(true);
    window.setTimeout(() => {
      setMsgs((m) => [...m, { de: "ia", texto: responderComo(p) }]);
      setDigitando(false);
    }, 850);
  };

  return (
    <div className="absolute inset-0 z-20 flex min-w-0 flex-col bg-[#0a0a0f]">
      <div className="flex min-w-0 items-center gap-2 border-b border-white/8 px-3 py-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full" style={{ background: GRAD }}>
          <Sparkles className="size-3.5 text-white" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-[12.5px] font-bold">Atendimento ao Hóspede</p>
          <p className="truncate text-[9.5px] text-emerald-300">online agora</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar atendimento"
          className="ml-auto grid size-7 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="min-w-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex min-w-0", m.de === "hospede" ? "justify-end" : "justify-start")}>
            <p
              className={cn(
                "max-w-[82%] min-w-0 rounded-[0.6rem] px-3 py-2 text-[11px] leading-snug text-pretty",
                m.de === "hospede"
                  ? "bg-accent text-accent-foreground"
                  : "border border-white/10 bg-white/[0.05] text-white/85",
              )}
            >
              {m.texto}
            </p>
          </div>
        ))}
        {digitando ? (
          <p className="text-[10px] text-white/45">digitando…</p>
        ) : null}
        <div ref={fim} />
      </div>

      <div className="min-w-0 border-t border-white/8 px-3 py-2.5">
        <div className="ds-scroll-x flex gap-1.5 pb-2">
          {SUGESTOES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => enviar(s)}
              className="whitespace-nowrap rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[9.5px] text-white/70 hover:border-accent/40 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar(texto);
          }}
          className="flex min-w-0 items-center gap-2"
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escreva sua pergunta…"
            className="h-9 min-w-0 flex-1 rounded-[0.5rem] border border-white/12 bg-white/[0.04] px-2.5 text-[11px] text-ice outline-none placeholder:text-white/40 focus:border-accent/45"
          />
          <button
            type="submit"
            aria-label="Enviar"
            className="grid size-9 shrink-0 place-items-center rounded-[0.5rem] text-white"
            style={{ background: GRAD }}
          >
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------- componente ------------------------------ */

const ABAS: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: "home", label: "Início", icon: Home },
  { key: "chegada", label: "Chegada", icon: KeyRound },
  { key: "saida", label: "Saída", icon: DoorOpen },
  { key: "explorar", label: "Explorar", icon: Compass },
];

export function InteractiveGuide() {
  const [aba, setAba] = useState<Tab>("home");
  const [chat, setChat] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);

  const ir = (t: Tab) => {
    setAba(t);
    rolagem.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="relative flex h-[560px] min-w-0 flex-col bg-[#0a0a0f] text-foreground">
      <div ref={rolagem} className="min-w-0 flex-1 overflow-y-auto">
        {aba === "home" ? <TelaInicio ir={ir} /> : null}
        {aba === "chegada" ? <TelaChegada /> : null}
        {aba === "saida" ? <TelaSaida /> : null}
        {aba === "explorar" ? <TelaExplorar /> : null}
      </div>

      {!chat ? (
        <button
          type="button"
          onClick={() => setChat(true)}
          className="absolute bottom-[74px] right-3 z-10 flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[11px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(232,45,174,0.9)]"
          style={{ background: GRAD }}
        >
          <MessageCircle className="size-4" /> Atendimento
        </button>
      ) : null}

      <div className="mt-auto flex min-w-0 items-stretch gap-1 border-t border-white/8 bg-[#080815]/90 px-3 pb-3 pt-2 backdrop-blur">
        {ABAS.map((t) => {
          const ativo = t.key === aba;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => ir(t.key)}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-[0.5rem]",
                  ativo ? "text-white" : "text-white/45",
                )}
                style={ativo ? { background: GRAD } : undefined}
              >
                <t.icon className="size-4" />
              </span>
              <span
                className={cn(
                  "truncate text-[9px] font-semibold",
                  ativo ? "text-white" : "text-white/45",
                )}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {chat ? <ChatIA onClose={() => setChat(false)} /> : null}
    </div>
  );
}

export { BookOpen };
