/**
 * Acesso paginado à lista de usuários de autenticação.
 *
 * A API administrativa devolve no máximo uma página por chamada. O código
 * antigo pedia `perPage: 200` e assumia que cabia tudo — passando disso, nomes
 * e e-mails de membros simplesmente sumiam da tela sem nenhum erro visível.
 * Aqui percorremos todas as páginas até o fim.
 */
import type { User } from "@supabase/supabase-js";

const PAGE_SIZE = 200;
const MAX_PAGES = 50; // teto de segurança (10.000 usuários)

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Todos os usuários de autenticação, percorrendo todas as páginas. */
export async function listAllAuthUsers(): Promise<User[]> {
  const db = await admin();
  const out: User[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) break;
    const users = data?.users ?? [];
    out.push(...users);
    if (users.length < PAGE_SIZE) break;
  }
  return out;
}

/** Mapa id -> e-mail para os ids informados (sem limite de 200 usuários). */
export async function authEmailsByIds(ids: string[]): Promise<Map<string, string | null>> {
  const wanted = new Set(ids);
  const map = new Map<string, string | null>();
  if (!wanted.size) return map;
  for (const u of await listAllAuthUsers()) {
    if (wanted.has(u.id)) map.set(u.id, u.email ?? null);
  }
  return map;
}

/** Busca um usuário pelo e-mail, sem depender de uma única página. */
export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  for (const u of await listAllAuthUsers()) {
    if ((u.email ?? "").toLowerCase() === target) return u;
  }
  return null;
}
