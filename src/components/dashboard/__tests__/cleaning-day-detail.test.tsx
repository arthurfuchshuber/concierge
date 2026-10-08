import { renderToStaticMarkup as rawRender } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
const renderToStaticMarkup = (el: ReactElement) =>
  rawRender(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);
import { describe, expect, it, vi } from "vitest";

// Permissão de editar controlada pelo teste (08/10/2026): a janela só mostra
// botão de edição quando o backend confirma a permissão.
const acesso = vi.hoisted(() => ({ liberado: false }));
vi.mock("@/lib/permissions/useAreaAccess", () => ({
  useAreaAccess: () => ({ ready: true, can: () => acesso.liberado }),
}));
import { CleaningDayDetailContent } from "../CleaningDayDetail";
import type { CleaningDayItem } from "@/lib/dashboard.functions";

const base: Omit<
  CleaningDayItem,
  "id" | "propertyId" | "propertyName" | "cleaningType" | "priceCents" | "pending"
> = {
  date: "2026-09-17",
  ownerName: "Dono",
  concludedAt: "2026-09-17T17:20:00.000Z",
  doneByName: "Maria",
  logId: null,
  reservationId: null,
};

const items: CleaningDayItem[] = [
  {
    ...base,
    id: "1",
    propertyId: "a",
    propertyName: "Casa A",
    cleaningType: "completa",
    priceCents: 34500,
    pending: true,
  },
  {
    ...base,
    id: "2",
    propertyId: "b",
    propertyName: "Studio B",
    cleaningType: "normal",
    priceCents: 12000,
    pending: false,
  },
  {
    ...base,
    id: "3",
    propertyId: "b",
    propertyName: "Studio B",
    cleaningType: "normal",
    priceCents: 12000,
    pending: false,
  },
  {
    ...base,
    id: "4",
    propertyId: "c",
    propertyName: "Outro dia",
    cleaningType: "normal",
    priceCents: 9900,
    pending: false,
    date: "2026-09-16",
  },
];

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("CleaningDayDetailContent — tabela do dia", () => {
  it("limpezas: uma linha por limpeza, só do dia; pendente fora do total", () => {
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent
        date="2026-09-17"
        source={{ mode: "done", items }}
        caretX={40}
        onClose={() => {}}
      />,
    );
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr/g)).toHaveLength(3);
    const t = text(html);
    expect(t).toContain("Quinta, 17/09");
    expect(t).toContain("3 limpezas concluídas");
    expect(t).not.toContain("Outro dia");
    expect(t).toContain("em análise");
    expect(t).toContain("14:20 · Maria");
    expect(t).toMatch(/R\$\s240,00/);
    expect(t).toMatch(/\+R\$\s345,00 em análise/);
  });

  it("custo: agrupa por imóvel, maior valor primeiro, pendente por último", () => {
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent
        date="2026-09-17"
        source={{ mode: "cost", items }}
        caretX={null}
        onClose={() => {}}
      />,
    );
    const rows =
      html
        .match(/<tbody>[\s\S]*<\/tbody>/)?.[0]
        .split("<tr")
        .slice(1) ?? [];
    expect(rows).toHaveLength(2);
    expect(text(rows[0])).toMatch(/Studio B .*2 .*Normal .*R\$\s240,00/);
    expect(text(rows[1])).toContain("Casa A");
  });

  it("previsão: horário, hóspede e estimativa", () => {
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent
        date="2026-09-19"
        source={{
          mode: "forecast",
          items: [
            {
              id: "x",
              date: "2026-09-19",
              propertyName: "Casa A",
              ownerName: null,
              timeLabel: "11:00",
              guestName: "Ana",
              estimateCents: 12000,
            },
          ],
        }}
        caretX={10}
        onClose={() => {}}
      />,
    );
    const t = text(html);
    expect(t).toContain("1 checkout previsto");
    expect(t).toContain("11:00");
    expect(t).toContain("Ana");
    expect(t).toMatch(/Estimativa · limpeza normal R\$\s120,00/);
  });

  it("limpezas: data + hora + quem fez e proprietário(a) do imóvel; sem permissão não há botão", () => {
    acesso.liberado = false;
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent
        date="2026-09-17"
        source={{
          mode: "done",
          items: [
            { ...items[1], ownerName: "Patrícia Souza" },
            { ...items[2], ownerName: "Clayton Lima" },
          ],
        }}
        caretX={null}
        onClose={() => {}}
      />,
    );
    const t = text(html);
    expect(t).toContain("Proprietária do Imóvel: Patrícia");
    expect(t).toContain("Proprietário do Imóvel: Clayton");
    expect(t).toContain("17/09/2026 · 14:20 · Maria");
    expect(t).toContain("Tipo da Limpeza: Normal");
    expect(html).not.toContain("<button");
  });

  it("limpezas: com permissão, tipo e valor viram botão (só o dado)", () => {
    acesso.liberado = true;
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent
        date="2026-09-17"
        source={{ mode: "done", items: [items[1]] }}
        caretX={null}
        onClose={() => {}}
      />,
    );
    const botoes = html.match(/<button[\s\S]*?<\/button>/g) ?? [];
    expect(botoes.some((b) => text(b).trim() === "Normal")).toBe(true);
    expect(botoes.some((b) => /R\$\s120,00/.test(text(b)))).toBe(true);
    acesso.liberado = false;
  });
});
