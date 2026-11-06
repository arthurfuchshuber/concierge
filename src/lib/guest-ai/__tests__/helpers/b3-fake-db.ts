/**
 * Banco FALSO em memória para os loaders B3.1/B3.2 (só leitura). Registra cada consulta (tabela,
 * projeção, filtros) para provar projeção explícita, filtros de escopo e ausência de escrita. Não é,
 * e não substitui, mecanismo transacional: é só fixture de leitura.
 */
import type { GuestAiDb } from "@/lib/guest-ai/data/client.server";

export type Row = Record<string, unknown>;
export interface FakeCall {
  table: string;
  select: string | null;
  filters: Array<[op: string, col: string, val: unknown]>;
  order: Array<[string, unknown]>;
  limit: number | null;
  single: boolean;
  signal: AbortSignal | null;
}

export function fakeDb(tables: Record<string, Row[]>, opts: { fail?: Record<string, boolean | ((c: FakeCall) => boolean)>; throwOn?: string[] } = {}) {
  const calls: FakeCall[] = [];
  const writes: string[] = [];
  const db: GuestAiDb = {
    from(table: string) {
      const c: FakeCall = { table, select: null, filters: [], order: [], limit: null, single: false, signal: null };
      calls.push(c);
      const run = () => {
        if (opts.throwOn?.includes(table)) return Promise.reject(new Error("network"));
        const f = opts.fail?.[table];
        if (f === true || (typeof f === "function" && f(c))) return Promise.resolve({ data: null, error: { message: "boom" } });
        let rows = (tables[table] ?? []).filter((r) =>
          c.filters.every(([op, col, val]) => {
            const v = r[col];
            if (op === "eq") return v === val;
            if (op === "neq") return v !== val;
            if (op === "gte") return typeof v === "string" && typeof val === "string" && v >= val;
            if (op === "in") return Array.isArray(val) && val.includes(v);
            if (op === "like") return typeof v === "string" && typeof val === "string" && v.startsWith(val.replace(/%$/, ""));
            return true;
          }),
        );
        for (const [col, o] of [...c.order].reverse()) {
          const asc = (o as { ascending?: boolean })?.ascending !== false;
          rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0));
        }
        if (c.limit !== null) rows = rows.slice(0, c.limit);
        if (c.single) return Promise.resolve({ data: rows[0] ?? null, error: null });
        return Promise.resolve({ data: rows, error: null });
      };
      const q: Record<string, unknown> = {
        select(s: string) { c.select = s; return q; },
        abortSignal(s: AbortSignal) { c.signal = s; return q; },
        eq(k: string, v: unknown) { c.filters.push(["eq", k, v]); return q; },
        neq(k: string, v: unknown) { c.filters.push(["neq", k, v]); return q; },
        gte(k: string, v: unknown) { c.filters.push(["gte", k, v]); return q; },
        in(k: string, v: unknown) { c.filters.push(["in", k, v]); return q; },
        like(k: string, v: unknown) { c.filters.push(["like", k, v]); return q; },
        order(k: string, o: unknown) { c.order.push([k, o]); return q; },
        limit(n: number) { c.limit = n; return q; },
        maybeSingle() { c.single = true; return run(); },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return run().then(res, rej); },
        insert() { writes.push(`insert:${table}`); return q; },
        update() { writes.push(`update:${table}`); return q; },
        upsert() { writes.push(`upsert:${table}`); return q; },
        delete() { writes.push(`delete:${table}`); return q; },
      };
      return q;
    },
  };
  return { db, calls, writes };
}
