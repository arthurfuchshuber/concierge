/**
 * PEDIDOS SOBRE A RESERVA: estender, "por fora", cancelar, reduzir, mudar período
 * (17/10/2026, decisão do anfitrião).
 *
 * Quem DECIDE é o código (puro, testado); o modelo só comunica. Assim a IA não
 * erra prazo nem "interpreta" a política:
 *  - estender / reservar "por fora": SEMPRE orientar o caminho pela plataforma
 *    (detalhes da reserva, se já há reserva confirmada; confirmar a reserva
 *    pela plataforma, se não há). Nunca fechar por fora. Não aciona a equipe.
 *  - cancelar / reduzir período / mudar período: olha a MODALIDADE (política de
 *    cancelamento da reserva) e o prazo:
 *      · prazo sem multa VENCIDO → informa com gentileza que não temos
 *        autorização para seguir com a solicitação por causa da modalidade da
 *        reserva; se insistir, pode tentar o suporte da plataforma. Sem equipe.
 *      · ainda DENTRO do prazo sem multa → aí sim passa para a equipe.
 *      · não deu para determinar (política desconhecida) → equipe decide.
 */
import { zonedTimeToUtc } from "@/lib/property-timezone";

export type ReservationRequestKind = "cancel" | "shorten" | "change_dates" | "extend" | "outside_booking";

const n = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const OUTSIDE =
  /\b(por fora|fora (do|da) (airbnb|plataforma|app|aplicativo|site)|sem passar (pelo|pela) (airbnb|plataforma|app)|direto com (voce|voces|o anfitriao|a anfitria|o proprietario)|reservar direto|fechar direto|pagar (direto|por fora)|pix direto|sem (a )?plataforma|sem taxa (do|da) (airbnb|plataforma))\b/;
const EXTEND =
  /\b(estender|prorrogar|prolongar|ficar mais (um|uma|dois|duas|\d+) (dia|dias|noite|noites)|mais (um|uma|dois|duas|\d+) (dia|dias|noite|noites)|acrescentar (uma |duas |\d+ )?(noite|noites|dia|dias)|adicionar (uma |duas |\d+ )?(noite|noites|dia|dias)|renovar a estadia|ficar (mais )?ate (o dia )?\d)/;
const CANCEL = /\b(cancelar|cancelamento|cancela(r)? (a )?(minha )?reserva|desistir da reserva|nao (vou|vamos|iremos) (mais )?(poder )?(ir|viajar|ficar))\b/;
const SHORTEN =
  /\b(reduzir (o )?(periodo|estadia|numero de (noites|diarias))|encurtar|diminuir (a )?(estadia|periodo|noites|diarias)|sair (antes|mais cedo) (do que|da data)|(ir|ficar) embora antes|antecipar (a )?(saida|checkout|check-out)|ficar so (ate|\d+)|cortar (uma |duas )?(noite|noites|diaria|diarias))\b/;
const CHANGE =
  /\b((mudar|trocar|alterar|adiar|antecipar|transferir|passar) (a |o |as |os |essa |esse |essas |esta |este |minha |meu |minhas |nossa |nosso |nossas |de |da |do )?(data|datas|periodo|reserva|estadia|hospedagem|viagem|check-?in|chegada)|remarc\w*|reagend\w*)\b/;

/** Que tipo de pedido sobre a reserva está nesta mensagem? (a ordem importa) */
export function detectReservationRequest(message: string): ReservationRequestKind | null {
  const t = n(message);
  if (!t) return null;
  if (OUTSIDE.test(t)) return "outside_booking";
  if (CANCEL.test(t)) return "cancel";
  if (SHORTEN.test(t)) return "shorten";
  if (CHANGE.test(t)) return "change_dates";
  if (EXTEND.test(t)) return "extend";
  return null;
}

/**
 * Política de cancelamento do Airbnb por categoria (referência: política padrão
 * vigente da plataforma). Valores em HORAS antes do horário de check-in do
 * anúncio em que o cancelamento ainda é sem multa. Se a plataforma mudar uma
 * política, ajustar AQUI (um lugar só).
 */
export const FREE_CANCEL_HOURS: Record<string, number | null> = {
  flexible: 24,
  moderate: 5 * 24,
  firm: 30 * 24,
  firm_14: 14 * 24,
  strict: null,
  // Tarifa não reembolsável escolhida pelo hóspede: não há prazo sem multa.
  tiered_pricing_non_refundable: null,
  super_strict_30: null,
  super_strict_60: null,
};
export const LONG_STAY_NIGHTS = 28;
export const LONG_STAY_FREE_HOURS = 30 * 24;
/** Carência de 48 h após reservar, desde que o check-in esteja a 14+ dias da reserva. */
export const GRACE_HOURS = 48;
export const GRACE_MIN_LEAD_DAYS = 14;

const LABEL: Record<string, string> = {
  flexible: "Flexível",
  moderate: "Moderada",
  firm: "Firme",
  firm_14: "Firme (14 dias)",
  strict: "Rígida",
  tiered_pricing_non_refundable: "Não reembolsável",
  better_strict_with_grace_period: "Rígida com período de carência",
  strict_14_with_grace_period: "Rígida com período de carência",
  super_strict_30: "Super rígida (30 dias)",
  super_strict_60: "Super rígida (60 dias)",
};

export type CancellationStatus = "free" | "expired" | "unknown";
export type CancellationWindow = {
  status: CancellationStatus;
  /** Rótulo legível da modalidade (ex.: "Moderada"). */
  policy: string | null;
  /** Limite do cancelamento sem multa, "DD/MM/AAAA HH:MM" no fuso do imóvel. */
  deadline: string | null;
  /** Por que não foi possível decidir (status unknown). */
  reason?: string;
};

const pad = (x: number) => String(x).padStart(2, "0");

export function cancellationWindow(p: {
  category: string | null | undefined;
  checkin: string | null | undefined;
  checkinTime: unknown;
  nights: number | null;
  /** Quando a reserva foi feita (ISO), se conhecido: necessário só para a carência. */
  bookedAt?: string | null;
  tz: string;
  nowMs: number;
}): CancellationWindow {
  const cat = String(p.category ?? "").toLowerCase().trim();
  if (!cat) return { status: "unknown", policy: null, deadline: null, reason: "modalidade não cadastrada" };
  const policy = LABEL[cat] ?? cat;
  const ci = p.checkin ? String(p.checkin).slice(0, 10).split("-").map(Number) : null;
  if (!ci || ci.length !== 3 || ci.some((x) => !Number.isFinite(x)))
    return { status: "unknown", policy, deadline: null, reason: "data de check-in desconhecida" };
  const tm = String(p.checkinTime ?? "15:00").match(/^(\d{1,2}):(\d{2})/);
  const h = tm ? Number(tm[1]) : 15;
  const mi = tm ? Number(tm[2]) : 0;
  const gate = zonedTimeToUtc(ci[0]!, ci[1]!, ci[2]!, h, mi, p.tz).getTime();
  const fmt = (ms: number) => {
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat("pt-BR", {
      timeZone: p.tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d);
    return parts.replace(",", "");
  };

  const grace = cat === "better_strict_with_grace_period" || cat === "strict_14_with_grace_period";
  if (grace) {
    if (!p.bookedAt) return { status: "unknown", policy, deadline: null, reason: "data da reserva desconhecida" };
    const booked = Date.parse(p.bookedAt);
    if (!Number.isFinite(booked)) return { status: "unknown", policy, deadline: null, reason: "data da reserva inválida" };
    const leadDays = (gate - booked) / 86_400_000;
    if (leadDays < GRACE_MIN_LEAD_DAYS) return { status: "expired", policy, deadline: null };
    const end = booked + GRACE_HOURS * 3_600_000;
    return { status: p.nowMs <= end ? "free" : "expired", policy, deadline: fmt(end) };
  }

  let hours = Object.prototype.hasOwnProperty.call(FREE_CANCEL_HOURS, cat) ? FREE_CANCEL_HOURS[cat]! : undefined;
  if (hours === undefined) return { status: "unknown", policy, deadline: null, reason: "modalidade não reconhecida" };
  // Estadia longa (28+ noites) segue a regra de longa duração (30 dias).
  if (p.nights != null && p.nights >= LONG_STAY_NIGHTS) hours = Math.max(hours ?? 0, LONG_STAY_FREE_HOURS);
  if (hours === null) return { status: "expired", policy, deadline: null };
  const end = gate - hours * 3_600_000;
  return { status: p.nowMs <= end ? "free" : "expired", policy, deadline: fmt(end) };
}

export type ReservationDecision = {
  kind: ReservationRequestKind;
  /** A IA resolve sozinha ("platform") ou a equipe decide ("team") ou recusa com gentileza ("decline"). */
  route: "platform" | "decline" | "team" | "platform_menu";
  window: CancellationWindow | null;
};

export function decideReservationRequest(p: {
  kind: ReservationRequestKind;
  window: CancellationWindow | null;
}): ReservationDecision {
  if (p.kind === "extend" || p.kind === "outside_booking") return { kind: p.kind, route: "platform", window: null };
  const w = p.window ?? { status: "unknown" as const, policy: null, deadline: null };
  // Sem certeza da modalidade DA RESERVA (decisão do anfitrião, 17/10/2026): a IA
  // não calcula prazo, não recusa e não presume "dentro do prazo". Orienta o menu
  // da reserva na plataforma, onde o hóspede vê a modalidade e os prazos reais.
  if (w.status === "unknown") return { kind: p.kind, route: "platform_menu", window: w };
  return { kind: p.kind, route: w.status === "expired" ? "decline" : "team", window: w };
}

/** Bloco injetado no prompt: o código decidiu, o modelo só comunica. */
export function reservationRequestGuidance(d: ReservationDecision, hasConfirmedReservation: boolean): string {
  const L: string[] = ["\n\nPEDIDO SOBRE A RESERVA (decisão já tomada pelo sistema; comunique com gentileza e precisão, no plural: nós, nossa equipe)"];
  if (d.kind === "outside_booking") {
    L.push(
      "- O hóspede quer reservar/pagar \"por fora\". NÃO feche nada por fora e não sugira isso. Oriente que qualquer reserva ou ajuste é feito pela plataforma, onde ele fica protegido.",
      hasConfirmedReservation
        ? "- Já existe reserva confirmada: oriente a fazer o ajuste nos DETALHES DA RESERVA na plataforma."
        : "- Ainda não há reserva confirmada: oriente a CONFIRMAR a reserva pela plataforma (link do anúncio, se houver).",
      "- Não acione a equipe.",
    );
  } else if (d.kind === "extend") {
    L.push(
      "- O hóspede quer estender/acrescentar noites. Verifique a disponibilidade com check_availability (se livre, ótimo; se ocupado, ofereça a alternativa com find_available_stays, como já orientado).",
      hasConfirmedReservation
        ? "- Estando livre: oriente a solicitar a alteração nos DETALHES DA RESERVA na plataforma. Nunca feche por fora, nunca informe valor."
        : "- Sem reserva confirmada: oriente a CONFIRMAR a reserva pela plataforma. Nunca feche por fora, nunca informe valor.",
      "- Não acione a equipe.",
    );
  } else {
    const what =
      d.kind === "cancel" ? "cancelar a reserva" : d.kind === "shorten" ? "reduzir o período" : "mudar o período";
    const w = d.window;
    const pol = w?.policy ? `modalidade ${w.policy}` : "modalidade da reserva";
    L.push(`- O hóspede quer ${what}. ${w?.policy && w.status !== "unknown" ? `Modalidade da reserva: ${w.policy}.` : "Modalidade da reserva não confirmada."}${w?.deadline ? ` Limite do cancelamento sem multa: ${w.deadline}.` : ""}`);
    if (d.route === "platform_menu") {
      L.push(
        "- A modalidade desta reserva NÃO está confirmada. É PROIBIDO presumir a política, citar prazo, dizer que dá ou não para cancelar/alterar, ou prometer qualquer resultado.",
        "- Acolha em uma frase e oriente o hóspede a abrir os detalhes da reserva na plataforma: lá aparecem a modalidade e as opções de cancelamento ou alteração com os prazos reais. Se ele insistir ou pedir uma pessoa, aí sim acione a equipe (request_human_handoff) com o pedido e o sentimento dele.",
      );
    } else if (d.route === "decline") {
      const nonRef = w?.policy === "Não reembolsável";
      L.push(
        nonRef
          ? "- A reserva foi feita na modalidade NÃO REEMBOLSÁVEL escolhida pelo hóspede na plataforma (tarifa com desconto em troca de regras rígidas). Explique que, nessa modalidade, a PLATAFORMA não permite alteração de datas, remarcação nem cancelamento com reembolso, e por isso precisamos manter as condições contratadas."
          : `- O prazo sem multa da ${pol} JÁ PASSOU${w?.deadline ? ` (era até ${w.deadline})` : ""}. Explique que, pelas regras da PLATAFORMA para essa modalidade, alteração/cancelamento fora do prazo não é permitido sem multa, e por isso precisamos manter as condições contratadas.`,
        "- A responsabilidade da regra é da plataforma e da modalidade escolhida na compra, nunca uma decisão pessoal nossa. Tom acolhedor (se houver imprevisto de saúde/família, demonstre empatia real em uma frase).",
        "- PROIBIDO: perguntar novas datas, sugerir que 'talvez dê', oferecer exceção, dizer que vai consultar alguém, discutir valores ou prometer reembolso.",
        "- OBJEÇÕES (siga a mesma linha, sempre com gentileza e firmeza): se o hóspede disser que o suporte da plataforma falou que 'é só o anfitrião aceitar', explique que essa é uma orientação padrão do suporte, mas que as condições da modalidade contratada valem igualmente para todas as reservas e não temos autorização para exceções; qualquer análise excepcional (ex.: casos cobertos pela política de circunstâncias atenuantes) é feita pela própria plataforma, pelo canal de suporte dela. Se insistir de novo, reafirme em poucas palavras, sem repetir o texto anterior. Nunca contradiga o que a equipe já disse.",
        "- Imprevisto grave (saúde, falecimento, desastre) ou oferta de atestado/comprovante: acolha com empatia real e oriente a formalizar o pedido junto ao suporte da plataforma, pela política de circunstâncias atenuantes, anexando os documentos por lá. NÃO peça nem receba documentos aqui.",
        "- Objeção, insistência, pedido para 'falar com o anfitrião' ou ameaça de avaliação NÃO mudam a decisão: continue com os MESMOS argumentos (regra da plataforma + suporte da plataforma para casos excepcionais). É PROIBIDO acionar a equipe (request_human_handoff/ask_human_supervisor), dizer que vai 'repassar', 'verificar com o anfitrião' ou 'levar o caso' adiante.",
        "- Não acione a equipe.",
      );
    } else {
      L.push(
        w?.status === "free"
          ? `- Ainda está DENTRO do prazo sem multa${w.deadline ? ` (até ${w.deadline})` : ""}: não decida nem informe resultado. Acione a equipe (request_human_handoff) informando o pedido, a modalidade, o limite do prazo e o SENTIMENTO do hóspede.`
          : `- Não foi possível confirmar o prazo (${w?.reason ?? "dados insuficientes"}): não decida nem informe resultado. Acione a equipe (request_human_handoff) informando o pedido, o que faltou e o SENTIMENTO do hóspede.`,
        "- Com o hóspede: acolha em uma frase, sem prometer resultado, prazo ou reembolso, e sem perguntar novas datas antes da decisão da equipe.",
      );
    }
  }
  return L.join("\n");
}

/**
 * Quando a equipe humana já falou na conversa, a IA retoma seguindo a MESMA
 * linha de raciocínio: nunca desdiz, flexibiliza ou reabre o que foi decidido.
 */
export function humanLineGuidance(history: Array<{ role: string; content: string }>): string {
  const recent = history.slice(-12);
  const human = recent.filter((m) => m.role === "assistant" && m.content.startsWith("[Mensagem da equipe humana do anfitrião]"));
  if (!human.length) return "";
  return [
    "\n\nCONTINUIDADE COM A EQUIPE (obrigatório)",
    "- A equipe humana já respondeu nesta conversa (mensagens marcadas como da equipe). A posição dela é a posição oficial: siga exatamente a mesma linha de raciocínio.",
    "- PROIBIDO contradizer, flexibilizar, reabrir opções que a equipe negou ou repetir perguntas que ela já encerrou.",
    "- Se o hóspede só concordou/agradeceu, responda curto e acolhedor, sem trazer o assunto de volta. Se ele insistir ou contestar, reafirme com gentileza o que a equipe disse, com outras palavras.",
  ].join("\n");
}
