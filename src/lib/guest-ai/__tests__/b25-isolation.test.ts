/**
 * B2.5 · isolamento estático: lote, identidade de envio e leitura de compromissos no texto são
 * puros (sem banco, rede, Gateway, envio, log, relógio próprio); só as camadas isoladas os usam;
 * Orchestrator e slot intocados; NO_COMPOSER segue ativo; nenhuma peça da B3 foi antecipada.
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_COMPOSER } from "@/lib/guest-ai/orchestrator/orchestrator.server";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(ROOT, "..", "..");
const NEW_FILES = ["batch/message-batch.ts", "policy/sender-identity.ts", "validation/commitment-text.ts"];
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function allSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__") return [];
    if (statSync(full).isDirectory()) return allSources(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}
const prod = () => allSources(SRC);
const importersOf = (mod: string) =>
  prod()
    .filter((f) => new RegExp(`guest-ai/${mod}["']|\\.\\.?/${mod.split("/").pop()}["']|\\./${mod}["']`).test(readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f))
    .filter((f) => !f.endsWith(`${mod}.ts`))
    .sort();

describe("B2.5 · módulos novos puros e passivos", () => {
  for (const rel of NEW_FILES) {
    it(`${rel}: sem Gateway/LLM, rede, banco, credenciais, escrita, envio, fila, log ou relógio próprio`, () => {
      const c = code(path.join(ROOT, rel));
      expect(c).not.toMatch(/generateGuestLlm|guest-ai\/llm|@\/lib\/llm|lib\/llm\/|gateway\.server|providers\//);
      expect(c).not.toMatch(/\bfetch\(|ai\.gateway|openai|anthropic|generativelanguage/i);
      expect(c).not.toMatch(/client\.server|getGuestAiDb|supabase|guest-ai\/data\/|guest-ai\/context\//);
      expect(c).not.toMatch(/credentials\.server|fetchSensitiveCredentials|issueCredentialGrant|PROPERTY_CREDENTIAL_COLUMNS/);
      expect(c).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(c).not.toMatch(/postMessage|sendGuest|send_message|trySendAsPreferredSender|sendMessage\(/);
      expect(c).not.toMatch(/setTimeout|setInterval|queue\.|enqueue|\bcron\b/);
      expect(c).not.toMatch(/console\.(log|info|warn|error)/);
      expect(c).not.toMatch(/Date\.now|new Date\(\)|Math\.random|performance\.now/);
    });
  }
  it("identidade de envio nunca concede autorização nem marca envio (literais fixos no tipo)", () => {
    const c = code(path.join(ROOT, "policy/sender-identity.ts"));
    expect(c).toMatch(/sendAuthorization: "not_granted"/);
    expect(c).not.toMatch(/sendAuthorization: "granted"|delivery: "sent"/);
    expect(c).not.toMatch(/channex_message|fallback/i);
  });
  it("debounce é só contrato: nenhum temporizador real no lote", () => {
    expect(code(path.join(ROOT, "batch/message-batch.ts"))).not.toMatch(/setTimeout|clearTimeout|AbortSignal\.timeout/);
  });
  it("caseAssessments NÃO foi implementado (exige aprovação específica)", () => {
    for (const f of allSources(ROOT)) expect(code(f), f).not.toMatch(/caseAssessments/);
  });
});

describe("B2.5 · só as camadas isoladas usam as peças novas", () => {
  // B3.1/B3.2: + coletor, telemetria do coletor e loaders reais somente leitura (diretriz de 03/11). Listas fechadas.
  it("lote", () => expect(importersOf("batch/message-batch")).toEqual(["batch/collector.ts", "batch/telemetry.ts", "composer.ts", "data/collector.server.ts", "shadow/telemetry.ts", "turn-chain.ts"]));
  it("identidade de envio", () => expect(importersOf("policy/sender-identity")).toEqual(["data/sender-identity.server.ts", "shadow/telemetry.ts", "turn-chain.ts"]));
  it("leitura de compromissos no texto", () => expect(importersOf("validation/commitment-text")).toEqual(["shadow/telemetry.ts", "validation/semantic-validator.ts"]));
  it("nada fora de src/lib/guest-ai importa a cadeia, o lote ou a identidade", () => {
    const outside = prod()
      .filter((f) => !f.startsWith(ROOT + path.sep))
      .filter((f) => /guest-ai\/(turn-chain|batch\/|policy\/sender-identity|validation\/commitment-text|shadow\/)/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(outside).toEqual([]);
  });
});

describe("B2.5 · fluxo real intocado", () => {
  it("orchestrator.server.ts e slot.server.ts sem diff desde a B2.4; slot devolve null; NO_COMPOSER ativo", () => {
    const diff = execSync("git diff --name-only 4c1adb5307147ef4998ab4fd735acf21304e4f7b -- src/lib/guest-ai/orchestrator/orchestrator.server.ts src/lib/guest-ai/slot.server.ts", { cwd: path.resolve(SRC, ".."), encoding: "utf8" });
    expect(diff.trim()).toBe("");
    expect(code(path.join(ROOT, "orchestrator/orchestrator.server.ts"))).toMatch(/deps\.composePrompt \?\? NO_COMPOSER/);
    expect(NO_COMPOSER(null as never, null as never)).toBeNull();
    expect(code(path.join(ROOT, "slot.server.ts"))).not.toMatch(/turn-chain|composer|shadow\/|batch\/|sender-identity|commitment-text/);
  });
  it("nenhuma migration nova ou alteração fora de src/lib/guest-ai desde a B2.4", () => {
    const changed = execSync("git diff --name-only 4c1adb5307147ef4998ab4fd735acf21304e4f7b HEAD; git diff --name-only; git ls-files --others --exclude-standard", { cwd: path.resolve(SRC, ".."), encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.startsWith("src/lib/guest-ai/") && f !== "AGENTS.md");
    // B3.1: única migration autorizada (lease distribuído, diretriz de 03/11) — nada mais fora do módulo.
    expect(changed).toEqual(["supabase/migrations/20261104000000_guest_ai_conversation_leases.sql"]);
  });
});
