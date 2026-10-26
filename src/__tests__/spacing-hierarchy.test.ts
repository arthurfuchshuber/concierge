import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");

describe("hierarquia única de espaçamento vertical", () => {
  const css = read("styles.css");

  it("os dois tokens vivem na raiz (24px / 10px)", () => {
    expect(css).toMatch(/--ds-block-gap:\s*24px/);
    expect(css).toMatch(/--ds-grid-gap:\s*10px/);
  });

  it("menu → 1º bloco = bloco − grade, derivado dos tokens", () => {
    expect(css).toMatch(/margin-bottom:\s*calc\(var\(--ds-block-gap\) - var\(--ds-grid-gap\)\)/);
  });

  it("as páginas usam o invólucro `ds-page` e os shells aplicam `ds-page-head`", () => {
    for (const f of [
      "components/dashboard/OperationWorkspace.tsx",
      "components/dashboard/RecordsWorkspace.tsx",
      "routes/_authenticated/admin.guias.tsx",
      "routes/_authenticated/admin.proprietarios.tsx",
    ]) {
      expect(read(f)).toMatch(/className="ds-page[ "]/);
    }
    expect(read("components/ds/PageShell.tsx")).toContain("ds-page-head");
    expect(read("components/dashboard/OperationWorkspace.tsx")).toContain("ds-page-heading ds-page-head");
  });

  it("sem margem negativa nem mt/mb soltos entre os blocos de Guias", () => {
    const g = read("routes/_authenticated/admin.guias.tsx");
    expect(g).not.toContain("-mt-3.5");
    expect(g).not.toContain('className="mb-6 ds-surface');
    expect(read("components/dashboard/OperationWorkspace.tsx")).not.toContain("ds-lead-block");
  });

  it("SectionLabel não carrega padding/margem superior próprios", () => {
    const chrome = read("components/dashboard/panel-chrome.tsx");
    const m = chrome.match(/export function SectionLabel[\s\S]*?return \(\s*<div className=\{`([^`]*)`\}/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/\b(pt|mt|py|my|p|m)-/);
  });
});
