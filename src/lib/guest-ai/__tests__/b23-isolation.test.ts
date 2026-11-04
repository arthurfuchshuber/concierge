/**
 * B2.3 · segurança e isolamento: nenhum segredo em logs/erros/auditoria, nenhum conteúdo original
 * recuperado após sanitização, nenhuma chamada ao Gateway, nenhuma escrita, nenhum envio e nenhuma
 * importação que permita ativação acidental do fluxo real.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runTurnChain, type ChainAudit } from "@/lib/guest-ai/turn-chain";
import { NO_COMPOSER } from "@/lib/guest-ai/orchestrator/orchestrator.server";
import { parseDecisionText } from "@/lib/guest-ai/orchestrator/decision";
import { harness, history, turn, v4 } from "./helpers/b23-chain";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(ROOT, "..", "..");
const NEW_FILES = ["turn-chain.ts", "validation/semantic-validator.ts"];
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function allSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__") return [];
    if (statSync(full).isDirectory()) return allSources(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

/** Segredos sintéticos plantados em várias fontes. */
const SECRETS = ["4821", "Praia2024", "7391", "sk-live-SYNTHETIC0123456789abcdef", "5530"];

describe("B2.3 · nenhum segredo em auditoria, recusa ou erro", () => {
  it("histórico com segredos + saída do modelo com segredo ⇒ recusa; auditoria e resultado sem nenhum segredo", async () => {
    const logs: ChainAudit[] = [];
    const out = v4({ reply: "Seu acesso: código do cofre 7391.", handoff: { needed: true, question: "Token sk-live-SYNTHETIC0123456789abcdef vazou?", urgency: "high" }, strategy: "answer_and_handoff" });
    const h = harness(out, {
      loadHistory: async () => history("A senha 5530 não abre", [{ content: "A senha da porta é 4821." }, { content: "A senha do Wi-Fi é Praia2024" }]),
      log: (a) => logs.push(a),
    });
    const r = await runTurnChain({ turn: turn(), traceId: "sec-1" }, h.deps);
    expect(r.kind).toBe("refused");
    const dump = JSON.stringify({ r, logs });
    for (const s of SECRETS) expect(dump, s).not.toContain(s);
    // o modelo recebeu só o texto saneado (nada do original recuperado)
    const sent = JSON.stringify(h.calls.prompts);
    for (const s of ["4821", "Praia2024", "5530"]) expect(sent, s).not.toContain(s);
  });
  it("auditoria é lista branca: só códigos, versões, contagens e duração", async () => {
    const h = harness(v4());
    await runTurnChain({ turn: turn(), traceId: "sec-2" }, h.deps);
    const a = h.calls.logs[0]!;
    expect(Object.keys(a).sort()).toEqual(
      // B2.4: + timings, interruption, decision (resumo só com enums/contagens) e checks (códigos/contagens)
      ["category", "chainVersion", "checks", "code", "composerVersion", "contractVersion", "decision", "decisionVersion", "durationMs", "event", "guard", "interruption", "outcome", "parserVersion", "semanticBlocks", "semanticValidatorVersion", "stage", "stagesCompleted", "structuralBlocks", "structuralValidatorVersion", "timings", "traceId"].sort(),
    );
    expect(JSON.stringify(a)).not.toContain("check-in");
  });
  it("erros do parser nunca ecoam conteúdo da saída", () => {
    for (const bad of ['{"senha 7391": 1}', '{"strategy":"answer","reply":"código 7391', "7391 texto"]) {
      const r = parseDecisionText(bad);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain("7391");
    }
  });
  it("log que lança não derruba a cadeia nem muda o resultado", async () => {
    const h = harness(v4(), { log: () => { throw new Error("log"); } });
    expect((await runTurnChain({ turn: turn(), traceId: "sec-3" }, h.deps)).kind).toBe("reply");
  });
  it("nada é enviado nem chamado fora das dependências injetadas (sem fetch)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const h = harness(v4());
    const r = await runTurnChain({ turn: turn(), traceId: "sec-4" }, h.deps);
    expect(spy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ delivery: "not_sent", effectsExecuted: false });
    spy.mockRestore();
  });
});

describe("B2.3 · isolamento estático", () => {
  for (const rel of NEW_FILES) {
    it(`${rel}: sem Gateway/LLM, rede, banco, credenciais, escrita, envio ou tabelas legadas`, () => {
      const c = code(path.join(ROOT, rel));
      expect(c).not.toMatch(/generateGuestLlm|guest-ai\/llm|@\/lib\/llm|lib\/llm\/|gateway\.server|providers\//);
      expect(c).not.toMatch(/\bfetch\(|ai\.gateway|openai|anthropic|generativelanguage/i);
      expect(c).not.toMatch(/client\.server|getGuestAiDb|supabase|guest-ai\/data\/|guest-ai\/context\//);
      expect(c).not.toMatch(/credentials\.server|fetchSensitiveCredentials|issueCredentialGrant|PROPERTY_CREDENTIAL_COLUMNS/);
      expect(c).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(c).not.toMatch(/sendMessage|whatsapp|airbnb.*send|channex|postMessage/i);
      expect(c).not.toMatch(/console\.(log|info|warn|error)/);
    });
  }
  it("validador semântico é puro (sem relógio nem aleatoriedade)", () => {
    expect(code(path.join(ROOT, "validation/semantic-validator.ts"))).not.toMatch(/Date\.now|new Date|Math\.random|performance\.now/);
  });
  it("nenhum código de produção importa a cadeia ou o validador semântico (só a própria cadeia)", () => {
    const prod = allSources(SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`));
    const importers = prod
      .filter((f) => /guest-ai\/(turn-chain|validation\/semantic-validator)["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    // B2.4: o harness passivo do shadow reutiliza a cadeia (sem segunda cadeia); ele próprio é proibido em produção.
    // B3.3 (Entrega 2): o executor Shadow reutiliza a MESMA cadeia (sem segunda cadeia); contratos/extrator só
    // tipos, worker só a versão. Todos fora do slot e dos canais (b33-isolation prova o grafo transitivo).
    expect(importers.sort()).toEqual(["shadow-exec/contracts.ts", "shadow-exec/executor.ts", "shadow-exec/extract.ts", "shadow-exec/worker.server.ts", "shadow/harness.ts", "shadow/telemetry.ts", "turn-chain.ts"]);
  });
  it("Orchestrator e slot seguem sem a cadeia; NO_COMPOSER continua o padrão", () => {
    for (const f of ["orchestrator/orchestrator.server.ts", "slot.server.ts", "context/conversation-context.server.ts"]) {
      expect(code(path.join(ROOT, f)), f).not.toMatch(/turn-chain|semantic-validator|composer/);
    }
    expect(code(path.join(ROOT, "orchestrator/orchestrator.server.ts"))).toMatch(/deps\.composePrompt \?\? NO_COMPOSER/);
    expect(NO_COMPOSER(null as never, null as never)).toBeNull();
  });
});
