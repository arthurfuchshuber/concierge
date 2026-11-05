/**
 * ENTREGA 4 · ensaio — PostgreSQL 17.6 DESCARTÁVEL que reproduz o que importa da produção auditada em
 * 04/11/2026 (somente teste; nada aqui vai para produção):
 *  - superusuário separado (`supabase_admin`) e `postgres` SEM superusuário, com CREATEROLE e BYPASSRLS
 *    (como na produção); as migrations rodam como `postgres` (dono das funções SECURITY DEFINER);
 *  - papéis anon, authenticated, service_role (BYPASSRLS), sandbox_exec (BYPASSRLS), authenticator;
 *  - DEFAULT PRIVILEGES de `postgres` no schema public IGUAIS aos da produção (tabelas arwdDxtm,
 *    sequências rwU e funções X para anon/authenticated/service_role; sandbox_exec ar/rU);
 *  - estrutura legada das tabelas que as migrations referenciam (colunas, PK, FK em cascata, RLS com
 *    política, gatilho) e uma tabela operacional extra com dados, para provar que nada legado muda.
 * Mundo sintético; nenhuma credencial real.
 */
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const PG176 = "/opt/pg176/bin";
export const PG176_OK = existsSync(`${PG176}/postgres`) && existsSync("/usr/bin/psql");
const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
export const MIG = {
  lease: path.join(REPO, "supabase/migrations/20261104000000_guest_ai_conversation_leases.sql"),
  shadow: path.join(REPO, "supabase/migrations/20261104120000_guest_ai_shadow.sql"),
  pilot: path.join(REPO, "supabase/migrations/20261105120000_guest_ai_shadow_pilot.sql"),
};
export const OPS = (f: string) => path.join(REPO, "src/lib/guest-ai/ops/e4", f);

const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;
function asPgUser(cmd: string[]) {
  if (IS_ROOT) {
    try {
      execFileSync("id", ["pgtest"], { stdio: "ignore" });
    } catch {
      execFileSync("useradd", ["-M", "-s", "/bin/false", "pgtest"], { stdio: "ignore" });
    }
    execFileSync(
      "su",
      ["pgtest", "-s", "/bin/sh", "-c", cmd.map((c) => `'${c.replace(/'/g, "'\\''")}'`).join(" ")],
      { stdio: "pipe" },
    );
  } else execFileSync(cmd[0]!, cmd.slice(1), { stdio: "pipe" });
}

/** Estrutura legada mínima fiel à produção nas colunas/constraints que as migrations usam. */
export const LEGACY_SQL = `
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  slug text unique,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.property_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  guest_session_id text not null,
  status text not null default 'ai',
  ai_paused boolean not null default false,
  paused_until timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.property_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.property_chat_conversations(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger properties_touch before update on public.properties for each row execute function public.touch_updated_at();
create trigger trg_pcc_updated_at before update on public.property_chat_conversations for each row execute function public.touch_updated_at();
alter table public.properties enable row level security;
alter table public.property_chat_conversations enable row level security;
alter table public.property_chat_messages enable row level security;
create policy properties_owner on public.properties for all to authenticated using (owner_id = '00000000-0000-4000-8000-00000000aaaa'::uuid);
create policy conv_owner on public.property_chat_conversations for all to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = '00000000-0000-4000-8000-00000000aaaa'::uuid));
create policy msg_owner on public.property_chat_messages for all to authenticated using (true);
`;

export interface ProdLike {
  dir: string;
  port: number;
  version: string;
  /** Como `postgres` (não superusuário; dono das migrations). `role` aplica SET ROLE. */
  sql(q: string, opts?: { role?: string }): Promise<string>;
  trySql(
    q: string,
    opts?: { role?: string },
  ): Promise<{ ok: true; out: string } | { ok: false; error: string }>;
  /** Arquivo inteiro como `postgres` (psql -f, ON_ERROR_STOP, transação única). */
  file(
    p: string,
    opts?: { singleTransaction?: boolean },
  ): { ok: true } | { ok: false; error: string };
  /** Superusuário (só montagem do ambiente). */
  admin(q: string): string;
  rows<T = Record<string, unknown>>(q: string): Promise<T[]>;
  stop(): void;
}

export function startProdLike(opts: { legacy?: boolean } = {}): ProdLike {
  if (!PG176_OK) throw new Error("pg176_unavailable");
  const dir = mkdtempSync(path.join(tmpdir(), "guest-ai-e4-"));
  chmodSync(dir, 0o777);
  const data = path.join(dir, "data");
  const port = 40000 + Math.floor(Math.random() * 20000);
  asPgUser([
    path.join(PG176, "initdb"),
    "-D",
    data,
    "-U",
    "supabase_admin",
    "--auth=trust",
    "-E",
    "UTF8",
  ]);
  asPgUser([
    path.join(PG176, "pg_ctl"),
    "-D",
    data,
    "-w",
    "-l",
    path.join(dir, "pg.log"),
    "-o",
    `-p ${port} -k ${dir} -c listen_addresses= -c max_connections=100 -c log_min_messages=warning`,
    "start",
  ]);
  const base = (user: string) => [
    "-h",
    dir,
    "-p",
    String(port),
    "-U",
    user,
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-tA",
  ];
  const admin = (q: string, dbn = "app") =>
    execFileSync("psql", [...base("supabase_admin"), "-d", dbn, "-c", q], {
      encoding: "utf8",
    }).trim();
  execFileSync("psql", [
    ...base("supabase_admin"),
    "-d",
    "postgres",
    "-c",
    `
    create role postgres login createrole bypassrls;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role sandbox_exec login bypassrls; create role authenticator login noinherit;
    grant anon, authenticated, service_role to authenticator;
    grant anon, authenticated, service_role to postgres;`,
  ]);
  execFileSync("psql", [
    ...base("supabase_admin"),
    "-d",
    "postgres",
    "-c",
    "create database app owner postgres",
  ]);
  admin(
    `grant usage, create on schema public to postgres; grant usage on schema public to anon, authenticated, service_role, sandbox_exec;`,
  );
  // DEFAULT PRIVILEGES de `postgres` no schema public = os da produção (pg_default_acl auditado)
  execFileSync("psql", [
    ...base("postgres"),
    "-d",
    "app",
    "-c",
    `
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant select, insert on tables to sandbox_exec;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant select, usage on sequences to sandbox_exec;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`,
  ]);
  if (opts.legacy !== false)
    execFileSync("psql", [...base("postgres"), "-d", "app", "-c", LEGACY_SQL]);
  const version = execFileSync(
    "psql",
    [...base("postgres"), "-d", "app", "-c", "show server_version"],
    { encoding: "utf8" },
  ).trim();
  const run = (q: string, o: { role?: string } = {}) =>
    new Promise<{ code: number; out: string; err: string }>((resolve) => {
      const p = spawn("psql", [
        ...base("postgres"),
        "-d",
        "app",
        "-c",
        o.role ? `set role ${o.role};\n${q}` : q,
      ]);
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => resolve({ code: code ?? 1, out: out.trim(), err: err.trim() }));
    });
  return {
    dir,
    port,
    version,
    async sql(q, o) {
      const r = await run(q, o);
      if (r.code !== 0) throw new Error(r.err || "psql_failed");
      return r.out;
    },
    async trySql(q, o) {
      const r = await run(q, o);
      return r.code === 0 ? { ok: true, out: r.out } : { ok: false, error: r.err };
    },
    file(p, o = {}) {
      try {
        execFileSync(
          "psql",
          [
            ...base("postgres"),
            "-d",
            "app",
            ...(o.singleTransaction === false ? [] : ["--single-transaction"]),
            "-f",
            p,
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String((e as { stderr?: unknown }).stderr ?? e) };
      }
    },
    admin: (q) => admin(q),
    async rows<T>(q: string) {
      const r = await run(`select coalesce(json_agg(x), '[]'::json) from (${q}) x`);
      if (r.code !== 0) throw new Error(r.err || "psql_failed");
      return JSON.parse(r.out) as T[];
    },
    stop() {
      try {
        asPgUser([path.join(PG176, "pg_ctl"), "-D", data, "-m", "immediate", "stop"]);
      } catch {
        /* parado */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const readSql = (p: string) => readFileSync(p, "utf8");
