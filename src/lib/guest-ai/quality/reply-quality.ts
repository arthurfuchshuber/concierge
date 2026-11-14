/**
 * MEDIÇÃO DE QUALIDADE DA IA (14/11/2026). Módulo PURO: sem banco, rede ou modelo. Serve para (1) auditar respostas
 * já enviadas (histórico) e (2) pontuar o replay de conversas reais. Detecta os vícios que o titular proibiu:
 * frase pronta de SAC, terceira pessoa sobre a equipe, "registrando internamente", promessa de prazo, tag crua,
 * credencial em texto, cumprimento repetido e excesso de exclamação. NÃO decide nada em produção.
 */
export type IssueCode =
  | "sac_phrase"
  | "third_person_team"
  | "internal_registration"
  | "time_promise"
  | "raw_tag"
  | "digits_secret_like"
  | "generic_opener"
  | "too_many_exclamations"
  | "too_long"
  | "empty";

const norm = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const RULES: Array<{ code: IssueCode; re: RegExp }> = [
  { code: "sac_phrase", re: /(essa situacao sera verificada|sera verificado|estamos verificando|aguarde (o )?retorno|estamos a disposicao|sua solicitacao foi (encaminhada|registrada)|seu (relato|pedido) foi registrad|agradecemos o contato|protocolo)/ },
  { code: "third_person_team", re: /(nossa equipe (ja )?(foi|esta|vai|ira)|a equipe (ja )?(foi|esta|vai|ira)|o time (humano|de atendimento)|um atendente (vai|ira)|transferindo para|vou (avisar|acionar) a equipe|vou verificar com a equipe)/ },
  { code: "internal_registration", re: /(registrando internamente|registrei internamente|registrado internamente|anotei internamente|estou registrando|ja registrei|registrei (o|seu) (pedido|aviso|relato))/ },
  { code: "time_promise", re: /(de imediato|na hora|em instantes|o quanto antes|ja ja|em (alguns|poucos) minutos|daqui a pouco|ainda hoje|em ate \d+ ?(min|hora))/ },
  { code: "raw_tag", re: /(\[\[|\]\]|\{\{|\}\})/ },
  { code: "generic_opener", re: /(como posso (te )?ajudar hoje|fico a disposicao para qualquer duvida|qualquer duvida estou a disposicao)/ },
];

export interface ReplyIssues {
  issues: IssueCode[];
  chars: number;
}

/** Analisa UM texto enviado ao hóspede. Texto vazio = silêncio (não é defeito; vem como `empty` para contagem). */
export function analyzeReply(text: string | null | undefined): ReplyIssues {
  const raw = (text ?? "").trim();
  if (!raw) return { issues: ["empty"], chars: 0 };
  const n = norm(raw);
  const issues = new Set<IssueCode>();
  for (const r of RULES) if (r.re.test(n)) issues.add(r.code);
  // sequência de 4+ dígitos fora de horário/data/valor monetário: pode ser senha vazando em texto livre
  if (/(?<![\d:/.,$])(?<!R\$ ?)\b\d{4,8}\b(?!\d|[:/.,]\d)/.test(raw.replace(/\b(19|20)\d{2}\b/g, ""))) issues.add("digits_secret_like");
  if ((raw.match(/!/g) ?? []).length >= 3) issues.add("too_many_exclamations");
  if (raw.length > 1400) issues.add("too_long");
  return { issues: [...issues], chars: raw.length };
}

export type HandoffCategory = "access" | "exception_request" | "formal_change" | "incident" | "commercial" | "emergency" | "uncertainty" | "technical_failure" | "other";

/** Classifica o MOTIVO de um encaminhamento, para medir quantos eram evitáveis (mede, não decide). */
export function classifyHandoff(reason: string | null | undefined): HandoffCategory {
  const n = norm(reason ?? "");
  if (/(emergenc|risco|urgenc.*vida|socorro)/.test(n)) return "emergency";
  if (/(credencial|acesso|senha|fechadura|chave|portaria|cofre)/.test(n)) return "access";
  if (/(late|saida tardia|entrada antecipada|excecao|decisao)/.test(n)) return "exception_request";
  if (/(alteracao formal|cancelament|datas|valor|numero de hospedes)/.test(n)) return "formal_change";
  if (/(avaria|vazament|manutenc|defeito|ar-condicionado|chuveiro|incidente)/.test(n)) return "incident";
  if (/(consulta comercial|disponibilidade|reserva)/.test(n)) return "commercial";
  if (/(contingencia|nao foi possivel|indisponiv|falha|timeout|validar)/.test(n)) return "technical_failure";
  if (/(duvida|nao sei|sem informacao|nao consta|pergunta)/.test(n)) return "uncertainty";
  return "other";
}

export interface ReplayCase {
  id: string;
  /** Resposta da IA (ou do replay). `null`/"" = silêncio. */
  aiReply: string | null;
  aiHandoff?: boolean;
  aiHandoffReason?: string | null;
  /** O que a equipe respondeu de fato depois (se respondeu). */
  humanReply?: string | null;
}

export interface ReplaySummary {
  total: number;
  silent: number;
  spoke: number;
  handoffs: number;
  handoffRate: number;
  silentRate: number;
  handoffByCategory: Record<HandoffCategory, number>;
  issueCounts: Partial<Record<IssueCode, number>>;
  /** Respostas com ao menos um defeito de voz (exclui `empty`). */
  withIssues: number;
  /** Casos em que a IA ficou muda E a equipe depois respondeu uma pergunta de conteúdo (candidatos a "IA devia ter respondido"). */
  silentButHumanAnswered: string[];
  /** Casos em que a IA encaminhou e a resposta humana foi curta (candidatos a handoff evitável). */
  possiblyAvoidableHandoffs: string[];
}

const emptyCats = (): Record<HandoffCategory, number> => ({ access: 0, exception_request: 0, formal_change: 0, incident: 0, commercial: 0, emergency: 0, uncertainty: 0, technical_failure: 0, other: 0 });

export function summarizeReplay(cases: readonly ReplayCase[]): ReplaySummary {
  const s: ReplaySummary = {
    total: cases.length, silent: 0, spoke: 0, handoffs: 0, handoffRate: 0, silentRate: 0,
    handoffByCategory: emptyCats(), issueCounts: {}, withIssues: 0, silentButHumanAnswered: [], possiblyAvoidableHandoffs: [],
  };
  for (const c of cases) {
    const a = analyzeReply(c.aiReply);
    const silent = a.issues.includes("empty");
    if (silent) s.silent++; else s.spoke++;
    if (!silent) {
      const real = a.issues.filter((i) => i !== "empty");
      if (real.length) s.withIssues++;
      for (const i of real) s.issueCounts[i] = (s.issueCounts[i] ?? 0) + 1;
    }
    if (c.aiHandoff) {
      s.handoffs++;
      const cat = classifyHandoff(c.aiHandoffReason);
      s.handoffByCategory[cat]++;
      const h = (c.humanReply ?? "").trim();
      // resposta humana curta e informativa, sem decisão/exceção: a IA provavelmente conseguiria
      if (h && h.length <= 240 && cat !== "emergency" && cat !== "exception_request" && cat !== "formal_change" && cat !== "technical_failure") s.possiblyAvoidableHandoffs.push(c.id);
    }
    if (silent && !c.aiHandoff && (c.humanReply ?? "").trim().length > 40) s.silentButHumanAnswered.push(c.id);
  }
  s.handoffRate = cases.length ? s.handoffs / cases.length : 0;
  s.silentRate = cases.length ? s.silent / cases.length : 0;
  return s;
}
