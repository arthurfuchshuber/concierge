/**
 * ENTREGA 4 · ensaio — PostgreSQL 17.6 DESCARTÁVEL que reproduz o que importa da produção auditada em
 * 04/11/2026 (somente teste; nada aqui vai para produção):
 *  - superusuário separado (`supabase_admin`) e `postgres` SEM superusuário, com CREATEROLE e BYPASSRLS
 *    (como na produção); as migrations rodam como `postgres` (dono das funções SECURITY DEFINER);
 *  - papéis anon, authenticated, service_role (BYPASSRLS), sandbox_exec (BYPASSRLS), authenticator;
 *  - DEFAULT PRIVILEGES de `postgres` no schema public IGUAIS aos da produção (tabelas arwdDxtm,
 *    sequências rwU e funções X para anon/authenticated/service_role; sandbox_exec ar/rU);
 *  - estrutura legada das tabelas que as migrations referenciam (colunas, PK, FK em cascata, RLS com
 *    política, gatilho) e uma tabela operacional extra com dados, para provar que nada legado muda;
 *  - E4 GLOBAL: as tabelas lidas pela elegibilidade (perfis, anúncios, vínculos gêmeos, WhatsApp do
 *    dono) com as colunas e constraints auditadas, e os papéis de plataforma da produção:
 *    `authenticator` NOINHERIT (membro de anon/authenticated/service_role só com SET),
 *    `supabase_read_only_user` e `supabase_etl_admin` (BYPASSRLS + pg_read_all_data) — leem tudo,
 *    independentemente de REVOKE —, e `postgres` membro de sandbox_exec sem herança e sem SET.
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
  global: path.join(REPO, "supabase/migrations/20261105120000_guest_ai_shadow_global.sql"),
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
  published boolean not null default true,
  guide_created boolean not null default true,
  checkin_time text default '15:00',
  checkout_time text default '11:00',
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
create type public.chat_sender_type as enum ('guest', 'ai', 'human', 'system');
create table public.property_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.property_chat_conversations(id) on delete cascade,
  role text not null,
  sender_type public.chat_sender_type not null default 'guest',
  content text not null,
  created_at timestamptz not null default now()
);
create table public.profiles (id uuid primary key, created_at timestamptz not null default now());
create table public.property_listing_raw_data (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique,
  owner_id uuid not null,
  source text not null default 'channex',
  airbnb_listing_id text not null,
  channex_property_id text,
  not_found_at timestamptz,
  sync_paused_at timestamptz,
  paused_reason text check (paused_reason = any (array['manual', 'account_disconnected']))
);
create table public.channex_twin_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  property_id uuid,
  status text not null default 'active'
);
create table public.host_whatsapp_config (
  owner_id uuid primary key,
  status text not null check (status = any (array['pending', 'testing', 'active', 'error']))
);
-- índices da produção que a escolha de candidatas e a elegibilidade usam (definições auditadas)
create index idx_properties_owner on public.properties (owner_id);
create index idx_pcc_property on public.property_chat_conversations (property_id, last_message_at desc);
create index idx_chat_msg_conv on public.property_chat_messages (conversation_id, created_at);
create unique index uq_plrd_airbnb_listing_id on public.property_listing_raw_data (airbnb_listing_id);
create index idx_plrd_channex_property on public.property_listing_raw_data (channex_property_id);
alter table public.profiles enable row level security;
alter table public.property_listing_raw_data enable row level security;
alter table public.channex_twin_links enable row level security;
alter table public.host_whatsapp_config enable row level security;
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
  /** Conecta como OUTRO papel de login (sem SET ROLE), p.ex. supabase_read_only_user. */
  sqlAs(user: string, q: string): Promise<{ ok: true; out: string } | { ok: false; error: string }>;
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
    create role supabase_read_only_user login bypassrls; create role supabase_etl_admin login bypassrls replication;
    grant anon, authenticated, service_role to authenticator with inherit false, set true;
    grant anon, authenticated, service_role to postgres with admin true, inherit true;
    grant sandbox_exec to postgres with admin true, inherit false, set false;
    grant pg_read_all_data to supabase_read_only_user, supabase_etl_admin;
    grant pg_monitor to supabase_read_only_user, supabase_etl_admin;`,
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
  const run = (q: string, o: { role?: string; user?: string } = {}) =>
    new Promise<{ code: number; out: string; err: string }>((resolve) => {
      const p = spawn("psql", [
        ...base(o.user ?? "postgres"),
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
    async sqlAs(user, q) {
      const r = await run(q, { user });
      return r.code === 0 ? { ok: true, out: r.out } : { ok: false, error: r.err };
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
