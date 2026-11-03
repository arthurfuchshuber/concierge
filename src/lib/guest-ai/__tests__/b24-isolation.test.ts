/**
 * B2.4 · isolamento estático: módulos novos puros/passivos, sem Gateway, rede, banco, escrita,
 * envio ou log; nada de produção importa o harness do shadow; Orchestrator e slot intocados.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_COMPOSER } from "@/lib/guest-ai/orchestrator/orchestrator.server";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(ROOT, "..", "..");
const NEW_FILES = ["policy/stay-authorizations.ts", "dossier/authority.ts", "shadow/llm-mock.ts", "shadow/telemetry.ts", "shadow/harness.ts"];
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function allSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__") return [];
    if (statSync(full).isDirectory()) return allSources(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}
const prod = () => allSources(SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`));

describe("B2.4 · módulos novos isolados", () => {
  for (const rel of NEW_FILES) {
    it(`${rel}: sem Gateway/LLM, rede, banco, credenciais, escrita, envio ou log`, () => {
      const c = code(path.join(ROOT, rel));
      expect(c).not.toMatch(/generateGuestLlm|guest-ai\/llm|@\/lib\/llm|lib\/llm\/|gateway\.server|providers\//);
      expect(c).not.toMatch(/\bfetch\(|ai\.gateway|openai|anthropic|generativelanguage/i);
      expect(c).not.toMatch(/client\.server|getGuestAiDb|supabase|guest-ai\/data\/|guest-ai\/context\//);
      expect(c).not.toMatch(/credentials\.server|fetchSensitiveCredentials|issueCredentialGrant|PROPERTY_CREDENTIAL_COLUMNS/);
      expect(c).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(c).not.toMatch(/whatsapp|channex|postMessage|sendGuest|send_message/i);
      expect(c).not.toMatch(/console\.(log|info|warn|error)/);
    });
  }
  it("verificação de autorizações, autoridade, posse humana, telemetria e mock são puros (sem relógio próprio nem aleatoriedade)", () => {
    for (const rel of ["policy/stay-authorizations.ts", "dossier/authority.ts", "orchestrator/case-ownership.ts", "shadow/telemetry.ts", "shadow/llm-mock.ts"]) {
      expect(code(path.join(ROOT, rel)), rel).not.toMatch(/Date\.now|new Date\(\)|Math\.random|performance\.now/);
    }
  });
  it("policy/ continua sem importar data/ (camada de decisão pura)", () => {
    expect(code(path.join(ROOT, "policy/stay-authorizations.ts"))).not.toMatch(/guest-ai\/data|from "\.\.\/data/);
  });
});

describe("B2.4 · nada de produção ativa o shadow nem as novas camadas", () => {
  it("nenhum arquivo fora do próprio shadow importa harness, mock ou telemetria do shadow", () => {
    const importers = prod()
      .filter((f) => !f.includes(`${path.sep}shadow${path.sep}`))
      .filter((f) => /guest-ai\/shadow\/(harness|llm-mock|telemetry)["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(importers).toEqual([]);
  });
  it("verificação de autorizações de horário só é usada pelas camadas isoladas (nunca pelo fluxo real)", () => {
    const importers = prod()
      .filter((f) => /guest-ai\/policy\/stay-authorizations["']|\.\/policy\/stay-authorizations["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(importers).toEqual(["composer.ts", "shadow/telemetry.ts", "turn-chain.ts", "validation/semantic-validator.ts"]);
  });
  it("Orchestrator, slot e contexto não importam nada da B2.3/B2.4; NO_COMPOSER segue o padrão", () => {
    for (const f of ["orchestrator/orchestrator.server.ts", "slot.server.ts", "context/conversation-context.server.ts", "context/builder.server.ts"]) {
      expect(code(path.join(ROOT, f)), f).not.toMatch(/turn-chain|semantic-validator|stay-authorizations|dossier\/authority|shadow\/|composer/);
    }
    expect(code(path.join(ROOT, "orchestrator/orchestrator.server.ts"))).toMatch(/deps\.composePrompt \?\? NO_COMPOSER/);
    expect(NO_COMPOSER(null as never, null as never)).toBeNull();
  });
});
