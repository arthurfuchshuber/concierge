/**
 * Postgres REAL e LOCAL para os testes do Copiloto. Sobe um cluster temporário (initdb + pg_ctl,
 * só socket Unix, porta efêmera), cria um banco por suíte, aplica o ambiente "tipo Supabase"
 * (`supabase-like-setup.sql`) e as migrations pedidas pela suíte. Cada consulta roda num processo `psql`
 * separado ⇒ cada uma é uma CONEXÃO independente (é isso que torna a concorrência real).
 * Nada toca a produção. Sem binários do Postgres, `PG_AVAILABLE = false` e a suíte é pulada
 * (registrado no relatório; a evidência do gate só é gravada quando a suíte roda de verdade).
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PG_ROOT = "/usr/lib/postgresql";
/** `GUEST_AI_PG_BIN` aponta para outro diretório de binários (ex.: PostgreSQL 17.6). */
const binOk = (bin: string | null | undefined): bin is string => !!bin && existsSync(path.join(bin, "postgres")) && existsSync(path.join(bin, "initdb"));
function findBin(): string | null {
  const env = process.env.GUEST_AI_PG_BIN;
  if (env) return binOk(env) ? env : null;
  if (!existsSync(PG_ROOT)) return null;
  for (const v of readdirSync(PG_ROOT).sort().reverse()) {
    const bin = path.join(PG_ROOT, v, "bin");
    if (existsSync(path.join(bin, "postgres")) && existsSync(path.join(bin, "initdb"))) return bin;
  }
  return null;
}
export const PG_BIN = findBin();
export const PG_AVAILABLE = !!PG_BIN && existsSync("/usr/bin/psql");
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const RUN_AS = "pgtest";

export const SETUP_PATH = path.join(__dirname, "supabase-like-setup.sql");

function asPgUser(cmd: string[]): void {
  if (IS_ROOT) {
    try {
      execFileSync("id", [RUN_AS], { stdio: "ignore" });
    } catch {
      execFileSync("useradd", ["-M", "-s", "/bin/false", RUN_AS], { stdio: "ignore" });
    }
    execFileSync("su", [RUN_AS, "-s", "/bin/sh", "-c", cmd.map((c) => `'${c.replace(/'/g, "'\\''")}'`).join(" ")], { stdio: "pipe" });
  } else {
    execFileSync(cmd[0]!, cmd.slice(1), { stdio: "pipe" });
  }
}

export interface PgCluster {
  dir: string;
  port: number;
  db: string;
  version: string;
  /** Executa SQL numa conexão NOVA. `role` aplica `SET ROLE` antes. Devolve linhas em texto (-tA). */
  sql(query: string, opts?: { role?: string; db?: string }): Promise<string>;
  /** Igual a `sql`, mas devolve o erro (texto) em vez de lançar. */
  trySql(query: string, opts?: { role?: string }): Promise<{ ok: true; out: string } | { ok: false; error: string }>;
  stop(): void;
}

/**
 * `extraMigrations`: arquivos SQL aplicados DEPOIS do ambiente "tipo Supabase", na ordem dada.
 * `opts`: `bin` troca o diretório de binários só deste cluster; `serverOptions` acrescenta `-c` ao servidor.
 */
export function startCluster(
  extraMigrations: readonly string[] = [],
  opts: { bin?: string; serverOptions?: readonly string[]; env?: Readonly<Record<string, string>> } = {},
): PgCluster {
  const BIN = opts.bin ?? PG_BIN;
  if (!binOk(BIN) || !existsSync("/usr/bin/psql")) throw new Error("postgres_unavailable");
  const dir = mkdtempSync(path.join(tmpdir(), "guest-ai-pg-"));
  chmodSync(dir, 0o777);
  const data = path.join(dir, "data");
  const port = 40000 + Math.floor(Math.random() * 20000);
  asPgUser([path.join(BIN, "initdb"), "-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
  const extra = (opts.serverOptions ?? []).map((o) => ` -c ${o}`).join("");
  // `env` (A1): variáveis só do SERVIDOR (ex.: libfaketime para provar a virada do dia UTC com relógio real); vão
  // no próprio comando do pg_ctl porque `su` descarta LD_PRELOAD do ambiente herdado
  const envPrefix = Object.entries(opts.env ?? {}).map(([k, v]) => `${k}=${v}`);
  asPgUser([...(envPrefix.length ? ["env", ...envPrefix] : []), path.join(BIN, "pg_ctl"), "-D", data, "-w", "-l", path.join(dir, "pg.log"), "-o", `-p ${port} -k ${dir} -c listen_addresses= -c max_connections=100${extra}`, "start"]);
  const db = "copilottest";
  const base = ["-h", dir, "-p", String(port), "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-tA"];
  execFileSync("psql", [...base, "-d", "postgres", "-c", `create database ${db}`]);
  execFileSync("psql", [...base, "-d", db, "-f", SETUP_PATH]);
  for (const m of extraMigrations) execFileSync("psql", [...base, "-d", db, "-f", m]);
  const version = execFileSync("psql", [...base, "-d", db, "-c", "show server_version"], { encoding: "utf8" }).trim();

  const run = (query: string, opts: { role?: string; db?: string } = {}) =>
    new Promise<{ code: number; out: string; err: string }>((resolve) => {
      const full = opts.role ? `set role ${opts.role};\n${query}` : query;
      const p = spawn("psql", [...base, "-d", opts.db ?? db, "-c", full]);
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => resolve({ code: code ?? 1, out: out.trim(), err: err.trim() }));
    });

  return {
    dir,
    port,
    db,
    version,
    async sql(query, opts) {
      const r = await run(query, opts);
      if (r.code !== 0) throw new Error(r.err || "psql_failed");
      return r.out;
    },
    async trySql(query, opts) {
      const r = await run(query, opts);
      return r.code === 0 ? { ok: true, out: r.out } : { ok: false, error: r.err };
    },
    stop() {
      try {
        asPgUser([path.join(BIN, "pg_ctl"), "-D", data, "-m", "immediate", "stop"]);
      } catch {
        /* já parado */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const sha256File = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
