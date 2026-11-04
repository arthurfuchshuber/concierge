/**
 * B3.1/B3.2 · isolamento estático e de segurança: loaders somente leitura, projeções explícitas e
 * reais, nenhum caminho para Gateway/LLM ou envio, nenhuma importação por produção, nenhuma migration
 * ou alteração fora de `src/lib/guest-ai/` desde o commit-base 874c41c, slot intacto, lease sem
 * substituto em memória, telemetria sem texto.
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as P from "@/lib/guest-ai/data/projections";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { REAL_COLUMNS } from "./helpers/real-columns";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(ROOT, "..", "..");
const REPO = path.resolve(SRC, "..");
const BASE = "874c41c148a93063f76af678400d71f93c4f9fe5";
const code = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function all(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    if (n === "node_modules" || n === "__tests__") return [];
    return statSync(f).isDirectory() ? all(f) : /\.(ts|tsx)$/.test(f) ? [f] : [];
  });
}

const LOADERS = ["data/airbnb-thread.server.ts", "data/human-pause.server.ts", "data/stay-authorization.server.ts", "data/sender-identity.server.ts", "data/collector.server.ts"];
const PURE = ["batch/collector.ts", "batch/lease.ts", "batch/telemetry.ts", "policy/human-pause.ts", "policy/timezone-source.ts"];

/** Snapshot (03/11/2026, information_schema) das tabelas novas lidas pela B3. */
const REAL_B3: Record<string, readonly string[]> = {
  audit_logs: ["id", "user_id", "user_email", "action", "entity_type", "entity_id", "metadata", "ip", "user_agent", "created_at"],
  channex_raw_records: ["id", "entity_type", "channex_id", "parent_id", "channex_property_id", "property_id", "payload", "source", "first_seen_at", "last_synced_at"],
  channex_twin_links: ["id", "owner_id", "property_id", "channel_id", "primary_listing_id", "primary_title", "primary_channex_property_id", "primary_room_type_id", "primary_rate_plan_id", "twin_listing_id", "twin_title", "twin_channex_property_id", "twin_room_type_id", "twin_rate_plan_id", "status", "last_sync_at", "last_error", "created_by", "created_at", "updated_at"],
  airbnb_accounts: ["id", "owner_id", "channex_channel_id", "status"],
  properties: [...REAL_COLUMNS["properties"]!, "state"],
};

describe("B3 · loaders somente leitura e projeções", () => {
  for (const f of LOADERS) {
    it(`${f}: só leitura, sem select *, sem credenciais, sem rede/LLM/envio, exige turno validado`, () => {
      const c = code(f);
      expect(c).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
      expect(c).not.toMatch(/\.select\(\s*(["'`]\s*\*|\))/);
      expect(c).not.toMatch(/lock_code|gate_code|wifi_password|pin_code|access_codes_pin|lock_instructions|gate_instructions|PROPERTY_CREDENTIAL_COLUMNS|credentials\.server/);
      expect(c).not.toMatch(/\bfetch\(|generateGuestLlm|guest-ai\/llm|@\/lib\/llm|gateway|openai|anthropic/i);
      expect(c).not.toMatch(/sendMessage|trySendAsPreferredSender|deliverToAirbnbThread|sinch|postMessage/i);
      expect(c).not.toMatch(/supabaseAdmin|integrations\/supabase\/client\.server/);
      expect(c).not.toMatch(/\b(ai_agent_\w+|ai_messages|ai_conversations|ai_memories|ai_precedents|ai_reply_due_at|ai_reply_ctx)\b/);
      if (f !== "data/airbnb-thread.server.ts") expect(c).toMatch(/assertIssued\("turn"/);
    });
  }
  it("o texto da mensagem só é lido pelo coletor (necessário ao lote); pausa e identidade nunca leem texto", () => {
    expect(P.PAUSE_MESSAGE_COLUMNS as readonly string[]).not.toContain("content");
    expect(P.COLLECTOR_MESSAGE_COLUMNS as readonly string[]).toContain("content");
    const withContent = LOADERS.filter((f) => /COLLECTOR_MESSAGE_COLUMNS|"content"/.test(code(f)));
    expect(withContent).toEqual(["data/collector.server.ts"]);
  });
  it("bruto do Airbnb e preferência: só caminhos JSON escalares (nunca o payload inteiro, que tem o texto)", () => {
    for (const s of [P.RAW_MESSAGE_META_SELECT, P.SENDER_PREF_SELECT]) {
      const parts = s.split(",").map((x) => x.trim());
      expect(parts.filter((p) => p === "payload" || /->>message$/.test(p) || /translated/.test(p))).toEqual([]);
    }
  });
  it("todas as colunas das projeções novas existem no banco real", () => {
    const map: Array<[string, readonly string[]]> = [
      ["property_chat_conversations", P.CONVERSATION_PAUSE_COLUMNS],
      ["property_chat_messages", [...P.PAUSE_MESSAGE_COLUMNS, ...P.COLLECTOR_MESSAGE_COLUMNS]],
      ["guest_arrival_status", P.STAY_AUTH_CARD_COLUMNS],
      ["audit_logs", P.STAY_AUTH_AUDIT_COLUMNS],
      ["properties", P.PROPERTY_TIMEZONE_COLUMNS],
      ["property_listing_raw_data", P.SENDER_LISTING_COLUMNS],
      ["channex_twin_links", P.SENDER_TWIN_COLUMNS],
      ["airbnb_accounts", P.SENDER_ACCOUNT_COLUMNS],
    ];
    for (const [t, list] of map) {
      const real = new Set([...(REAL_COLUMNS[t] ?? []), ...(REAL_B3[t] ?? [])]);
      expect(list.filter((c) => !real.has(c)), t).toEqual([]);
    }
    expect(P.STAY_AUTH_AUDIT_COLUMNS as readonly string[]).not.toContain("metadata");
    expect(P.SENDER_ACCOUNT_COLUMNS).toEqual(["owner_id", "channex_channel_id", "status"]);
  });
});

describe("B3 · módulos puros (coletor, lease, telemetria, pausa, fuso)", () => {
  for (const f of PURE) {
    it(`${f}: sem banco, rede, LLM, escrita, envio, temporizador, log ou relógio próprio`, () => {
      const c = code(f);
      expect(c).not.toMatch(/client\.server|getGuestAiDb|supabase|guest-ai\/data\/|\.from\(\s*["'`]/);
      expect(c).not.toMatch(/\bfetch\(|generateGuestLlm|guest-ai\/llm|gateway/i);
      expect(c).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(c).not.toMatch(/setTimeout|setInterval|clearTimeout/);
      expect(c).not.toMatch(/console\.(log|info|warn|error)/);
      expect(c).not.toMatch(/Date\.now|new Date\(\)|Math\.random|performance\.now/);
    });
  }
  it("lease: nenhum armazenamento em memória como substituto; backend único devolve indisponível", () => {
    const c = code("batch/lease.ts");
    expect(c).not.toMatch(/new Map|new WeakMap|InMemory|memoryStore/i);
    expect(c).toMatch(/available: false, reason: "no_compatible_schema"/);
    expect(c).toMatch(/gateComplete: false/);
  });
  it("telemetria do coletor: nenhuma chave de texto livre no contrato", () => {
    expect(code("batch/telemetry.ts")).not.toMatch(/\b(text|content|message|messageText|reply|draft|prompt|guestName|phone|token)\s*\??\s*:/i);
  });
  it("pausa: nenhuma heurística de conteúdo (o módulo nem recebe texto)", () => {
    expect(code("policy/human-pause.ts")).not.toMatch(/\bcontent\b|\btext\b|regex|RegExp|\.test\(/);
  });
});

describe("B3 · fluxo real intocado e nada ativado", () => {
  it("nenhum código de produção (fora de guest-ai) importa coletor, lease, telemetria ou loaders novos", () => {
    const re = /guest-ai\/(batch\/(collector|lease|telemetry)|data\/(airbnb-thread|human-pause|stay-authorization|sender-identity|collector)\.server|policy\/(human-pause|timezone-source))/;
    const outside = all(SRC).filter((f) => !f.startsWith(ROOT + path.sep)).filter((f) => re.test(readFileSync(f, "utf8")));
    expect(outside.map((f) => path.relative(SRC, f))).toEqual([]);
  });
  it("dentro de guest-ai, os loaders novos não são importados por nenhum módulo (só testes)", () => {
    const re = /data\/(human-pause|stay-authorization|sender-identity|collector)\.server|\.\/(human-pause|stay-authorization|sender-identity|collector)\.server/;
    const users = all(ROOT).filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(users).toEqual([]);
  });
  it("slot.server.ts e orchestrator.server.ts sem diff desde o commit-base; slot devolve null", async () => {
    const diff = execSync(`git diff --name-only ${BASE} -- src/lib/guest-ai/slot.server.ts src/lib/guest-ai/orchestrator/orchestrator.server.ts; git diff --name-only -- src/lib/guest-ai/slot.server.ts src/lib/guest-ai/orchestrator/orchestrator.server.ts`, { cwd: REPO, encoding: "utf8" });
    expect(diff.trim()).toBe("");
    await expect(requestGuestAiReply({ surface: "airbnb" as never, conversationId: "c", messageId: "m" })).resolves.toBeNull();
  });
  it("nenhuma migration nova e nenhuma alteração fora de src/lib/guest-ai desde o commit-base", () => {
    const changed = execSync(`git diff --name-only ${BASE} HEAD; git diff --name-only; git ls-files --others --exclude-standard`, { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.startsWith("src/lib/guest-ai/"));
    expect(changed).toEqual([]);
  });
  it("a cadeia continua sem importar o Gateway; o harness continua só com portas de leitura", () => {
    expect(code("turn-chain.ts")).not.toMatch(/generateGuestLlm|guest-ai\/llm\/gateway|providers\//);
    expect(code("shadow/harness.ts")).toMatch(/"loadHumanPause"\] as const/);
    expect(code("shadow/harness.ts")).not.toMatch(/generateGuestLlm|gateway\.server/);
  });
});
