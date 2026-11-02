import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as P from "@/lib/guest-ai/data/projections";
import { PENDING_MIGRATION_COLUMNS, REAL_COLUMNS } from "./helpers/real-columns";

const ROOT = path.resolve(__dirname, "..");

function sources(dir = ROOT): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "__tests__") return [];
    if (statSync(full).isDirectory()) return sources(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const read = (f: string) => readFileSync(f, "utf8");
/** Remove comentários para não confundir a varredura com a documentação. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("F0 · fronteira de dados (varredura estática do módulo guest-ai/)", () => {
  const files = sources();

  it("há arquivos a varrer", () => expect(files.length).toBeGreaterThan(10));

  it("D13/R6 · o módulo guest-ai é somente leitura: nenhuma escrita, RPC ou função interna de autorização", () => {
    const write = /\.(insert|update|upsert|delete|rpc)\s*\(/;
    const internal = /internal_set_checkin_credentials_release|internal_set_late_checkout|conciergeia\.internal_actor/;
    expect(files.filter((f) => write.test(code(f))).map(rel)).toEqual([]);
    expect(files.filter((f) => internal.test(code(f))).map(rel)).toEqual([]);
  });

  it("só data/client.server.ts importa o cliente administrativo", () => {
    const offenders = files.filter((f) => /supabaseAdmin|integrations\/supabase\/client\.server/.test(code(f)));
    expect(offenders.map(rel)).toEqual(["data/client.server.ts"]);
  });

  it("nenhum select('*') nem select() vazio em guest-ai/", () => {
    const offenders = files.filter((f) => /\.select\(\s*(["'`]\s*\*|\))/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("nomes de colunas de segredo só aparecem em projections.ts e credentials.server.ts", () => {
    const re = new RegExp(`["'\`](${P.SENSITIVE_PROPERTY_COLUMNS.join("|")})["'\`]`);
    const offenders = files.filter((f) => re.test(code(f))).map(rel).sort();
    expect(offenders).toEqual(["data/credentials.server.ts", "data/projections.ts"]);
  });

  it("a lista de credenciais só é usada por credentials.server.ts", () => {
    const offenders = files.filter((f) => /PROPERTY_CREDENTIAL_COLUMNS/.test(code(f))).map(rel).sort();
    expect(offenders).toEqual(["data/credentials.server.ts", "data/projections.ts"]);
  });

  it("F0/F1 (fora de llm/) não têm LLM, embeddings, rede nem gateway", () => {
    const re = /lib\/llm|guest-ai\/llm|ai\.gateway|openai|anthropic|generativelanguage|embedTexts|embedOne|runAgent|chatText|chatJson|\bfetch\(/i;
    expect(files.filter((f) => !rel(f).startsWith("llm/") && re.test(code(f))).map(rel)).toEqual([]);
  });

  it("F2-A · gateway isolado: rede só no transporte do Lovable; sem src/lib/llm; sem banco, contexto ou credenciais", () => {
    const llm = files.filter((f) => rel(f).startsWith("llm/"));
    expect(llm.map(rel).sort()).toEqual([
      "llm/contracts.ts",
      "llm/errors.ts",
      "llm/gateway.server.ts",
      "llm/models.ts",
      "llm/providers/lovable-gateway.server.ts",
      "llm/providers/types.ts",
      "llm/telemetry.ts",
    ]);
    expect(llm.filter((f) => /\bfetch\(|ai\.gateway/.test(code(f))).map(rel)).toEqual(["llm/providers/lovable-gateway.server.ts"]);
    for (const f of llm) {
      const c = code(f);
      expect(c, rel(f)).not.toMatch(/@\/lib\/llm|lib\/llm\/|guest-ai\/(data|context|policy)|credentials|CredentialGrant|supabase|slot\.server|\.\.\/(data|context|policy)\//);
      // F2-A não executa nem registra ferramentas (tool calling) nem envia a canais.
      expect(c, rel(f)).not.toMatch(/\btools\s*:|tool_choice|function_call|sinch|whatsapp|channex|airbnb/i);
    }
  });

  it("F2-A · o slot continua desligado: não importa o gateway e devolve fallback humano (null)", async () => {
    const slot = code(path.join(ROOT, "slot.server.ts"));
    expect(slot).not.toMatch(/llm|generateGuestLlm|buildGuestContext/);
    const { requestGuestAiReply } = await import("@/lib/guest-ai/slot.server");
    await expect(requestGuestAiReply({ surface: "guide_chat" as never, conversationId: "c", messageId: "m" })).resolves.toBeNull();
  });

  it("o slot não importa nem expõe cliente de banco", () => {
    const slot = code(path.join(ROOT, "slot.server.ts"));
    expect(slot).not.toMatch(/supabase/i);
  });

  it("a política (policy/) não importa a camada de dados nem acessa banco/relógio", () => {
    for (const f of files.filter((x) => rel(x).startsWith("policy/"))) {
      const c = code(f);
      // `.from("tabela")` = consulta ao banco (Array.from não conta).
      expect(c, rel(f)).not.toMatch(/guest-ai\/data|client\.server|\.from\(\s*["'`]/);
      expect(c, rel(f)).not.toMatch(/Date\.now\(|new Date\(\)/);
    }
  });
});

describe("F0 · projeções explícitas", () => {
  const sensitive = new Set<string>(P.SENSITIVE_PROPERTY_COLUMNS);
  const nonCredential: Record<string, readonly string[]> = {
    PROPERTY_SCOPE_COLUMNS: P.PROPERTY_SCOPE_COLUMNS,
    PROPERTY_PUBLIC_COLUMNS: P.PROPERTY_PUBLIC_COLUMNS,
    PROPERTY_OPERATIONAL_COLUMNS: P.PROPERTY_OPERATIONAL_COLUMNS,
    PROPERTY_DOSSIER_COLUMNS: P.PROPERTY_DOSSIER_COLUMNS,
  };
  for (const [name, list] of Object.entries(nonCredential)) {
    it(`${name} não contém nenhuma coluna sensível`, () => {
      expect(list.filter((c) => sensitive.has(c))).toEqual([]);
    });
  }
  it("as senhas existem somente em PROPERTY_CREDENTIAL_COLUMNS", () => {
    for (const c of ["lock_code", "gate_code", "wifi_password", "pin_code"]) {
      expect(P.PROPERTY_CREDENTIAL_COLUMNS).toContain(c);
    }
  });
  it("nenhuma projeção usa '*' e `cols()` recusa '*' e lista vazia", () => {
    for (const [k, v] of Object.entries(P)) {
      if (Array.isArray(v)) expect(v, k).not.toContain("*");
    }
    expect(() => P.cols(["*"])).toThrow();
    expect(() => P.cols([])).toThrow();
    expect(P.cols(["id", "name"])).toBe("id, name");
  });
  it("todas as colunas projetadas existem no banco real (snapshot de 02/11/2026)", () => {
    const map: Array<[string, readonly string[]]> = [
      ["properties", [...P.PROPERTY_SCOPE_COLUMNS, ...P.PROPERTY_PUBLIC_COLUMNS, ...P.PROPERTY_OPERATIONAL_COLUMNS, ...P.PROPERTY_DOSSIER_COLUMNS, ...P.PROPERTY_CREDENTIAL_COLUMNS]],
      ["property_chat_conversations", P.CONVERSATION_COLUMNS],
      ["property_chat_messages", P.MESSAGE_COLUMNS],
      ["property_reservations", P.RESERVATION_COLUMNS],
      ["guest_arrival_status", P.ARRIVAL_STATUS_COLUMNS],
      ["guide_access_logs", P.ACCESS_LOG_COLUMNS],
      ["property_listing_raw_data", P.LISTING_COLUMNS],
      ["property_faqs", P.FAQ_COLUMNS],
      ["property_checkout_items", P.CHECKOUT_ITEM_COLUMNS],
      ["property_emergency_contacts", P.EMERGENCY_COLUMNS],
      ["property_manual_items", P.MANUAL_COLUMNS],
      ["property_playbook_entries", P.ENTRY_COLUMNS],
    ];
    for (const [table, list] of map) {
      const real = new Set([...(REAL_COLUMNS[table] ?? []), ...(PENDING_MIGRATION_COLUMNS[table] ?? [])]);
      expect(list.filter((c) => !real.has(c)), table).toEqual([]);
    }
  });
  it("nenhuma coluna pendente de migration: as do R6 já estão no snapshot de produção", () => {
    expect(PENDING_MIGRATION_COLUMNS).toEqual({});
    for (const c of ["late_checkout_time", "late_checkout_approved_at", "late_checkout_by"]) expect(REAL_COLUMNS["guest_arrival_status"]).toContain(c);
  });
  it("a projeção de reservas não traz contatos (PII) nem valores financeiros", () => {
    expect(P.RESERVATION_COLUMNS).not.toContain("guest_contacts");
    expect(P.RESERVATION_COLUMNS).not.toContain("amount");
  });
});
