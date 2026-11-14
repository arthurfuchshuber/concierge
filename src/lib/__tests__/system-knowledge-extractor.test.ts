// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("extrator de conhecimento", () => {
  it("ignora arquivos de teste e limita a 1600 em frases/parágrafos completos", () => {
    const root = mkdtempSync(join(tmpdir(), "knowledge-extractor-"));
    try {
      mkdirSync(join(root, "src/lib/__tests__"), { recursive: true });
      mkdirSync(join(root, "docs/assistente"), { recursive: true });
      const rationale = `Sempre preserva a regra porque evita falhas. ${"Texto adicional. ".repeat(15)}`;
      for (const file of ["hidden.test.ts", "hidden.test.tsx", "hidden.spec.ts", "hidden.spec.tsx", "__tests__/hidden.ts"])
        writeFileSync(join(root, "src/lib", file), `/** ${rationale} */\nexport const hidden = true;`);
      writeFileSync(join(root, "src/lib/visible.ts"), `/** ${rationale} */\nexport const visible = true;`);
      writeFileSync(join(root, "docs/assistente/sentence.md"), `# Sentence\n${"Frase completa. ".repeat(120)}`);
      writeFileSync(join(root, "docs/assistente/paragraph.md"), `# Paragraph\n${"a".repeat(900)}\n\n${"b".repeat(900)}`);
      writeFileSync(join(root, "docs/assistente/short.md"), "# Short\nNão muda este texto.");
      const run = spawnSync(process.execPath, [resolve("scripts/extract-system-knowledge.mjs")], { cwd: root, encoding: "utf8" });
      expect(run.status, run.stderr).toBe(0);
      const generated = readFileSync(join(root, "src/generated/system-knowledge.ts"), "utf8");
      const docs = JSON.parse(generated.split("export const SYSTEM_KNOWLEDGE: GeneratedSystemDoc[] = ")[1].trim().replace(/;$/, "")) as Array<{ doc_key: string; content: string }>;
      expect(docs).toHaveLength(4);
      expect(docs.some(d => d.doc_key.includes("hidden"))).toBe(false);
      expect(docs.every(d => d.content.length <= 1600)).toBe(true);
      expect(docs.find(d => d.doc_key === "guide:sentence")?.content).toMatch(/Frase completa\. Frase completa\.…$/);
      expect(docs.find(d => d.doc_key === "guide:paragraph")?.content).toBe(`${"a".repeat(900)}…`);
      expect(docs.find(d => d.doc_key === "guide:short")?.content).toBe("Não muda este texto.");
      expect(run.stdout).toContain("truncados=2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});