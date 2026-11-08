/**
 * B2.2 · isolamento e regressão estática: os módulos novos não acessam rede, LLM, credenciais,
 * tabelas legadas, não escrevem, não registram conteúdo e não estão ligados a nada de produção.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(ROOT, "..", "..");
const NEW_FILES = ["secret-scrub.ts", "dossier/contracts.ts", "dossier/registry.ts", "dossier/normalize.ts", "data/property-access.server.ts", "data/property-dossier.server.ts"];
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const LEGACY = /\b(ai_agent_evaluations|ai_agent_learning_metrics|ai_agent_logs|ai_agent_metrics|ai_channel_connections|ai_conversation_channels|ai_conversation_summaries|ai_conversations|ai_messages|ai_global_intelligence|ai_guest_memory|ai_host_corrections|ai_human_escalations|ai_kb_chunks|ai_knowledge_gaps|ai_learning_candidates|ai_learning_impact_logs|ai_memories|ai_operational_memory|ai_precedents|ai_proactive_actions|ai_prompt_change_candidates|ai_property_playbooks|ai_tenant_knowledge|ai_usage_events|chat_message_feedback|host_behavior|host_faqs|host_knowledge|sigma_city_\w+)\b/;
// `city_references` saiu da lista (06/11/2026, Pilar 1): é a fonte VIVA do Explorar do guia (Google Maps), lida pelo
// carregador do dossiê com a mesma resolução do guia público — a IA e o guia bebem da mesma fonte.

function allSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__") return [];
    if (statSync(full).isDirectory()) return allSources(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

describe("B2.2 · módulos novos isolados", () => {
  for (const rel of NEW_FILES) {
    it(`${rel}: sem rede, LLM, credenciais, escrita, envio, log de conteúdo ou tabelas legadas`, () => {
      const c = code(path.join(ROOT, rel));
      expect(c).not.toMatch(/\bfetch\(|ai\.gateway|openai|anthropic|generativelanguage|maps\.googleapis|tripadvisor/i);
      expect(c).not.toMatch(/generateGuestLlm|guest-ai\/llm|@\/lib\/llm|lib\/llm\//);
      expect(c).not.toMatch(/fetchSensitiveCredentials|credentials\.server|issueCredentialGrant|PROPERTY_CREDENTIAL_COLUMNS/);
      expect(c).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
      expect(c).not.toMatch(/deliverToAirbnbThread|sinch|sendChannexThreadMessage|sendTenantWhatsappText|Push\w*\(/);
      expect(c).not.toMatch(/console\.(log|info|warn|error|debug)/);
      expect(c).not.toMatch(/slot\.server|orchestrator\.server/);
      expect(c).not.toMatch(LEGACY);
      // erros com código fixo (nenhuma mensagem montada com valores)
      expect(c).not.toMatch(/throw new \w+\(\s*`/);
    });
  }
  it("secret-scrub é autossuficiente: nenhum import (não lê banco nem colunas protegidas)", () => {
    const c = code(path.join(ROOT, "secret-scrub.ts"));
    expect(c).not.toMatch(/^\s*import\s/m);
    expect(c).not.toMatch(/lock_code|gate_code|pin_code|access_codes_pin|lock_instructions|gate_instructions/);
  });
  it("dossier/ é puro: sem banco e sem relógio", () => {
    for (const rel of NEW_FILES.filter((f) => f.startsWith("dossier/"))) {
      const c = code(path.join(ROOT, rel));
      expect(c, rel).not.toMatch(/\.from\(\s*["'`]|getGuestAiDb|client\.server/);
      expect(c, rel).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random/);
    }
  });
  it("só o carregador lê o dossiê e só das tabelas esperadas; autorização só lê `properties`", () => {
    const tables = (rel: string) => [...code(path.join(ROOT, rel)).matchAll(/\.from\(\s*["'`]([\w]+)["'`]/g)].map((m) => m[1]).sort();
    expect(tables("data/property-access.server.ts")).toEqual(["properties"]);
    expect([...new Set(tables("data/property-dossier.server.ts"))]).toEqual([
      "city_reference_group_members",
      "city_references",
      "properties",
      "property_checkout_items",
      "property_emergency_contacts",
      "property_faqs",
      "property_listing_raw_data",
      "property_manual_items",
      "property_playbook_entries",
      "property_recommendations",
    ]);
  });
});

describe("B2.2 · nada de produção usa a capacidade multipropriedade ou o guard", () => {
  const prod = allSources(SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`));
  // B2.3: `turn-chain.ts` (cadeia fail-closed isolada) usa os tipos do dossiê; ela própria é
  // proibida em qualquer código de produção pelo `b23-isolation.test.ts`.
  const allowed = new Set(NEW_FILES.map((f) => path.join(ROOT, f)).concat([path.join(ROOT, "composer.ts"), path.join(ROOT, "turn-chain.ts"), path.join(ROOT, "shadow/telemetry.ts"),
    // B3.3 (Entrega 2): o executor Shadow usa o guard REAL (secret-scrub) e o io de produção do worker
    // carrega o dossiê do imóvel do turno (imports dinâmicos, só com o tick liberado). Lista nominal.
    path.join(ROOT, "shadow-exec/executor.ts"), path.join(ROOT, "shadow-exec/worker.server.ts"),
    // Copiloto (05/11/2026): a geração usa o guard REAL e carrega o Dossiê do imóvel do turno validado. Lista nominal.
    path.join(ROOT, "copilot/generate.server.ts"),
    // Memória do hóspede (06/11/2026): o processo pós-checkout passa todo texto (entrada e saída) pelo guard REAL. Lista nominal.
    path.join(SRC, "lib/guest-memory/contracts.ts"), path.join(SRC, "lib/guest-memory/prompt.ts"),
    // Aprendizado contínuo (Etapa 4, 08/11/2026): candidato com segredo é recusado pelo guard REAL. Lista nominal.
    path.join(ROOT, "learning/learning.ts"),
    // Bastidores (08/11/2026): o extrator dos sinais operacionais varre o texto do histórico com o guard REAL. Lista nominal.
    path.join(ROOT, "copilot/ops-extractor.server.ts")]));
  // B2.4: `shadow/telemetry.ts` só lê a VERSÃO da resolução de autoridade; proibido em produção (b24-isolation).
  it("nenhum arquivo fora dos módulos B2.2/composer importa dossiê, autorização de candidato ou secret-scrub", () => {
    const importers = prod
      .filter((f) => !allowed.has(f))
      .filter((f) => /guest-ai\/(secret-scrub|dossier\/|data\/property-dossier|data\/property-access)/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(importers).toEqual([]);
  });
  it("slot e loader de contexto seguem sem compositor e sem dossiê", () => {
    // `orchestrator/orchestrator.server.ts` não faz parte da entrega isolada do Copiloto
    for (const f of ["slot.server.ts", "context/conversation-context.server.ts"]) {
      expect(code(path.join(ROOT, f)), f).not.toMatch(/composer|secret-scrub|dossier\/|property-dossier|property-access/);
    }
  });
});
