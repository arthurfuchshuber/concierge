import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CORREÇÃO P0 (01/11/2026): o Dashboard travava no Safari/iOS (a tela não rolava e os cards não abriam no
 * primeiro toque). Foram três causas; este teste trava as três para não voltarem. Ele lê o código-fonte
 * porque o trecho vive dentro de um componente enorme que não dá para montar isolado no jsdom.
 */
const src = readFileSync(resolve(process.cwd(), "src/components/dashboard/OperationWorkspace.tsx"), "utf8");

describe("Dashboard Operacional — destravamento no mobile", () => {
  it("não existe ouvinte global de touchmove no document", () => {
    expect(src).not.toMatch(/document\.addEventListener\(\s*["']touchmove["']/);
  });

  it("a trava de rolagem do arrasto é local, no container do calendário", () => {
    expect(src).toMatch(/scroller\?\.addEventListener\("touchmove", lockScroll, \{ passive: false \}\)/);
    expect(src).toMatch(/scroller\?\.removeEventListener\("touchmove", lockScroll\)/);
  });

  it("o toque (pointerType touch) nunca inicia a seleção por arrasto", () => {
    expect(src).toMatch(/if \(ev\.pointerType === "touch"\) return;/);
    expect(src).not.toMatch(/window\.setTimeout\(begin, 350\)/);
  });

  it("o ouvinte de desmarcação fica na fase normal (sem captura)", () => {
    expect(src).toMatch(/document\.addEventListener\("pointerdown", onDown\);/);
    expect(src).not.toMatch(/addEventListener\("pointerdown", onDown, true\)/);
  });

  it("a prévia da foto do imóvel não usa <button> envolvendo outro botão", () => {
    const i = src.indexOf("function PropertyPhotoPeek(");
    const j = src.indexOf("const MESES_PT", i);
    // Sem os comentários (o texto explicativo cita "<button>" de propósito).
    const block = src.slice(i, j).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(block).toContain('role="button"');
    expect(block).toContain("tabIndex={0}");
    expect(block).not.toMatch(/<button[\s>]/);
    expect(block).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
  });
});
