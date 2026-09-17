import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CleaningDayDetail } from "../CleaningDayDetail";
import type { CleaningDayItem } from "@/lib/dashboard.functions";

const base: Omit<
  CleaningDayItem,
  "id" | "propertyId" | "propertyName" | "cleaningType" | "priceCents" | "pending"
> = {
  date: "2026-09-17",
  ownerName: "Dono",
  concludedAt: "2026-09-17T17:20:00.000Z",
  doneByName: "Maria",
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

describe("CleaningDayDetail — tabela do dia", () => {
  it("limpezas: uma linha por limpeza, só do dia; pendente fora do total", () => {
    const html = renderToStaticMarkup(
      <CleaningDayDetail
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
      <CleaningDayDetail
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
      <CleaningDayDetail
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
});
