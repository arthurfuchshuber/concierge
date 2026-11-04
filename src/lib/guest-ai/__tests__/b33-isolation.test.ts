/**
 * B3.3 · Entrega 2 — ISOLAMENTO ESTRUTURAL do Shadow (grafo TRANSITIVO de imports, estáticos e
 * dinâmicos, com resolução de `@/` e caminhos relativos). A ausência de import direto não é prova
 * suficiente: o fecho inteiro a partir de cada entrada do Shadow é comparado com uma lista FECHADA.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";

const SRC = path.resolve(__dirname, "../../..");
const REPO = path.resolve(SRC, "..");
const GA = path.join(SRC, "lib/guest-ai");
const rel = (f: string) => path.relative(REPO, f).split(path.sep).join("/");

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // pacote externo
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
  throw new Error(`import não resolvido: ${spec} em ${rel(from)}`);
}
function depsOf(f: string): string[] {
  const s = readFileSync(f, "utf8");
  const out: string[] = [];
  // `from "x"`, `import("x")` e import de efeito colateral `import "x"` (sem `from`)
  for (const m of s.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
    const r = resolveSpec(f, m[1]!);
    if (r) out.push(r);
  }
  return out;
}
function closure(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...depsOf(f));
  }
  return seen;
}
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const f = path.join(d, n);
    if (n === "node_modules" || n === "__tests__") return [];
    return statSync(f).isDirectory() ? walk(f) : /\.(ts|tsx)$/.test(n) ? [f] : [];
  });

const SHADOW_DIR = path.join(GA, "shadow-exec");
const ENTRIES = [
  ...readdirSync(SHADOW_DIR).map((n) => path.join(SHADOW_DIR, n)),
  path.join(GA, "data/shadow-store.server.ts"),
  path.join(GA, "data/shadow-candidates.server.ts"),
  path.join(GA, "data/conversation-ownership.server.ts"),
  path.join(SRC, "routes/api/public/guest-ai.shadow-tick.ts"),
];
const CLOSURE = closure(ENTRIES);
const outside = [...CLOSURE].filter((f) => !f.startsWith(GA + path.sep)).map(rel).sort();

describe("B3.3 · isolamento estrutural do Shadow (grafo transitivo)", () => {
  it("fora de guest-ai, o fecho do Shadow é EXATAMENTE esta lista fechada", () => {
    expect(outside).toEqual([
      "src/integrations/supabase/client.server.ts", // só via data/client.server.ts (único cliente administrativo)
      "src/integrations/supabase/types.ts",
      "src/lib/cron-auth.server.ts", // segredo do cron (rota)
      "src/lib/playbook-build.ts", // puros (dossiê F1, via loaders de leitura)
      "src/lib/playbook-catalog.ts",
      "src/lib/playbook-parts.ts",
      "src/lib/property-timezone.ts",
      "src/routes/api/public/guest-ai.shadow-tick.ts",
    ]);
  });
  it("o fecho NÃO alcança slot, envio, push, escrita de mensagens, storage, auditoria, aprendizado nem o gateway do SaaS", () => {
    const forbidden = [
      /lib\/guest-ai\/slot\.server\.ts$/,
      /lib\/guest-ai\/orchestrator\/orchestrator\.server\.ts$/,
      /lib\/guest-ai\/llm\/probe\.server\.ts$/,
      /channex-messages(-app)?\.server\.ts$/,
      /airbnb-direct-sender\.server\.ts$/,
      /whatsapp\.(server|functions)\.ts$/,
      /sinch-webhook\.ts$/,
      /guide-chat(-upload)?\.ts$/,
      /handoff\.functions\.ts$/,
      /guest-push\.server\.ts$/,
      /lib\/push\.server\.ts$/,
      /delivery-failure\.server\.ts$/,
      /chat-attachments\.functions\.ts$/,
      /lib\/chat\//,
      /lib\/audit\//,
      /audit-fn-middleware\.ts$/,
      /email\/send-app-email\.server\.ts$/,
      /channex-raw\.server\.ts$/,
      /lib\/llm\//,
      /playbook-entries|precedent|host-knowledge|learning/i,
    ];
    const hits = [...CLOSURE].map(rel).filter((f) => forbidden.some((re) => re.test(f)));
    expect(hits).toEqual([]);
  });
  it("nenhum código fora do Shadow importa o Shadow (só a rota desligada e o registro de rotas gerado)", () => {
    const importers = walk(SRC)
      .filter((f) => !f.startsWith(SHADOW_DIR + path.sep))
      .filter((f) => /guest-ai\/shadow-exec\/|["']\.\/(shadow-exec|worker\.server|tick\.server|gateway-generator\.server)/.test(readFileSync(f, "utf8")))
      .map(rel)
      .sort();
    // os adaptadores de dados DO PRÓPRIO Shadow leem os contratos (tipos/vocabulários); fora isso, só a rota
    expect(importers).toEqual(["src/lib/guest-ai/data/shadow-candidates.server.ts", "src/lib/guest-ai/data/shadow-store.server.ts", "src/routes/api/public/guest-ai.shadow-tick.ts"]);
  });
  it("nenhum canal importa a camada de dados do Shadow, o executor ou o gerador", () => {
    const channels = walk(SRC).filter((f) => /channex-messages|whatsapp|sinch|guide-chat|handoff|slot\.server/.test(f));
    expect(channels.length).toBeGreaterThan(3);
    for (const f of channels) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/shadow-exec|shadow-store|shadow-candidates|conversation-ownership/);
  });
  it("Shadow não escreve fora das RPCs: nenhum insert/update/upsert/delete/storage/channel/functions.invoke", () => {
    for (const f of ENTRIES) {
      const c = readFileSync(f, "utf8");
      expect(c, rel(f)).not.toMatch(/\.(insert|update|upsert|delete)\s*\(|\.storage\b|\.channel\s*\(|functions\.invoke|\.rpc\s*\(/);
    }
  });
  it("Shadow não loga, não serializa outcome/decisão e não ecoa mensagens de exceção", () => {
    for (const f of readdirSync(SHADOW_DIR).map((n) => path.join(SHADOW_DIR, n))) {
      const c = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(c, rel(f)).not.toMatch(/console\.|\.message\b|String\(\s*e(rr)?\s*\)|\.stack\b|JSON\.stringify\(\s*(outcome|decision|exec|narrow|prompt|record)\b/);
    }
  });
  it("o único JSON.stringify do Shadow é a decisão VALIDADA devolvida à cadeia (em memória)", () => {
    const hits = readdirSync(SHADOW_DIR).flatMap((n) => {
      const c = readFileSync(path.join(SHADOW_DIR, n), "utf8");
      return [...c.matchAll(/JSON\.stringify\(([^)]*)\)/g)].map((m) => `${n}:${m[1]}`);
    });
    expect(hits).toEqual(["gateway-generator.server.ts:result.json"]);
  });
  it("a rota é rota pública (fora do middleware que grava argumentos) e não uma server function", () => {
    const c = readFileSync(path.join(SRC, "routes/api/public/guest-ai.shadow-tick.ts"), "utf8");
    expect(c).toMatch(/createFileRoute\("\/api\/public\/guest-ai\/shadow-tick"\)/);
    expect(c).not.toMatch(/createServerFn|auditServerCalls/);
    expect(c).not.toMatch(/\bGET\s*:/); // só POST
  });
  it("tabelas Shadow nunca são lidas pela cadeia nem pelos loaders de contexto (não viram conhecimento)", () => {
    const noComments = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const users = walk(SRC).filter((f) => /guest_ai_shadow_/.test(noComments(f))).map(rel);
    expect(users).toEqual([]);
    for (const f of ["turn-chain.ts", "composer.ts", "context/conversation-context.server.ts", "context/builder.server.ts", "data/history.server.ts", "data/dossier.server.ts"]) {
      expect(readFileSync(path.join(GA, f), "utf8"), f).not.toMatch(/shadow_|shadow-store|shadow-exec/);
    }
  });
  it("o Shadow nunca produz GuestAiReply nem usa o contrato do slot", () => {
    for (const f of ENTRIES) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/GuestAiReply|requestGuestAiReply|slot\.server|NO_AI_HANDOFF_REASON/);
  });
  it("slot.server.ts byte a byte inalterado (SHA-256 homologado) e devolvendo null", async () => {
    const sha = createHash("sha256").update(readFileSync(path.join(GA, "slot.server.ts"))).digest("hex");
    expect(sha).toBe("39228fefe061fa64fa46e19242e2dc21b3078ab668ac5e354a27413f8b212917");
    for (const surface of ["airbnb", "whatsapp", "guide_chat"] as const) {
      await expect(requestGuestAiReply({ surface, conversationId: "c", messageId: "m" })).resolves.toBeNull();
    }
  });
  it("só o gerador emitido chama o Gateway dentro do Shadow; o executor recusa outro gerador; a cadeia segue sem Gateway", () => {
    const users = readdirSync(SHADOW_DIR).filter((n) => /generateGuestLlm/.test(readFileSync(path.join(SHADOW_DIR, n), "utf8")));
    expect(users).toEqual(["gateway-generator.server.ts"]);
    expect(readFileSync(path.join(SHADOW_DIR, "executor.ts"), "utf8")).toMatch(/if \(!isShadowGatewayGenerator\(d\["generator"\]\)\) return "generator_not_issued"/);
    expect(readFileSync(path.join(GA, "turn-chain.ts"), "utf8")).not.toMatch(/generateGuestLlm|gateway\.server/);
  });
  it("portão de liberação do tick é literal `false` nesta entrega", () => {
    expect(readFileSync(path.join(SHADOW_DIR, "tick.server.ts"), "utf8")).toMatch(/export const SHADOW_TICK_RELEASED = false as boolean;/);
  });
  it("o worker não tem acesso às RPCs administrativas (não se ativa, não autoriza retenção, não mexe no manifesto)", () => {
    const client = readFileSync(path.join(GA, "data/client.server.ts"), "utf8");
    const list = /SHADOW_RPC_FUNCTIONS = \[([\s\S]*?)\] as const/.exec(client)![1]!;
    for (const admin of ["shadow_transition", "shadow_configure", "shadow_authorize_retention", "shadow_manifest_add", "shadow_report", "shadow_purge_expired"]) expect(list).not.toContain(`"${admin}"`);
  });
});
