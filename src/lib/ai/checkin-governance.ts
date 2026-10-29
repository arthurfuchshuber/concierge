/**
 * GOVERNANÇA DE CHECK-IN (29/10/2026, caso Fernanda Clara — Casa Charmosa).
 *
 * Regras do anfitrião, aplicadas por código (puro, testável):
 *  A. Pergunta de senha/guia SEM presença física confirmada é preparatória:
 *     ajuda com o guia e pergunta onde/quando chega antes de despejar o acesso.
 *  B. Chegada depois do limite de check-in (`checkin_time_max`) ou de
 *     madrugada, ou terceiros chegando sem o titular e sem alinhamento: a IA
 *     NÃO decide — consulta a equipe com botões e fica em silêncio; após o
 *     clique, UMA resposta = advertência gentil + decisão.
 *  C. Contingência: card pendente sem resposta + hóspede cobrando / chegando.
 *     Acesso 100% autônomo + reserva verificada + credenciais → conduz a
 *     entrada educando sobre o horário. Senão → ponte de espera (está
 *     verificando a possibilidade e retorna por aqui; pede que aguarde).
 */

const norm = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const hmToMin = (v: unknown): number | null => {
  const m = String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? h * 60 + mi : null;
};

/** Madrugada termina às 06:00. Horários antes disso contam como "depois de ontem". */
const DAWN_END = 6 * 60;
const shift = (min: number) => (min < DAWN_END ? min + 1440 : min);

const ARRIVAL_TOPIC =
  /\b(cheg\w*|entr(ar|o|amos|am|arao|em)|check-?in|vou estar|estarei|estaremos|vao estar|devo estar|previsao)\b/;

/**
 * Horário de CHEGADA mencionado na mensagem, em minutos do dia. Conservador:
 * só lê quando a frase fala de chegada; 0h–6h só com "manhã/madrugada",
 * zero à esquerda ("02:00") ou "meia-noite" (evita ler "às 2" como 2h da manhã).
 */
export function detectArrivalTime(text: string): number | null {
  const t = norm(text);
  if (!ARRIVAL_TOPIC.test(t)) return null;
  if (/\bmeia[- ]?noite\b/.test(t)) return 0;
  const rx = /\b(\d{1,2})(?:\s*(?:h|:)\s*(\d{2})?|\s*(?:horas?))?\s*(da manha|da madrugada|de madrugada|da noite|da tarde|am|pm)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(t))) {
    const raw = m[0];
    const hasMarker = /h|:|hora/.test(raw.replace(m[1]!, "")) || !!m[3];
    // Número solto só vale com "às"/"as" antes (ex.: "às 2 da manhã").
    const before = t.slice(Math.max(0, m.index - 6), m.index);
    if (!hasMarker && !/\b(as|às|a partir das|por volta das|umas)\s*$/.test(before)) continue;
    let h = Number(m[1]);
    const mi = m[2] ? Number(m[2]) : 0;
    if (h > 23 || mi > 59) continue;
    const period = m[3] ?? "";
    if ((period === "da noite" || period === "pm" || period === "da tarde") && h < 12) h += 12;
    if (h < DAWN_END / 60) {
      const zeroPad = /^0\d/.test(m[1]!);
      const dawn = /manha|madrugada|am/.test(period) || /\bmadrugada\b/.test(t);
      if (!zeroPad && !dawn) continue;
    }
    return h * 60 + mi;
  }
  return null;
}

/**
 * Chegada depois da janela oficial? Limite = `checkin_time_max` do imóvel
 * (sem limite cadastrado, só a madrugada conta). Horário definido pela equipe
 * igual ou depois do informado = autorizado.
 */
export function isLateArrival(p: { arrival: number | null; checkinMax: unknown; staffTime?: unknown }): boolean {
  if (p.arrival == null) return false;
  const a = shift(p.arrival);
  const staff = hmToMin(String(p.staffTime ?? "").replace("h", ":"));
  if (staff != null && shift(staff) >= a) return false;
  const max = hmToMin(p.checkinMax);
  if (max == null) return p.arrival < DAWN_END;
  return a > shift(max);
}

/** O titular fala de OUTRAS pessoas chegando/entrando (terceira pessoa). */
export function mentionsThirdPartyArrival(text: string): boolean {
  const t = norm(text);
  return /\b(os|as|meus|minhas|nossos|nossas)?\s*(hospedes|amigos?|amigas?|pais|mae|pai|filhos?|filhas?|familiares|parentes|colegas|funcionarios|convidados|outras pessoas|outra pessoa|o pessoal|eles|elas)\s+(vao|irao|vai|ira|chegam|chegarao|chega|chegara|devem|estarao|entram|entrarao)\b/.test(
    t,
  );
}

/** Hóspede cobrando resposta ou avisando que está a caminho / no local. */
export function isGuestPressing(text: string): boolean {
  const t = norm(text);
  if (/^(ok|okay|blz|beleza|certo|obrigad[oa]|valeu|show)[.! ]*$/.test(t)) return false;
  return /(estou chegando|to chegando|estamos chegando|chegando ai|chegamos|cheguei|ja estou ai|ja estamos ai|estou aqui|estamos aqui|to aqui|na porta|no portao|na frente|em frente|a caminho|saindo agora|indo para o imovel|indo pro imovel|e ai\b|alguma resposta|ninguem responde|ninguem me responde|preciso (de uma |da )?resposta|preciso saber|aguardando (resposta|retorno)|posso ir|podemos ir|pode ser\?|\?\s*\?)/.test(
    t,
  );
}

/** Marca de presença física no local (portão, porta, "cheguei"). */
export function indicatesPhysicalPresence(text: string): boolean {
  const t = norm(text);
  return /(cheguei|chegamos|estou aqui|estamos aqui|to aqui|ja estou ai|ja estamos ai|na porta|no portao|na frente|em frente|do lado de fora|nao (consigo|estou conseguindo|to conseguindo) (entrar|abrir)|nao abre|travad|trancad)/.test(
    t,
  );
}

/** "Como acho a senha?" / "não consigo abrir o guia" sem estar no local. */
export function isPreparatoryCredentialQuestion(text: string): boolean {
  const t = norm(text);
  if (indicatesPhysicalPresence(t)) return false;
  return /\b(senha|codigo|cofre|cadeado|chave|guia( digital)?|link)\b/.test(t);
}

/** Acesso 100% autônomo: senha/código cadastrado no imóvel. */
export function isAutonomousAccess(p: Record<string, unknown>): boolean {
  const has = (v: unknown) => typeof v === "string" && v.trim() !== "";
  return has(p.gate_code) || has(p.lock_code);
}

export type ContingencyMode = "conduct" | "hold";

export function decideContingency(p: { autonomous: boolean; verified: boolean; hasCredentials: boolean }): ContingencyMode {
  return p.autonomous && p.verified && p.hasCredentials ? "conduct" : "hold";
}

export type GovernanceKind = "late_arrival" | "third_party";

export const LATE_ARRIVAL_OPTIONS = [
  "Autorizar neste horário (entrada em silêncio)",
  "Manter horário oficial",
  "Eu assumo a conversa",
] as const;
export const THIRD_PARTY_OPTIONS = [
  "Pode, sem problema",
  "Pedir identificação dos hóspedes",
  "Eu assumo a conversa",
] as const;

const fmt = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function governanceReason(kinds: GovernanceKind[], arrival: number | null, checkinMax: unknown): string {
  const parts: string[] = [];
  if (kinds.includes("late_arrival")) {
    const max = hmToMin(checkinMax);
    parts.push(
      `Chegada prevista às ${arrival != null ? fmt(arrival) : "?"}, depois do limite de check-in${max != null ? ` (${fmt(max)})` : ""}. Autoriza?`,
    );
  }
  if (kinds.includes("third_party")) parts.push("Terceiros vão chegar sem o titular, sem alinhamento prévio. Como seguir?");
  return parts.join(" ");
}

export function governanceOptions(kinds: GovernanceKind[]): string[] {
  return [...(kinds.includes("late_arrival") ? LATE_ARRIVAL_OPTIONS : THIRD_PARTY_OPTIONS)];
}

export const PREPARATORY_GUIDANCE =
  "\n\nPRESENÇA FÍSICA ANTES DO ACESSO (prioridade sobre a entrega direta de credenciais)\n" +
  "- A mensagem pergunta como achar senha/código ou fala de dificuldade com o guia, mas o hóspede NÃO disse que está no imóvel.\n" +
  "- Se ele relata problema para abrir o guia digital, ajude com isso de verdade (o link enviado pelo anfitrião, como abrir) — aqui vale falar do guia.\n" +
  "- Antes de passar o passo a passo de cofre/portão, pergunte numa frase natural se ele já está no imóvel ou a que horas pretende chegar. Se ele já informou um horário dentro da janela de hoje, pode entregar.\n" +
  "- Proibido fechar com \"nos avise quando estiver dentro\" para quem ainda não chegou.";

export function consultGuidance(kinds: GovernanceKind[]): string {
  return (
    "\n\nCHECK-IN FORA DO PADRÃO — CONSULTA OBRIGATÓRIA À EQUIPE (prioridade máxima)\n" +
    (kinds.includes("late_arrival")
      ? "- O horário de chegada informado passa do limite de check-in do imóvel e não há autorização da equipe.\n"
      : "") +
    (kinds.includes("third_party")
      ? "- O titular indica que outras pessoas vão chegar/entrar, sem ele e sem alinhamento prévio no histórico.\n"
      : "") +
    "- Você NÃO autoriza nem nega sozinha, mesmo com entrada autônoma. Chame request_human_handoff descrevendo o horário e quem chega. O sistema não envia nada ao hóspede até a equipe decidir.\n" +
    "- Nunca responda \"pode avisar quando entrarem\" ou qualquer frase que valide o pedido."
  );
}

export function contingencyGuidance(mode: ContingencyMode, alreadyHeld: boolean): string {
  const head =
    "\n\nCONTINGÊNCIA — A EQUIPE AINDA NÃO RESPONDEU SOBRE O HORÁRIO/ACESSO E O HÓSPEDE ESTÁ COBRANDO OU CHEGANDO (prioridade máxima)\n" +
    "- Não acione a equipe de novo (a consulta já está com ela).\n";
  if (mode === "conduct") {
    return (
      head +
      "- O acesso é 100% autônomo e a reserva está verificada: conduza a entrada com segurança usando SOMENTE as instruções oficiais.\n" +
      "- Na mesma mensagem, com gentileza e firmeza, deixe claro que o horário está fora da janela oficial de check-in da casa e peça entrada em silêncio total (vizinhança, garagem, portão fechado). Sem bronca, sem emoji."
    );
  }
  return (
    head +
    (alreadyHeld
      ? "- Você já avisou que está verificando. Não repita a mesma frase: acolha em uma frase curta, reafirme que retorna por aqui assim que tiver a resposta e peça mais um pouco de paciência.\n"
      : "- Responda que está verificando a possibilidade de check-in nesse horário e que retorna por aqui assim que tiver a resposta; peça com gentileza que aguarde um instante. (Exceção autorizada à regra de não prometer retorno.)\n") +
    "- NÃO envie senhas, códigos nem instruções de entrada e não autorize nem negue o horário."
  );
}

export const TEAM_DECISION_GUIDANCE =
  "\n\nENTREGA DA DECISÃO SOBRE HORÁRIO/ACESSO FORA DO PADRÃO\n" +
  "- Em UMA mensagem: advertência gentil de que o pedido foge do padrão da casa (janela oficial de check-in, silêncio da vizinhança, acesso só de hóspedes da reserva) + a decisão da equipe, aplicada com clareza.\n" +
  "- Se autorizado: conduza a entrada com as instruções oficiais e peça entrada em silêncio. Se mantido o horário oficial: informe com cordialidade o horário em que a entrada é possível.";

/** Ponte de espera determinística (rede de segurança do modo "hold"). */
export function holdBridgeText(guestName: string | null, alreadyHeld: boolean, seed: number): string {
  const fn = (guestName ?? "").trim().split(/\s+/)[0] ?? "";
  const n = fn && !/^h[oó]spede$/i.test(fn) ? `${fn.charAt(0).toUpperCase()}${fn.slice(1).toLowerCase()}` : "";
  const v = alreadyHeld
    ? [
        `${n ? `${n}, s` : "S"}eguimos verificando a possibilidade de check-in nesse horário. Assim que tivermos a resposta, retornamos por aqui. Peço só mais um pouco de paciência.`,
        `Ainda estamos confirmando esse horário${n ? `, ${n}` : ""}. Retornamos por aqui assim que tivermos a resposta; agradeço a paciência.`,
      ]
    : [
        `${n ? `${n}, e` : "E"}stamos verificando a possibilidade de check-in nesse horário. Assim que tivermos a resposta, retornamos por aqui. Peço que aguarde um instante, por favor.`,
        `Estamos confirmando a possibilidade de entrada nesse horário${n ? `, ${n}` : ""}. Retornamos por aqui assim que tivermos a resposta; aguarde só um instante, por favor.`,
      ];
  return v[seed % v.length]!;
}
