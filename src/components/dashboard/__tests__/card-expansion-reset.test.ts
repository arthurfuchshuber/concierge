/**
 * Expansão dos cards (pedido explícito, 08/11/2026):
 *  · "Retornar ao status anterior" não pode abrir o detalhamento sozinho;
 *  · "saiu da tela já tem que recolher": fechar a janela, ou o card sair da lista, recolhe.
 * O OperationWorkspace é grande demais para montar aqui; a auditoria trava as três peças da regra.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(process.cwd(), "src/components/dashboard/OperationWorkspace.tsx"), "utf8");
const between = (a: string, b: string) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));

describe("expansão dos cards", () => {
  it("janela (KpiCard) tem expansão própria, zerada ao fechar", () => {
    const kpi = between("function KpiCard(", "\nfunction ");
    expect(kpi).toContain("const [windowExpandedId, setWindowExpandedId] = useState<string | null>(null)");
    expect(kpi).toMatch(/if \(!open\) setWindowExpandedId\(null\)/);
    expect(kpi).toMatch(/expandedId=\{windowExpandedId\}\s+onExpandedChange=\{setWindowExpandedId\}/);
  });

  it("card que sai da lista não deixa a expansão guardada", () => {
    expect(src).toMatch(/if \(openId && !rows\.some\(\(r\) => r\.logId === openId\)\) setOpenId\(null\)/);
  });

  it("toque fantasma após o menu ⋮ ou a confirmação de reverter não expande", () => {
    expect(src).toContain("if (Date.now() < suppressToggleUntil.current) return;");
    expect(src).toMatch(/const ok = window\.confirm\(revertConfirmLabel\);\s+suppressToggle\(\);/);
    expect(src).toMatch(/onOpenChange=\{\(o\) => \{\s+if \(!o\) suppressToggle\(\);/);
  });
});
