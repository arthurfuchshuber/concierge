import { createHash } from "node:crypto";
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
    // B3.1 (migration excepcional autorizada em 03/11): a ÚNICA escrita é o RPC do lease, só em
    // client.server.ts e só pela lista fechada LEASE_RPC_FUNCTIONS. Nenhum insert/update/upsert/delete.
    expect(files.filter((f) => write.test(code(f))).map(rel)).toEqual(["data/client.server.ts"]);
    const client = code(path.join(ROOT, "data/client.server.ts"));
    expect(client).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    // B3.3 (Entrega 2): segunda porta, também de LISTA FECHADA (`SHADOW_RPC_FUNCTIONS`), só para as RPCs do Shadow.
    expect(client.match(/\.rpc\s*\(/g)).toHaveLength(2);
    expect(client).toMatch(/if \(!\(SHADOW_RPC_FUNCTIONS as readonly string\[\]\)\.includes\(fn\)\) return/);
    expect(client).toMatch(/if \(!\(LEASE_RPC_FUNCTIONS as readonly string\[\]\)\.includes\(fn\)\) return/);
    expect(client).toMatch(/LEASE_RPC_FUNCTIONS = \["claim_conversation_lease", "transition_conversation_lease"\] as const/);
    // quem usa a porta de escrita: só o adaptador do lease
    expect(files.filter((f) => /getGuestAiLeaseRpc|leaseRpcFrom|GuestAiLeaseRpc/.test(code(f))).map(rel).sort()).toEqual(["data/client.server.ts", "data/lease-store.server.ts", "shadow-exec/worker.server.ts"]);
    // porta do Shadow: só o adaptador e a ligação de produção do worker (B3.3)
    expect(files.filter((f) => /getGuestAiShadowRpc|shadowRpcFrom|GuestAiShadowRpc/.test(code(f))).map(rel).sort()).toEqual(["data/client.server.ts", "data/shadow-store.server.ts", "shadow-exec/worker.server.ts"]);
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

  it("F0/F1 (data, context, policy, slot, trust, types) não têm LLM, embeddings, rede nem gateway", () => {
    const re = /lib\/llm|guest-ai\/llm|ai\.gateway|openai|anthropic|generativelanguage|embedTexts|embedOne|runAgent|chatText|chatJson|\bfetch\(/i;
    const f2b = /^(llm|orchestrator|validation|shadow|shadow-exec)\//; // B3.3: shadow-exec usa o Gateway (gerador emitido)
    expect(files.filter((f) => !f2b.test(rel(f)) && re.test(code(f))).map(rel)).toEqual([]);
  });

  it("F2-B · B1: só o orchestrator chama o Gateway; demais módulos novos usam apenas tipos/registro de llm/", () => {
    const runtime = files.filter((f) => /guest-ai\/llm\/gateway\.server|generateGuestLlm/.test(code(f)) && !rel(f).startsWith("llm/"));
    // B3.3 (Entrega 2): o gerador Shadow emitido é o 2º e último chamador do Gateway (barreiras fechadas).
    expect(runtime.map(rel).sort()).toEqual(["orchestrator/orchestrator.server.ts", "shadow-exec/gateway-generator.server.ts"]);
    // fora de llm/, nada de rede direta nem de outro provedor
    expect(files.filter((f) => !rel(f).startsWith("llm/") && /\bfetch\(|ai\.gateway|openai\.com|anthropic\.com/.test(code(f))).map(rel)).toEqual([]);
  });

  it("F2-B · B1: orchestrator/validation/shadow não acessam banco, credenciais, canais de envio nem tabelas legadas", () => {
    const LEGACY = /\b(ai_agent_evaluations|ai_agent_learning_metrics|ai_agent_logs|ai_agent_metrics|ai_channel_connections|ai_conversation_channels|ai_conversation_summaries|ai_conversations|ai_messages|ai_global_intelligence|ai_guest_memory|ai_host_corrections|ai_human_escalations|ai_kb_chunks|ai_knowledge_gaps|ai_learning_candidates|ai_learning_impact_logs|ai_memories|ai_operational_memory|ai_precedents|ai_proactive_actions|ai_prompt_change_candidates|ai_property_playbooks|ai_tenant_knowledge|ai_usage_events|chat_message_feedback|host_behavior|host_faqs|host_knowledge)\b/;
    const scoped = files.filter((f) => /^(orchestrator|validation|shadow)\//.test(rel(f)));
    expect(scoped.length).toBeGreaterThanOrEqual(8);
    for (const f of scoped) {
      const c = code(f);
      expect(c, rel(f)).not.toMatch(/supabase|getGuestAiDb|client\.server|\.from\(\s*["'`]/);
      expect(c, rel(f)).not.toMatch(/fetchSensitiveCredentials|credentials\.server|issueCredentialGrant|PROPERTY_CREDENTIAL_COLUMNS|SENSITIVE_PROPERTY_COLUMNS/);
      expect(c, rel(f)).not.toMatch(/deliverToAirbnbThread|sinch|property_chat_messages|sendHandoffPush|sendGuestReplyPush|handoff\.server/i);
      expect(c, rel(f)).not.toMatch(LEGACY);
      expect(c, rel(f)).not.toMatch(/\btools\s*:|tool_choice|function_call/);
    }
    // a única porta para o banco no caminho do turno é o Context Engine F1 (via loader de contexto)
    const ctxLoader = code(path.join(ROOT, "context/conversation-context.server.ts"));
    expect(ctxLoader).toMatch(/credentials: "skip"/);
    expect(ctxLoader).not.toMatch(LEGACY);
  });

  it("F2-B · B1: o registro shadow não tem nenhum campo de texto livre (sem rascunho/resposta/prompt)", () => {
    const c = code(path.join(ROOT, "shadow/contracts.ts"));
    // nenhuma CHAVE de texto livre (resposta, rascunho, prompt, mensagem, pergunta, compromissos, lacunas)
    expect(c).not.toMatch(/\b(draft\w*|reply\w*|prompt|promptText|content|messageText|text|question|commitments|missingInformation|handoffQuestion)\s*\??\s*:/i);
    expect(c).toMatch(/isShadow: true/);
  });

  it("F2-B · B1: slot.server.ts byte a byte igual ao da main (homologada)", () => {
    const hash = createHash("sha256").update(readFileSync(path.join(ROOT, "slot.server.ts"))).digest("hex");
    expect(hash).toBe("39228fefe061fa64fa46e19242e2dc21b3078ab668ac5e354a27413f8b212917");
  });

  it("F2-A · gateway isolado: rede só no transporte do Lovable; sem src/lib/llm; sem banco, contexto ou credenciais", () => {
    const llm = files.filter((f) => rel(f).startsWith("llm/"));
    expect(llm.map(rel).sort()).toEqual([
      "llm/contracts.ts",
      "llm/errors.ts",
      "llm/gateway.server.ts",
      "llm/models.ts",
      "llm/probe.server.ts",
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
