/**
 * Acesso a tabelas ainda fora dos tipos gerados do Supabase, com UM único ponto de cast (em vez de
 * `as any` + eslint-disable espalhados). Quando a tabela entrar em `types.ts`, basta trocar o chamador
 * por `client.from("tabela")` normal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UntypedTable = any;

export function untypedTable(client: unknown, name: string): UntypedTable {
  return (client as SupabaseClient).from(name as never);
}
