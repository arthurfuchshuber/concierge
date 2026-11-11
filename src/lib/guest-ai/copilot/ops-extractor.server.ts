/**
 * BASTIDORES · extrator dos sinais operacionais (08/11/2026).
 *
 * Por que existe: até aqui os sinais das ações nos cards (marco de entrada/saída e previsão de horário) só
 * nasciam da MESMA chamada que escreve a resposta ao hóspede. Quando essa chamada estourava o prazo (Titular
 * lento com o contexto inteiro da estadia), a leitura de "vamos sair por volta das 9:00" se perdia junto e nada
 * acontecia no card. Em produção: zero ações desde a criação da tabela de auditoria.
 *
 * Agora os bastidores são um trabalho PRÓPRIO, ligado à mesma geração mas independente dela:
 *  - modelo Reserva (`google/gemini-3.8-flash`), rápido e barato, com raciocínio `low`;
 *  - contexto mínimo: só as últimas mensagens da conversa (texto varrido pelo `SECRET_SCRUBBER`), datas da
 *    reserva, fase e "agora" no fuso do imóvel — nada de dossiê, anúncio, reviews ou credenciais;
 *  - roda em paralelo com a resposta e NÃO depende dela dar certo;
 *  - devolve só o formato que a política determinística já conhece (`hospitalityMilestone`, `milestoneQuote`,
 *    `guestEtas`). Quem decide se algo acontece continua sendo `ops/policy.ts` (evidência do hóspede no turno
 *    corrente, trecho literal, barreira léxica, datas e limites oficiais) — na dúvida, recusa.
 *
 * Nunca lança: qualquer falha (prazo, rede, JSON inválido, orçamento) vira `null` (sem sinal).
 */
import type { HistoryResult } from "@/lib/guest-ai/history";
import type { GuestEta, HospitalityMilestoneKind, ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import {
  OPS_READER_ABSTAIN_CODES,
  type OpsReaderAbstain,
  type OpsRefusalCode,
} from "@/lib/guest-ai/ops/contracts";
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import { LIMITS } from "@/lib/guest-ai/llm/contracts";
import { estimateCostUsd, modelSpec } from "@/lib/guest-ai/llm/models";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import type { LlmLogger } from "@/lib/guest-ai/llm/telemetry";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import type { StayPhase } from "@/lib/guest-ai/types";

/** Mensagens recentes enviadas ao extrator (o turno corrente do hóspede + contexto curto). */
export const OPS_EXTRACTOR_MAX_MESSAGES = 14;
/** Teto de caracteres por mensagem no extrator (mensagens operacionais são curtas). */
export const OPS_EXTRACTOR_MAX_CHARS = 700;
export const OPS_EXTRACTOR_MAX_OUTPUT_TOKENS = 700;
/** Prazo próprio do extrator (limitado ao que resta da geração). */
export const OPS_EXTRACTOR_TIMEOUT_MS = 8_000;
/** Teto de custo por extração (pior caso, conferido antes da rede). */
export const OPS_EXTRACTOR_MAX_COST_USD = 0.01;

export type OpsSignals = Pick<ModelDecision, "hospitalityMilestone" | "milestoneQuote" | "guestEtas"> & {
  /** Motivo fechado dado pelo próprio leitor quando não declarou marco (só auditoria). */
  milestoneAbstain?: OpsReaderAbstain | null;
};

/** Por que o leitor não entregou sinal (ou entregou vazio): vira o código da linha de auditoria. */
export type OpsReaderReason = Extract<OpsRefusalCode, `reader_${string}`>;
export interface OpsReading {
  signals: OpsSignals | null;
  /** Preenchido sempre que NÃO há sinal utilizável (falha, orçamento, prazo ou leitura sem marco). */
  reason: OpsReaderReason | null;
}

export interface OpsExtractorInput {
  history: HistoryResult | null;
  phase: StayPhase;
  timezone: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  now: Date;
  traceId: string;
  remainingMs: () => number;
  signal: AbortSignal;
}

export interface OpsExtractorDeps {
  provider?: LlmProvider;
  log?: LlmLogger;
  modelId?: string;
}

export const OPS_EXTRACTOR_SYSTEM = [
  "Você lê a conversa entre o hóspede e a equipe de uma hospedagem e extrai SOMENTE fatos operacionais ditos pelo HÓSPEDE nas mensagens marcadas como atuais (atual=true).",
  "Não escreva resposta ao hóspede. Devolva estritamente um objeto JSON com as chaves hospitalityMilestone, milestoneQuote, milestoneAbstain e guestEtas.",
  "Trechos '[segredo removido]' são códigos ocultados por segurança: leia o diálogo normalmente (quem digitou, quem explicou, se funcionou).",
  "ACESSO DESTRAVADO = ENTRADA: quando as mensagens anteriores mostram suporte de acesso (senha, código, cadeado, cofre, chave, porta) e o hóspede relata, como fato já consumado, que destravou ('agora consegui', 'abriu', 'deu certo', 'já peguei a chave'), isso é checkin_confirmed (copie o trecho literal do hóspede). Relato de que ainda NÃO funciona, pergunta ou plano não é marco.",
  "hospitalityMilestone: só quando o hóspede afirma, como fato já consumado, que ENTROU no imóvel (kind checkin_confirmed: 'já entramos', 'chegamos e estamos no apartamento') ou que SAIU (kind checkout_confirmed: 'já saímos', 'deixamos as chaves', 'check-out feito'). Pergunta, plano, previsão ou intenção ('vamos sair às 9', 'onde deixo a chave?') NÃO é marco. Formato: {\"kind\": \"checkin_confirmed\"|\"checkout_confirmed\", \"evidence\": [ids das mensagens atuais do hóspede]} ou null.",
  "milestoneQuote: com marco, copie o trecho LITERAL (exatamente como escrito) da mensagem do hóspede que confirma; sem marco, null.",
  "guestEtas: previsões de horário que o próprio hóspede informou nas mensagens atuais — chegada ao imóvel (card checkin) ou saída do imóvel (card checkout), no máximo uma por card. Cada item: {\"card\": \"checkin\"|\"checkout\", \"date\": \"AAAA-MM-DD\" (data no fuso do imóvel a que o horário se refere; normalmente a data de entrada ou de saída da reserva), \"time\": \"HH:MM\" (24 h), \"evidence\": [ids], \"quote\": \"trecho literal com o horário\"}.",
  "Use o horário de chegada/saída do imóvel, nunca o do voo. 'Por volta das 9', 'umas 9h' = 09:00. Chegada entre 00:00 e 04:59 pertence à noite da data de entrada. Sem horário explícito (só 'de manhã', 'cedo'), não declare previsão.",
  "milestoneAbstain: quando hospitalityMilestone for null, diga por quê com UM código: 'not_entry' (o hóspede falou de outra coisa que não entrada/saída), 'question_or_plan' (pergunta, plano ou intenção), 'access_unresolved' (acesso ainda com problema), 'context_unclear' (não dá para ter certeza do que a frase significa) ou 'no_fact' (nada operacional). Com marco, null.",
  "Na dúvida, não declare nada: hospitalityMilestone null, milestoneQuote null, guestEtas [] e milestoneAbstain com o motivo. Nunca invente ids, datas ou trechos.",
].join("\n");

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function localParts(at: Date, timeZone: string): { date: string; time: string } | null {
  try {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const g = (t: string) => f.find((p) => p.type === t)?.value ?? "";
    return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
  } catch {
    return null;
  }
}

function localDateOf(iso: string | null, timeZone: string | null): string | null {
  if (!iso || !timeZone) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return localParts(d, timeZone)?.date ?? null;
}

const SPEAKER_LABEL: Record<string, string> = { guest: "hospede", team: "equipe", legacy_ai: "equipe", system: "sistema" };

/** Monta a entrada mínima do extrator; `null` quando não há turno do hóspede para ler. */
export function buildOpsExtractorInput(input: OpsExtractorInput): { user: string; currentRefs: string[] } | null {
  const h = input.history;
  if (!h || h.status !== "available" || h.entries.length === 0) return null;
  const tz = input.timezone;
  if (!tz) return null;
  // turno corrente do hóspede = mensagens do hóspede no fim do histórico (mesma regra de `ops/policy.ts`)
  const currentRefs: string[] = [];
  for (let i = h.entries.length - 1; i >= 0; i -= 1) {
    const e = h.entries[i]!;
    if (e.speaker !== "guest") break;
    currentRefs.unshift(e.ref);
  }
  if (currentRefs.length === 0) return null;
  const current = new Set(currentRefs);
  const recent = h.entries.slice(-Math.max(OPS_EXTRACTOR_MAX_MESSAGES, currentRefs.length));
  const messages = recent.map((e, i) => {
    // O leitor NUNCA perde uma mensagem inteira por causa de um número ou código: o varredor já devolve o texto
    // com só o segredo trocado por "[segredo removido]" (também no `ambiguous`, removido por precaução), e o
    // diálogo ao redor ("digitei … no cadeado", "agora consegui") fica intacto. Só `blocked` (chave privada ou
    // excesso de segredos) retém a mensagem inteira. A mensagem anterior entra como dica para o valor dividido.
    const previous = i > 0 ? (recent[i - 1]!.text ?? "") : undefined;
    const scan = SECRET_SCRUBBER.scan(e.text ?? "", previous === undefined ? {} : { previous });
    const text =
      scan.status === "blocked" ? "[mensagem omitida]" : scan.text.slice(0, OPS_EXTRACTOR_MAX_CHARS);
    const at = new Date(e.at);
    return {
      id: e.ref,
      falante: SPEAKER_LABEL[e.speaker] ?? "desconhecido",
      quando: Number.isNaN(at.getTime()) ? null : (() => {
        const p = localParts(at, tz);
        return p ? `${p.date} ${p.time}` : null;
      })(),
      atual: current.has(e.ref),
      texto: text,
    };
  });
  const now = localParts(input.now, tz);
  const payload = {
    fuso_do_imovel: tz,
    agora_no_imovel: now ? `${now.date} ${now.time}` : null,
    fase_da_estadia: input.phase,
    data_de_entrada: localDateOf(input.checkInAt, tz),
    data_de_saida: localDateOf(input.checkOutAt, tz),
    mensagens: messages,
  };
  return { user: `Extraia os fatos operacionais em JSON.\n${JSON.stringify(payload)}`, currentRefs };
}

/** Valida a saída do modelo e devolve só sinais bem formados que citam mensagens atuais do hóspede. */
export function parseOpsSignals(value: unknown, currentRefs: readonly string[]): OpsSignals {
  const empty: OpsSignals = { hospitalityMilestone: null, milestoneQuote: null, guestEtas: [], milestoneAbstain: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const v = value as Record<string, unknown>;
  const cur = new Set(currentRefs);
  const refs = (x: unknown): string[] | null => {
    if (!Array.isArray(x) || x.length === 0) return null;
    const out = x.filter((r): r is string => typeof r === "string" && cur.has(r));
    return out.length === x.length ? [...new Set(out)] : null;
  };
  let hospitalityMilestone: OpsSignals["hospitalityMilestone"] = null;
  let milestoneQuote: string | null = null;
  const m = v.hospitalityMilestone as Record<string, unknown> | null | undefined;
  const q = typeof v.milestoneQuote === "string" ? v.milestoneQuote.trim() : "";
  if (m && typeof m === "object" && (m.kind === "checkin_confirmed" || m.kind === "checkout_confirmed")) {
    const ev = refs(m.evidence);
    if (ev && q) {
      hospitalityMilestone = { kind: m.kind as HospitalityMilestoneKind, evidence: ev };
      milestoneQuote = q.slice(0, 300);
    }
  }
  const etas: GuestEta[] = [];
  const seen = new Set<string>();
  if (Array.isArray(v.guestEtas)) {
    for (const raw of v.guestEtas) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      const card = e.card === "checkin" || e.card === "checkout" ? e.card : null;
      const ev = refs(e.evidence);
      const quote = typeof e.quote === "string" ? e.quote.trim() : "";
      if (!card || seen.has(card) || !ev || !quote) continue;
      if (typeof e.date !== "string" || !DATE.test(e.date)) continue;
      if (typeof e.time !== "string" || !TIME.test(e.time)) continue;
      seen.add(card);
      etas.push({ card, date: e.date, time: e.time, evidence: ev, quote: quote.slice(0, 300) });
    }
  }
  const ab = (OPS_READER_ABSTAIN_CODES as readonly unknown[]).includes(v.milestoneAbstain)
    ? (v.milestoneAbstain as OpsReaderAbstain)
    : null;
  return { hospitalityMilestone, milestoneQuote, guestEtas: etas, milestoneAbstain: hospitalityMilestone ? null : ab };
}

/** Código de auditoria da leitura sem sinal: o motivo do próprio leitor, ou o genérico. */
export function readerReasonFor(s: OpsSignals): OpsReaderReason {
  return s.milestoneAbstain ? (`reader_abstain_${s.milestoneAbstain}` as OpsReaderReason) : "reader_no_signal";
}

export const hasOpsSignal = (s: OpsSignals | null): boolean =>
  !!s && (!!s.hospitalityMilestone || (s.guestEtas ?? []).length > 0);

/**
 * Extrai os sinais operacionais do turno corrente e diz POR QUE não houve sinal (auditoria). Nunca lança.
 * O prazo da chamada é o menor entre o do extrator (8 s), o que resta da geração e o teto do Gateway.
 */
export async function readOpsSignals(
  input: OpsExtractorInput,
  deps: OpsExtractorDeps = {},
): Promise<OpsReading> {
  const none = (reason: OpsReaderReason): OpsReading => ({ signals: null, reason });
  try {
    if (!input.history || input.history.status !== "available" || input.history.entries.length === 0)
      return none("reader_no_history");
    if (!input.timezone) return none("reader_no_timezone");
    const built = buildOpsExtractorInput(input);
    if (!built) return none("reader_no_history");
    const modelId = deps.modelId ?? GUEST_AI_RESERVE_MODEL;
    const spec = modelSpec(modelId);
    if (!spec) return none("reader_budget");
    const inputTokens = new TextEncoder().encode(OPS_EXTRACTOR_SYSTEM + built.user).length + 200;
    if (estimateCostUsd(spec, inputTokens, OPS_EXTRACTOR_MAX_OUTPUT_TOKENS) > OPS_EXTRACTOR_MAX_COST_USD)
      return none("reader_budget");
    const timeoutMs = opsExtractorTimeoutMs(input.remainingMs());
    if (timeoutMs < 1_500 || input.signal.aborted) return none("reader_deadline");
    const r = await generateGuestLlm(
      {
        purpose: "guest_classification",
        model: modelId,
        messages: [
          { role: "system", content: OPS_EXTRACTOR_SYSTEM },
          { role: "user", content: built.user },
        ],
        maxOutputTokens: OPS_EXTRACTOR_MAX_OUTPUT_TOKENS,
        reasoningEffort: "low",
        responseFormat: "json",
        timeoutMs,
        signal: input.signal,
        traceId: input.traceId,
      },
      { provider: deps.provider, log: deps.log },
    );
    if (!r.ok) {
      const code = r.error.code;
      return none(
        code === "timeout"
          ? "reader_timeout"
          : code === "aborted"
            ? "reader_deadline"
            : code === "truncated_response"
              ? "reader_truncated"
              : code === "invalid_response" || code === "empty_response"
                ? "reader_invalid_output"
                : "reader_model_failed",
      );
    }
    if (r.finishReason !== "stop") return none("reader_truncated");
    if (!r.json || typeof r.json !== "object" || Array.isArray(r.json)) return none("reader_invalid_output");
    const signals = parseOpsSignals(r.json, built.currentRefs);
    return { signals, reason: hasOpsSignal(signals) ? null : readerReasonFor(signals) };
  } catch {
    return none("reader_model_failed");
  }
}

/** Compatível com o contrato antigo: só os sinais; falha ⇒ `null`. */
export async function extractOpsSignals(
  input: OpsExtractorInput,
  deps: OpsExtractorDeps = {},
): Promise<OpsSignals | null> {
  return (await readOpsSignals(input, deps)).signals;
}

/** Prazo da leitura: nunca acima do próprio teto do extrator, do que resta da geração nem do teto do Gateway. */
export function opsExtractorTimeoutMs(remainingMs: number): number {
  return Math.min(OPS_EXTRACTOR_TIMEOUT_MS, Math.floor(remainingMs), LIMITS.maxTimeoutMs);
}
