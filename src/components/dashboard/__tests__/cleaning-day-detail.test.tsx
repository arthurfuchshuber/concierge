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
// Prestador atribuído controlado pelo teste: o avatar vira um botãozinho com as
// iniciais e o hook devolve o nome do prestador (null = "?").
const prestador = vi.hoisted(() => ({ nome: null as string | null }));
vi.mock("@/components/dashboard/CleaningProviderAvatar", () => ({
  useCleaningProviderName: () => prestador.nome,
  CleaningProviderAvatar: () => (
    <span data-provider="">
      {prestador.nome ? prestador.nome.split(" ").map((p) => p[0]).join("") : "?"}
    </span>
  ),
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
    expect(t).toContain("Data de Saída: 19/09/2026");
    expect(t).toContain("Horário de Saída: 11:00");
    expect(t).not.toContain("Ana");
    expect(t).toMatch(/Estimativa · Limpeza Normal R\$\s120,00/);
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
    expect(t).toContain("Patrícia");
    expect(t).toContain("Clayton");
    expect(t).toContain("17/09/2026 · 14:20 · Maria");
    expect(t).toContain("Tipo da Limpeza: Normal");
    // Sem permissão não há botão de edição (só o "Fechar").
    expect(html).not.toContain("Alterar valor");
    expect(html).not.toContain("Mudar para");
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
    // Moldura de botão editável (fundo, borda, cantos e lápis) em tipo e valor.
    const editaveis = botoes.filter((b) => /Mudar para|Alterar valor/.test(b));
    expect(editaveis).toHaveLength(2);
    for (const b of editaveis) {
      for (const c of ["border", "rounded-[0.3rem]", "bg-card"]) expect(b).toContain(c);
      expect(b).toContain("lucide-pencil");
    }
    acesso.liberado = false;
  });

  it("sem expansividade: tudo nasce visível, sem seta, com o valor na linha da data", () => {
    acesso.liberado = false;
    for (const mode of ["done", "cost"] as const) {
      const html = renderToStaticMarkup(
        <CleaningDayDetailContent date="2026-09-17" source={{ mode, items }} caretX={null} onClose={() => {}} />,
      );
      expect(html).not.toContain("aria-expanded");
      expect(html).not.toContain("grid-rows-[0fr]");
      expect(html).not.toContain("pl-[30px]");
      expect(html).not.toContain("Valor do Serviço");
    }
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent date="2026-09-17" source={{ mode: "done", items: [items[1]] }} caretX={null} onClose={() => {}} />,
    );
    // Linha inferior: data/hora à esquerda e o valor à direita, na mesma linha.
    const linha = html.match(/<div data-bottom-row[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(text(linha)).toMatch(/17\/09\/2026 · 14:20 · Maria .*R\$\s120,00/);
    expect(linha).toContain("min-w-0");
  });

  it("serviços extras: mesma linha inferior, com o valor à direita", () => {
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent
        date="2026-09-17"
        source={{
          mode: "done",
          items: [],
          extras: [
            {
              id: "e1",
              date: "2026-09-17",
              propertyId: "a",
              propertyName: "Casa A",
              ownerName: null,
              ownerPhone: null,
              ownerPhoneCountry: null,
              situation: "manutencao",
              situationName: "Manutenção",
              title: "Troca do chuveiro",
              priceCents: 8000,
              concludedAt: "2026-09-17T17:20:00.000Z",
              doneByName: "João",
              logId: null,
              reservationId: null,
            },
          ],
        }}
        caretX={null}
        onClose={() => {}}
      />,
    );
    const t = text(html);
    expect(t).toContain("Situação: Manutenção");
    expect(t).toContain("Troca do chuveiro");
    const linha = html.match(/<div data-bottom-row[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(text(linha)).toMatch(/17\/09\/2026 · 14:20 · João .*R\$\s80,00/);
    expect(html).not.toContain("aria-expanded");
  });

  describe("desduplicação de quem concluiu × prestador", () => {
    const comPrestador = { ...items[1], logId: "11111111-1111-1111-1111-111111111111" };
    const render = (doneByName: string) =>
      text(
        renderToStaticMarkup(
          <CleaningDayDetailContent
            date="2026-09-17"
            source={{ mode: "done", items: [{ ...comPrestador, doneByName }] }}
            caretX={null}
            onClose={() => {}}
          />,
        ),
      );

    it("mesma pessoa: só data/hora + iniciais, sem repetir o nome", () => {
      prestador.nome = "Esther Villar";
      const t = render("Esther Villar");
      expect(t).toContain("17/09/2026 · 14:20 EV");
      expect(t).not.toContain("Esther Villar");
    });

    it("mesma pessoa com acento/caixa diferentes também não repete", () => {
      prestador.nome = "Esther Villar";
      expect(render("esther  villár")).not.toMatch(/villar/i);
    });

    it("pessoas diferentes: nome de quem concluiu + iniciais do prestador", () => {
      prestador.nome = "Esther Villar";
      expect(render("Anfitrião Sigma")).toContain("17/09/2026 · 14:20 · Anfitrião Sigma EV");
    });

    it("prestador ainda indefinido: nome de quem concluiu + ?", () => {
      prestador.nome = null;
      expect(render("Anfitrião Sigma")).toContain("17/09/2026 · 14:20 · Anfitrião Sigma ?");
    });
  });
});
