/**
 * Banco falso em memória que imita a cadeia do supabase-js usada pelo módulo de dados
 * (from/select/eq/in/order/limit/maybeSingle). Só devolve as COLUNAS PEDIDAS em `select`,
 * então um teste prova, por construção, que uma coluna sensível nunca foi lida se não foi pedida.
 * Registra cada consulta (`calls`) para os testes de expurgo e de projeção.
 */
type Row = Record<string, unknown>;
export type Call = { table: string; columns: string; filters: Array<[string, string, unknown]> };

export class FakeDb {
  calls: Call[] = [];
  failTables = new Set<string>();
  constructor(public tables: Record<string, Row[]>) {}

  from(table: string) {
    const db = this;
    const call: Call = { table, columns: "", filters: [] };
    let limitN: number | null = null;
    let order: { col: string; asc: boolean } | null = null;
    const run = () => {
      db.calls.push(call);
      if (db.failTables.has(table)) return { data: null, error: { message: "boom" } };
      let rows = (db.tables[table] ?? []).filter((r) =>
        call.filters.every(([op, col, val]) =>
          op === "eq" ? r[col] === val : Array.isArray(val) ? (val as unknown[]).includes(r[col]) : false,
        ),
      );
      if (order) rows = [...rows].sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
      if (limitN !== null) rows = rows.slice(0, limitN);
      const wanted = call.columns.split(",").map((c) => c.trim()).filter(Boolean);
      const projected = rows.map((r) => Object.fromEntries(wanted.map((c) => [c, r[c] ?? null])));
      return { data: projected, error: null };
    };
    const q: any = {
      select(columns: string) { call.columns = columns; return q; },
      eq(col: string, val: unknown) { call.filters.push(["eq", col, val]); return q; },
      in(col: string, val: unknown[]) { call.filters.push(["in", col, val]); return q; },
      order(col: string, o?: { ascending?: boolean }) { order = { col, asc: o?.ascending !== false }; return q; },
      limit(n: number) { limitN = n; return q; },
      maybeSingle() { const r = run(); return Promise.resolve(r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null }); },
      single() { return q.maybeSingle(); },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  }

  /** Quantas consultas tocaram a tabela (e, opcionalmente, a coluna). */
  touched(table: string, column?: string): number {
    return this.calls.filter((c) => c.table === table && (!column || c.columns.split(",").map((x) => x.trim()).includes(column))).length;
  }
}
