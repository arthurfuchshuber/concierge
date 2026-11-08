// Formato, destino e prioridade dos pushes (puro, sem I/O — testável).
//
// Padrão aprovado no mockup "ConciergeIA — Pushes" (07/11/2026):
//  · títulos com iniciais maiúsculas (exceto palavras de ligação), sempre
//    concordando com a quantidade (1 → singular, 2+ → plural);
//  · 🔴 só em atraso; corpo da operação = só a contagem por cidade;
//  · nome do imóvel numa linha só, cortado com reticências (o push não corta
//    por largura de tela, então o corte é feito aqui: 34 caracteres coube no
//    iPhone, 40 ainda quebrava);
//  · proprietário nunca aparece no push (nem "Pr:", nem "Proprietário(a):").

/** Largura que cabe em 1 linha do corpo no iPhone (validado no mockup). */
export const PUSH_LINE_MAX = 34;

/** Corta em `max` caracteres com "…" (o total, contando as reticências, é `max`). */
export function truncateLine(text: string | null | undefined, max = PUSH_LINE_MAX): string {
  const s = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Mensagem longa: espaços normalizados e corte com "…". */
export function truncateText(text: string | null | undefined, max: number): string {
  return truncateLine(text, max);
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Corpo da operação: uma linha por cidade, maior contagem primeiro.
 * `unit` opcional entra entre o número e a cidade ("3 imóveis em Foz").
 */
export function bodyByCity(
  counts: Map<string, number>,
  unit?: { one: string; many: string },
): string {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([city, n]) =>
      unit ? `${n} ${plural(n, unit.one, unit.many)} em ${city}` : `${n} em ${city}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Destinos do clique (07/11/2026): cada push abre a informação direto.
// O Dashboard lê `?janela=` e abre a janela correspondente.
// ---------------------------------------------------------------------------

export const PUSH_WINDOWS = {
  checkins: "Check-ins Pendentes",
  checkouts: "Checkouts Pendentes",
  "checkouts-amanha": "Checkouts amanhã",
  limpeza: "Fila de Limpeza",
  estadia: "Em Estadia",
} as const;

export type PushWindow = keyof typeof PUSH_WINDOWS;

export function isPushWindow(v: unknown): v is PushWindow {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PUSH_WINDOWS, v);
}

export function dashboardWindowUrl(win: PushWindow): string {
  return `/admin/dashboard?janela=${win}`;
}

// ---------------------------------------------------------------------------
// Títulos
// ---------------------------------------------------------------------------

export const opsTitles = {
  checkoutsLate: (n: number) => `🔴 ${plural(n, "Check-Out Atrasado", "Check-Outs Atrasados")}`,
  checkinsLate: (n: number) => `🔴 ${plural(n, "Check-In Atrasado", "Check-Ins Atrasados")}`,
  checkinsToday: (n: number) => plural(n, "Check-In de Hoje", "Check-Ins de Hoje"),
  checkoutsTomorrow: (n: number) => plural(n, "Check-Out de Amanhã", "Check-Outs de Amanhã"),
  cleaningPending: () => "🧹 Aguardando Limpeza",
};

export function arrivalStepTitle(
  kind: "checkin" | "checkout",
  by: { guest: true } | { who: string },
): string {
  const label = kind === "checkin" ? "Check-In" : "Check-Out";
  if ("guest" in by) return `${label} Feito pelo Hóspede`;
  return by.who ? `${label} Confirmado por ${by.who}` : `${label} Confirmado`;
}

/** Imóvel (1 linha) + "Hóspede: nome" (se houver). */
export function arrivalStepBody(property: string, guest: string | null | undefined): string {
  return [truncateLine(property), guest?.trim() ? `Hóspede: ${guest.trim()}` : ""]
    .filter(Boolean)
    .join("\n");
}

/** Atendimento no padrão Airbnb: "Nome • 4–8 de nov." (só o nome quando não há estadia). */
export function conversationTitle(guest: string, range: string | null | undefined): string {
  return range ? `${guest} • ${range}` : guest;
}

/** Imóvel numa linha + mensagem abaixo. */
export function conversationBody(property: string | null | undefined, message: string): string {
  const line = truncateLine(property);
  return line ? `${line}\n${message}` : message;
}

/** Push ao hóspede: "📍 cidade" + mensagem curta (máx. ~2 linhas). */
export const GUEST_MESSAGE_MAX = 90;
export function guestPushBody(city: string | null | undefined, message: string): string {
  const msg = truncateText(message, GUEST_MESSAGE_MAX);
  return city?.trim() ? `📍 ${city.trim()}\n${msg}` : msg;
}

// ---------------------------------------------------------------------------
// Timing (07/11/2026): pushes não podem chegar ao mesmo tempo.
//  · no máximo 1 push da varredura por rodada (30 min), por prioridade;
//  · nada sai se a conta recebeu um push nos últimos `PUSH_GAP_MINUTES`;
//  · atrasos repetem no máximo a cada 1 hora;
//  · aviso que ainda não saiu vence repetição de atraso (senão os avisos do
//    dia e a limpeza nunca teriam vez enquanto houvesse atraso aberto).
// ---------------------------------------------------------------------------

export const PUSH_GAP_MINUTES = 5;

export type ScanCandidate = {
  kind:
    | "checkouts-late"
    | "checkins-late"
    | "checkins-today"
    | "checkouts-tomorrow";
  /** Atraso que já foi avisado na hora anterior (repetição). */
  repeat?: boolean;
};

const BASE_PRIORITY: Record<ScanCandidate["kind"], number> = {
  "checkouts-late": 0,
  "checkins-late": 1,
  "checkins-today": 2,
  "checkouts-tomorrow": 2,
};

/** Ordena do mais importante para o menos: primeiro aviso → avisos do dia → limpeza → repetição de atraso. */
export function rankScanCandidates<T extends ScanCandidate>(list: T[]): T[] {
  const score = (c: T) => (c.repeat ? 10 : 0) + BASE_PRIORITY[c.kind];
  return [...list].sort((a, b) => score(a) - score(b));
}

/** Janela em que os avisos do dia podem sair (adiados por prioridade, ainda saem). */
export function inDailyWindow(hour: number, startHour: number, spanHours = 2): boolean {
  return hour >= startHour && hour < startHour + spanHours;
}
