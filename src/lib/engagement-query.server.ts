/**
 * Helpers das telas de engajamento/analytics.
 *
 * Antes, cada consulta era consumida como `q.data ?? []` — quando o banco
 * cortava a leitura por demora (código 57014), o painel mostrava zero em vez
 * de avisar. Agora a falha aparece: o operador vê um recado claro e tenta de
 * novo, em vez de olhar números errados.
 */

type QueryResult<T> = { data: T[] | null; error?: { code?: string; message?: string } | null };

export class EngagementTimeoutError extends Error {
  constructor() {
    super("O relatório demorou demais para carregar. Reduza o período ou filtre por imóvel e tente de novo.");
    this.name = "EngagementTimeoutError";
  }
}

function isTimeout(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "57014") return true;
  const m = (error.message ?? "").toLowerCase();
  return m.includes("statement timeout") || m.includes("canceling statement") || m.includes("timeout");
}

/** Retorna as linhas; lança erro legível se a consulta falhou. */
export function rows<T>(scope: string, q: QueryResult<T>): T[] {
  if (q.error) {
    console.error(`[engagement:${scope}]`, q.error);
    if (isTimeout(q.error)) throw new EngagementTimeoutError();
    throw new Error("Não foi possível carregar os dados do relatório. Tente de novo.");
  }
  return q.data ?? [];
}
