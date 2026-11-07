/**
 * GATE G2c · LATE CHECKOUT CONCEDIDO PELA EQUIPE NO CHAT (puro: sem banco, rede nem relógio).
 *
 * Diretriz definitiva (06/11/2026, item 3): quando um atendente HUMANO da equipe concede expressamente, na
 * conversa, um horário de saída depois do oficial ("combinado, pode sair às 13h", "autorizado o checkout até
 * 14h00"), a IA registra esse late checkout no card de saída — com autoria do próprio atendente
 * (`internal_set_late_checkout`; o banco confere se ele pode autorizar). Pedido ou pergunta do hóspede NUNCA
 * é autorização: só mensagens da equipe (`speaker = team`, `role=assistant` + `sender_type=human`, sem nota
 * interna) são lidas aqui; a IA antiga/legada e o sistema não contam.
 *
 * Detecção conservadora, por frase da mensagem MAIS RECENTE da equipe que fala de saída (a palavra mais nova
 * da equipe sobre o assunto é a que vale: uma recusa posterior anula a concessão anterior):
 *  1. candidata: contexto de saída + UM horário depois do oficial do imóvel (senão, nada — nem auditoria);
 *  2. concessão: marca afirmativa explícita; recusa ⇒ negação, pergunta, condição/adiamento ("vou ver",
 *     "confirmo depois") ou cobrança pendente (taxa, valor, pagamento: negociação fica com a equipe);
 *  3. mais de um horário na frase ⇒ ambíguo ⇒ recusa.
 */
import { parseHm } from "../policy/wall-clock";
import type { OpsRefusalCode } from "./contracts";
import { normalizeText } from "./lexical";

/** Entrada mínima do histórico (mesma forma usada pela política). */
export interface LateCheckoutHistoryEntry {
  messageId: string;
  speaker: string;
  text: string;
  /** Instante ISO da mensagem. */
  at: string;
}

/** Janela em que uma concessão da equipe ainda é considerada (antes do instante atual). */
export const LATE_CHECKOUT_LOOKBACK_MS = 72 * 3600 * 1000;

export type StaffLateCheckout =
  | { status: "granted"; messageId: string; at: string; time: string }
  | { status: "refused"; messageId: string; at: string; time: string | null; code: OpsRefusalCode };

const W = (words: string[]) => new RegExp(`(?:^|[^a-z0-9'])(?:${words.join("|")})(?=$|[^a-z0-9'])`);

const CHECKOUT_CONTEXT = W([
  "check-?out",
  "checkout",
  "late",
  "saida",
  "sair",
  "sai",
  "saindo",
  "desocupar",
  "entregar (?:as )?chaves",
  "ficar ate",
  "permanecer",
  "leave",
  "check out",
  "stay until",
  "salida",
  "salir",
]);
const GRANT = W([
  "pode(?:m)? (?:sair|ficar|fazer o check-?out|desocupar|permanecer|entregar)",
  "podera(?:o)? (?:sair|ficar|permanecer)",
  "autorizad[oa]s?",
  "liberad[oa]s?",
  "aprovad[oa]s?",
  "confirmad[oa]s?",
  "combinado",
  "fechado",
  "tudo certo",
  "sem problemas?",
  "pode sim",
  "claro",
  "you can (?:leave|stay|check out|checkout)",
  "approved",
  "confirmed",
  "no problem",
  "puede(?:n)? (?:salir|quedarse)",
  "autorizado",
]);
const NEGATION = W([
  "nao",
  "nem",
  "infelizmente",
  "impossivel",
  "indisponivel",
  "nunca",
  "not",
  "[a-z]+n't",
  "cannot",
  "unfortunately",
  "sorry",
  "lamentavelmente",
  "desculpe",
]);
const DEFER = W([
  "se",
  "caso",
  "vou (?:ver|verificar|confirmar|checar|consultar)",
  "vamos (?:ver|verificar|confirmar|checar)",
  "verific[a-z]*",
  "aguard[a-z]*",
  "depende",
  "talvez",
  "consult[a-z]*",
  "retorno",
  "te aviso",
  "confirmo",
  "a confirmar",
  "if",
  "let me check",
  "will check",
  "maybe",
  "depending",
]);
const FEE = W([
  "taxa",
  "cobranca",
  "cobrar",
  "valor",
  "r\\$",
  "reais",
  "pagamento",
  "pagar",
  "pix",
  "fee",
  "charge",
  "pay",
  "usd",
  "\\$",
]);

/** Horários citados na frase, em HH:MM 24 h (aceita 13h, 13h30, 13:30, 1pm, 1:30 pm). */
export function timesIn(sentence: string): string[] {
  const out = new Set<string>();
  const t = sentence;
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const m of t.matchAll(/(?:^|[^0-9])(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=$|[^a-z])/g)) {
    let h = Number(m[1]);
    const mi = Number(m[2] ?? "0");
    if (h < 1 || h > 12 || mi > 59) continue;
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    out.add(`${pad(h)}:${pad(mi)}`);
  }
  const stripped = t.replace(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=$|[^a-z])/g, " ");
  for (const m of stripped.matchAll(
    /(?:^|[^0-9:])(\d{1,2})\s*(?:h|:|hs|horas?)\s*(\d{2})?(?=$|[^0-9])/g,
  )) {
    const h = Number(m[1]);
    const mi = Number(m[2] ?? "0");
    if (h > 23 || mi > 59) continue;
    out.add(`${pad(h)}:${pad(mi)}`);
  }
  return [...out];
}

const minutes = (hm: string): number | null => {
  const p = parseHm(hm);
  return p ? p[0] * 60 + p[1] : null;
};

function sentences(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const c of normalizeText(text)) {
    cur += c;
    if (c === "." || c === "!" || c === "?" || c === ";" || c === "\n") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  // "13.30"/"1.30pm" não podem quebrar a frase: junta pedaço que termina em dígito + ponto com o próximo
  const merged: string[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev && /\d\.$/.test(prev) && /^\d/.test(s)) merged[merged.length - 1] = `${prev}${s}`;
    else merged.push(s);
  }
  return merged.map((s) => s.replace(/(\d)\.(\d{2})/g, "$1:$2"));
}

/**
 * Concessão de late checkout pela equipe no histórico recente. `null` = nada a fazer (sem mensagem da
 * equipe sobre saída na janela, ou a mais recente não cita horário depois do oficial).
 */
export function detectStaffLateCheckout(
  history: readonly LateCheckoutHistoryEntry[],
  opts: { officialCheckout: string | null; now: Date },
): StaffLateCheckout | null {
  const official = opts.officialCheckout ? minutes(opts.officialCheckout) : null;
  if (official === null) return null;
  const since = opts.now.getTime() - LATE_CHECKOUT_LOOKBACK_MS;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const e = history[i]!;
    if (e.speaker !== "team") continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || at < since || at > opts.now.getTime()) {
      if (Number.isFinite(at) && at < since) return null; // histórico em ordem: daqui para trás é antigo
      continue;
    }
    const about = sentences(e.text).filter((s) => CHECKOUT_CONTEXT.test(s));
    if (about.length === 0) continue; // mensagem da equipe sobre outro assunto
    // a palavra mais nova da equipe sobre saída é a que vale
    const late = about
      .map((s) => ({ s, times: timesIn(s).filter((t) => (minutes(t) ?? -1) > official) }))
      .filter((x) => x.times.length > 0);
    if (late.length === 0) {
      // a equipe falou de saída sem conceder horário depois do oficial: só é sinal se for recusa explícita
      return null;
    }
    const base = { messageId: e.messageId, at: e.at };
    const allTimes = new Set(late.flatMap((x) => x.times));
    if (late.length > 1 || allTimes.size > 1)
      return { status: "refused", ...base, time: null, code: "staff_grant_ambiguous" };
    const { s, times } = late[0]!;
    const time = times[0]!;
    const refuse = (code: OpsRefusalCode): StaffLateCheckout => ({
      status: "refused",
      ...base,
      time,
      code,
    });
    if (timesIn(s).length > 1) return refuse("staff_grant_ambiguous");
    if (s.includes("?")) return refuse("lexical_question");
    if (NEGATION.test(s)) return refuse("lexical_negation");
    if (DEFER.test(s)) return refuse("lexical_conditional");
    if (FEE.test(s)) return refuse("problem_or_negotiation");
    if (!GRANT.test(s)) return refuse("staff_grant_not_explicit");
    return { status: "granted", ...base, time };
  }
  return null;
}
