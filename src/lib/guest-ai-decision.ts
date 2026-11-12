/**
 * DECISÃO HUMANA COM 1 CLIQUE (10/11/2026, mockup e SQL aprovados pelo titular) — parte PURA, compartilhada
 * entre servidor e tela. Nada aqui lê banco ou chama modelo.
 *
 * Fluxo: o hóspede pede uma exceção (late check-out, entrada antecipada, concessão operacional) → a IA NÃO
 * responde (sem frase de espera) → abre UMA decisão pendente (`guest_ai_human_decisions`) com pergunta curta e
 * 2–4 botões → a equipe clica → a ação oficial roda e a IA manda UMA resposta ao hóspede (salvo "Eu assumo").
 * Enquanto houver decisão pendente na conversa, a IA fica em silêncio absoluto (slot).
 */

export const DECISION_KINDS = ["late_checkout", "early_checkin", "operational_concession", "general_decision"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export type DecisionVariant = "primary" | "secondary" | "neutral" | "assume";
export type DecisionIntent = "approve" | "charge" | "decline" | "assume";

export interface DecisionOption {
  id: string;
  label: string;
  variant: DecisionVariant;
  ai_intent: DecisionIntent;
  /** Horário concedido (HH:MM), só na aprovação de late check-out / entrada antecipada com horário pedido. */
  time?: string;
}

export type DecisionStatus = "pending" | "decided" | "expired";
export type DecisionReplyStatus = "pending" | "sent" | "silent" | "error";

/** Linha como a tela a lê (projeção explícita). */
export interface HumanDecisionRow {
  id: string;
  property_id: string;
  conversation_id: string;
  trigger_message_id: string;
  kind: DecisionKind;
  question_text: string;
  options: DecisionOption[];
  status: DecisionStatus;
  decided_option_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  ai_reply_status: DecisionReplyStatus;
  ai_reply_message_id: string | null;
  created_at: string;
}

export const DECISION_COLUMNS =
  "id, property_id, conversation_id, trigger_message_id, kind, question_text, options, status, decided_option_id, decided_by, decided_at, ai_reply_status, ai_reply_message_id, created_at";

/** Nome curto do tipo, no cabeçalho do cartão. */
export const DECISION_KIND_LABEL: Record<DecisionKind, string> = {
  late_checkout: "Late check-out",
  early_checkin: "Entrada antecipada",
  operational_concession: "Concessão",
  general_decision: "Decisão",
};

/** Prefixo do motivo do chamado (a bolha mostra "Decisão pendente" em vez de "Precisa de atendimento"). */
export const DECISION_HANDOFF_PREFIX = "Decisão pendente";
export const isDecisionHandoffReason = (reason: string | null | undefined): boolean =>
  (reason ?? "").startsWith(DECISION_HANDOFF_PREFIX);

/**
 * Pedido formal declarado pelo modelo ⇒ tipo de decisão. Só exceções que a EQUIPE concede no dia a dia; datas,
 * hóspedes, preço e cancelamento dependem da plataforma e seguem o encaminhamento normal.
 */
export function decisionKindFromRequests(requests: readonly string[] | null | undefined): DecisionKind | null {
  const r = new Set(requests ?? []);
  if (r.has("late_checkout")) return "late_checkout";
  if (r.has("early_checkin")) return "early_checkin";
  if (r.has("other_conditions")) return "operational_concession";
  return null;
}

/** "13h", "13h30", "13:00", "às 1pm", "1:30 pm" ⇒ "HH:MM"; nada reconhecível ⇒ null. */
export function extractRequestedTime(text: string | null | undefined): string | null {
  const t = (text ?? "").toLowerCase();
  const ampm = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/.exec(t);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3] === "pm") h += 12;
    return `${String(h).padStart(2, "0")}:${ampm[2] ?? "00"}`;
  }
  const m = /\b([01]?\d|2[0-3])\s*(?:h|:|hs\b|horas?\b)\s*([0-5]\d)?/.exec(t);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2] ?? "00"}`;
}

/** "13:00" ⇒ "13h"; "13:30" ⇒ "13h30". */
export function formatHour(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return hhmm ?? "";
  return m[2] === "00" ? `${Number(m[1])}h` : `${Number(m[1])}h${m[2]}`;
}

/** Botões do cartão por tipo (2–4; rótulos curtos que cabem numa linha a 360px). */
export function buildDecisionOptions(kind: DecisionKind, time: string | null): DecisionOption[] {
  const assume: DecisionOption = { id: "assume", label: "Eu assumo a conversa", variant: "assume", ai_intent: "assume" };
  const decline: DecisionOption = { id: "decline", label: "Recusar com gentileza", variant: "neutral", ai_intent: "decline" };
  if (kind === "late_checkout" || kind === "early_checkin") {
    const approve: DecisionOption = time
      ? { id: "approve", label: `Aprovar ${formatHour(time)} (cortesia)`, variant: "primary", ai_intent: "approve", time }
      : { id: "approve", label: "Aprovar (cortesia)", variant: "primary", ai_intent: "approve" };
    return [approve, { id: "charge", label: "Cobrar meia diária", variant: "secondary", ai_intent: "charge" }, decline, assume];
  }
  return [{ id: "approve", label: "Aprovar", variant: "primary", ai_intent: "approve" }, decline, assume];
}

const words = (s: string) => s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
/** Corta em N palavras (com reticências quando cortou). */
export function clipWords(s: string, n: number): string {
  const w = words(s);
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")}…`;
}

export interface QuestionInput {
  kind: DecisionKind;
  guestName: string | null;
  time: string | null;
  officialCheckout: string | null;
  officialCheckin: string | null;
  /** `true`/`false` quando se sabe se há entrada no mesmo dia da saída; `null` = desconhecido. */
  sameDayArrival: boolean | null;
  /** `true`/`false` quando se sabe se outro hóspede sai no dia da entrada; `null`/ausente = desconhecido. */
  sameDayDeparture?: boolean | null;
  /** Pergunta interna do modelo (quando houver) e a mensagem do hóspede, só para concessões. */
  internalQuestion: string | null;
  guestMessage: string | null;
  /** Rajada (pedidos distintos do hóspede): quando os dois existem, o cartão lista ambos sem mesclar. */
  late?: ExceptionRequest | null;
  early?: ExceptionRequest | null;
  /** Chegada depois do limite de check-in (recepção tardia) e o limite oficial do imóvel. */
  lateArrival?: ExceptionRequest | null;
  officialCheckinMax?: string | null;
}

/** Pergunta curta (~35 palavras, nunca mais de 45) para a equipe decidir. */
export function buildDecisionQuestion(q: QuestionInput): string {
  const who = (q.guestName ?? "").trim().split(/\s+/)[0] || "O hóspede";
  let s: string;
  if (q.late && q.early) {
    const out = `${describeRequest("late_checkout", q.late)}${q.officialCheckout ? ` (oficial ${formatHour(q.officialCheckout)})` : ""}`;
    const inn = `${describeRequest("early_checkin", q.early)}${q.officialCheckin ? ` (oficial ${formatHour(q.officialCheckin)})` : ""}`;
    const notes = [
      q.sameDayDeparture === true ? "Há saída de outro hóspede no dia da entrada (depende da higienização)." : "",
      q.sameDayArrival === true ? "Há entrada de outro hóspede no dia da saída." : "",
    ].filter(Boolean).join(" ");
    s = `${who} pede ${inn} e ${out}.${notes ? ` ${notes}` : ""} Aprovar os dois como cortesia?`;
  } else if (q.kind === "operational_concession" && q.lateArrival) {
    const when = q.lateArrival.time ? `por volta das ${formatHour(q.lateArrival.time)}` : "depois do horário";
    const limit = q.officialCheckinMax ? ` (check-in até ${formatHour(q.officialCheckinMax)})` : "";
    s = `${who} avisa que vai chegar ${when}${limit}. Viabilizar a recepção tardia?`;
  } else if (q.kind === "late_checkout") {
    const official = q.officialCheckout ? ` (oficial ${formatHour(q.officialCheckout)})` : "";
    const when = q.time
      ? `${describeRequest("late_checkout", { time: q.time, day: q.late?.day ?? null })}${official}`
      : `sair mais tarde${official}, sem horário definido`;
    const day =
      q.sameDayArrival === false ? " Não há entrada no mesmo dia." : q.sameDayArrival === true ? " Há entrada no mesmo dia." : "";
    s = `${who} pede ${when}.${day} Aprovar como cortesia?`;
  } else if (q.kind === "early_checkin") {
    const official = q.officialCheckin ? ` (oficial ${formatHour(q.officialCheckin)})` : "";
    const when = q.time
      ? `${describeRequest("early_checkin", { time: q.time, day: q.early?.day ?? null })}${official}`
      : `entrar mais cedo${official}, sem horário definido`;
    const day =
      q.sameDayDeparture === true
        ? " Há saída de outro hóspede no mesmo dia: a entrada depende da higienização."
        : q.sameDayDeparture === false
          ? " Não há saída no mesmo dia."
          : "";
    s = `${who} pede ${when}.${day} Aprovar como cortesia?`;
  } else {
    const base = (q.internalQuestion ?? "").trim();
    s = base
      ? base
      : `${who} pede uma exceção: "${clipWords(q.guestMessage ?? "", 22)}". Como responder?`;
  }
  return clipWords(s, 45);
}

/** Resumo do motivo do chamado (bolha e lista). */
export function decisionHandoffReason(kind: DecisionKind, time: string | null): string {
  const t = time ? ` às ${formatHour(time)}` : "";
  const what =
    kind === "late_checkout" ? `late check-out${t}` : kind === "early_checkin" ? `entrada antecipada${t}` : "pedido de exceção";
  return `${DECISION_HANDOFF_PREFIX} · ${what}`;
}

/** Carimbo do estado decidido ("Late check-out aprovado · 13h", "Arthur assumiu a conversa"…). */
export function decidedHeadline(row: Pick<HumanDecisionRow, "kind" | "options" | "decided_option_id">, who: string): string {
  const opt = row.options.find((o) => o.id === row.decided_option_id);
  if (!opt) return "Decisão registrada";
  const subject = DECISION_KIND_LABEL[row.kind];
  if (opt.ai_intent === "assume") return `${who} assumiu a conversa`;
  if (opt.ai_intent === "approve") return `${subject} aprovado${opt.time ? ` · ${formatHour(opt.time)}` : ""}`;
  if (opt.ai_intent === "charge") return `${subject} com cobrança de meia diária`;
  return `${subject} recusado com gentileza`;
}


// ─────────────────────── Rajada de mensagens (extração determinística) ───────────────────────

export interface ExceptionRequest {
  /** "HH:MM" pedido pelo hóspede; `null` = sem horário definido. */
  time: string | null;
  /** Dia do mês citado ("dia 23" ⇒ 23); `null` = não citado. */
  day: number | null;
}

export interface BurstRequests {
  late: ExceptionRequest | null;
  early: ExceptionRequest | null;
  /**
   * Chegada DEPOIS do limite de check-in do imóvel (caso Ary, 11/11/2026: "iremos chegar após as 23"). Nunca é
   * entrada antecipada; vira concessão operacional (recepção tardia) para a equipe decidir.
   */
  lateArrival?: ExceptionRequest | null;
  /** Alguma chegada com horário DENTRO da janela oficial (previsão normal, não exceção). */
  arrivalInWindow?: boolean;
}

/** Horários oficiais do imóvel usados para classificar o pedido (todos opcionais, "HH:MM"). */
export interface OfficialTimes {
  officialCheckin?: string | null;
  officialCheckinMax?: string | null;
  officialCheckout?: string | null;
}

const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const LATE_CUE = /\b(sair|saida|saio|saindo|sairmos|saimos|deixar o|check[\s-]?out|late check|ficar ate|ficar mais)/;
const EARLY_CUE = /\b(entrar|entrada|entro|entrando|entramos|chegar|chego|chegando|chegamos|check[\s-]?in|early check)/;
/** Pedido explícito de flexibilidade, mesmo sem horário. */
const FLEX_CUE = /(mais cedo|mais tarde|antecipad|adiantar|estender|prorrog|late check|early check|\b(as|a partir das|ate as|por volta das)\s+\d)/;

function clauses(text: string): string[] {
  return fold(text)
    .split(/[.;!?\n]+|\s+(?:e tambem|e|mas|alem disso)\s+(?=(?:para\s+|poder\s+|se\s+)?(?:entrar|sair|chegar|saida|entrada|check))/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** "dia 23" ⇒ 23. */
export function extractRequestedDay(text: string | null | undefined): number | null {
  const m = /\bdia\s+(0?[1-9]|[12]\d|3[01])\b/.exec(fold(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** Hora citada numa oração de chegada/saída, mesmo sem "h" ("após as 23", "por volta da meia-noite"). */
function clauseTime(c: string): string | null {
  const t = extractRequestedTime(c);
  if (t) return t;
  if (/\bmeia[\s-]?noite\b/.test(c)) return "00:00";
  const m = /\b(?:as|das|a partir das|depois das|apos as|apos|por volta das|ate as|umas)\s+([01]?\d|2[0-3])\b(?!\s*(?:dias?|noites?|pessoas?|hospedes?|\/))/.exec(c);
  return m ? `${String(Number(m[1])).padStart(2, "0")}:00` : null;
}
const minutes = (hhmm: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** Madrugada (00:00–04:59) é a noite da chegada: depois de qualquer limite noturno. */
const nightMinutes = (hhmm: string | null | undefined): number | null => {
  const v = minutes(hhmm);
  return v === null ? null : v < 5 * 60 ? v + 24 * 60 : v;
};
/** Sinais de chegada DEPOIS (atraso, madrugada, "após as 23"): nunca é entrada antecipada. */
const LATE_ARRIVAL_CUE = /\b(apos|depois d[ae]s?|mais tarde|atras\w*|madrugada|meia[\s-]?noite|tarde da noite)\b/;
/** Pedido explícito de chegar ANTES. */
const EARLY_WORDS = /(mais cedo|antecipad|adiantar|antes d[ao]s?|early check)/;

/**
 * Pedidos de saída tardia / entrada antecipada / chegada tardia em UMA mensagem. `strict` (fallback sem modelo)
 * só aceita oração com horário ou pedido explícito de flexibilidade ("check-in às 15h?" de dúvida simples não abre
 * decisão). Com os horários oficiais (diretiva de 11/11/2026, caso Ary): chegada no horário de check-in ou depois
 * dele NUNCA é entrada antecipada; depois do limite (`officialCheckinMax`) ou na madrugada é chegada tardia; saída
 * até o horário oficial de check-out não é saída tardia. Sem horários oficiais, entrada antecipada só com pedido
 * explícito de chegar antes (mais cedo, antecipar).
 */
export function parseExceptionRequests(text: string | null | undefined, opts: { strict?: boolean } & OfficialTimes = {}): BurstRequests {
  const out: BurstRequests = { late: null, early: null }; // lateArrival/arrivalInWindow só quando existem
  const cin = minutes(opts.officialCheckin);
  const cinMax = nightMinutes(opts.officialCheckinMax);
  const cout = minutes(opts.officialCheckout);
  for (const c of clauses(text ?? "")) {
    const isLate = LATE_CUE.test(c);
    const isEarly = EARLY_CUE.test(c);
    if (!isLate && !isEarly) continue;
    const time = clauseTime(c);
    const lateArrivalCue = LATE_ARRIVAL_CUE.test(c);
    if (opts.strict && !time && !FLEX_CUE.test(c) && !lateArrivalCue) continue;
    const req: ExceptionRequest = { time, day: extractRequestedDay(c) };
    // oração com os dois sinais: o verbo mais próximo do início manda (ex.: "para sair às 16h" ⇒ saída)
    const lateAt = isLate ? c.search(LATE_CUE) : Infinity;
    const earlyAt = isEarly ? c.search(EARLY_CUE) : Infinity;
    if (lateAt <= earlyAt) {
      const t = minutes(time);
      if (t !== null && cout !== null && t <= cout && !FLEX_CUE.test(c.replace(/\d/g, ""))) continue; // dentro do horário
      out.late = { time: req.time ?? out.late?.time ?? null, day: req.day ?? out.late?.day ?? null };
      continue;
    }
    // CHEGADA: antes do check-in = antecipada; depois do limite (ou madrugada/atraso) = chegada tardia
    const t = nightMinutes(time);
    const explicitEarly = EARLY_WORDS.test(c) && !lateArrivalCue;
    const afterWord = /\b(apos|depois d[ae]s?)\b/.test(c); // "após as 23" = depois das 23
    const afterLimit = t !== null && cinMax !== null && (t > cinMax || (afterWord && t >= cinMax));
    const markLate = () => (out.lateArrival = { time: req.time ?? out.lateArrival?.time ?? null, day: req.day ?? out.lateArrival?.day ?? null });
    if (afterLimit) {
      markLate();
      continue;
    }
    if (lateArrivalCue && !explicitEarly) {
      if (cinMax === null) markLate(); // sem o limite do imóvel (fallback): quem confirma é openHumanDecision
      else if (t === null) {
        if (/\b(madrugada|meia[\s-]?noite)\b/.test(c)) markLate();
      } else out.arrivalInWindow = true; // atraso, mas ainda dentro da janela
      continue;
    }
    // sem horário oficial conhecido (fallback sem banco), chegada com horário e sem sinal de atraso ainda é
    // candidata; quem confirma com os horários do imóvel é `openHumanDecision`
    const early = explicitEarly || (t !== null && t >= 5 * 60 && (cin === null ? true : t < cin));
    if (!early) {
      if (t !== null) out.arrivalInWindow = true; // chegada dentro da janela: previsão normal, não é exceção
      continue;
    }
    out.early = { time: req.time ?? out.early?.time ?? null, day: req.day ?? out.early?.day ?? null };
  }
  return out;
}

/** Junta as mensagens da rajada (da mais antiga à mais nova): o dado mais recente de cada tipo prevalece. */
export function parseBurstRequests(messages: ReadonlyArray<string | null | undefined>, opts: { strict?: boolean } & OfficialTimes = {}): BurstRequests {
  const acc: BurstRequests = { late: null, early: null };
  const merge = (prev: ExceptionRequest | null | undefined, next: ExceptionRequest) => ({ time: next.time ?? prev?.time ?? null, day: next.day ?? prev?.day ?? null });
  for (const m of messages) {
    const r = parseExceptionRequests(m, opts);
    if (r.late) acc.late = merge(acc.late, r.late);
    if (r.early) acc.early = merge(acc.early, r.early);
    if (r.lateArrival) acc.lateArrival = merge(acc.lateArrival, r.lateArrival);
    if (r.arrivalInWindow) acc.arrivalInWindow = true;
  }
  return acc;
}

/** "saída às 16h no dia 23" / "entrada às 10h no dia 19". */
export function describeRequest(kind: "late_checkout" | "early_checkin", r: ExceptionRequest): string {
  const base = kind === "late_checkout" ? "saída" : "entrada";
  const at = r.time ? ` às ${formatHour(r.time)}` : "";
  const day = r.day ? ` no dia ${r.day}` : "";
  return `${base}${at}${day}`;
}

/** Códigos `formalChangeRequests` equivalentes à rajada (alimenta `openHumanDecision` no fallback). */
export function requestsFromBurst(b: BurstRequests): string[] {
  const r: string[] = [];
  if (b.late) r.push("late_checkout");
  if (b.early) r.push("early_checkin");
  if (b.lateArrival && !b.early) r.push("other_conditions"); // recepção tardia = concessão operacional
  return r;
}

