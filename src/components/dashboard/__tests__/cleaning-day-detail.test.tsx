import { renderToStaticMarkup as rawRender } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
const renderToStaticMarkup = (el: ReactElement) =>
  rawRender(
    <QueryClientProvider client={new QueryClient()}>
      <Dialog open>{el}</Dialog>
    </QueryClientProvider>,
  );
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// Permissão de editar controlada pelo teste (08/10/2026): a janela só mostra
// botão de edição quando o backend confirma a permissão.
const acesso = vi.hoisted(() => ({ liberado: false }));
vi.mock("@/lib/permissions/useAreaAccess", () => ({
  useAreaAccess: () => ({ ready: true, can: () => acesso.liberado }),
}));
// Prestador atribuído controlado pelo teste: a etiqueta azul mostra o nome
// (null = "Sem prestador") e só vira botão quando a limpeza tem reserva ligada.
const prestador = vi.hoisted(() => ({ nome: null as string | null }));
vi.mock("@/components/dashboard/CleaningProviderAvatar", () => ({
  useCleaningProviderControl: (_p: string, logId: string, reservationId: string | null) => ({
    providers: [],
    currentId: null,
    currentName: prestador.nome,
    editable: !!logId || !!reservationId,
    set: async () => {},
  }),
}));
import { CleaningDayDetailContent } from "../CleaningDayDetail";
import { WINDOW_HEADER_CLASS, WINDOW_SUBTITLE_CLASS, WINDOW_TITLE_CLASS } from "../window-header";
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
      />,
    );
    expect(html.match(/snap-start border-b/g)).toHaveLength(3);
    const t = text(html);
    expect(t).toContain("Quinta, 17/09");
    expect(t).toContain("3 limpezas concluídas");
    expect(t).not.toContain("Outro dia");
    expect(t).toContain("em análise");
    expect(t).toContain("17/09 · 14:20");
    expect(t).toMatch(/R\$\s240,00/);
    expect(t).toMatch(/\+R\$\s345,00 em análise/);
  });

  it("custo: agrupa por imóvel, maior valor primeiro, pendente por último", () => {
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent
        date="2026-09-17"
        source={{ mode: "cost", items }}
        caretX={null}
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
      />,
    );
    const t = text(html);
    expect(t).toContain("1 checkout previsto");
    expect(t).toContain("Data de Saída: 19/09/2026");
    expect(t).toContain("Horário de Saída: 11:00");
    expect(t).not.toContain("Ana");
    expect(t).toMatch(/Estimativa · Limpeza Normal R\$\s120,00/);
  });

  it("limpezas (mockup Fin-01): título + valor, proprietário e data · hora com as etiquetas", () => {
    acesso.liberado = false;
    prestador.nome = "Esther Villar";
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent
        date="2026-09-17"
        source={{
          mode: "done",
          items: [
            { ...items[1], ownerName: "Patrícia Souza", logId: "11111111-1111-1111-1111-111111111111" },
            { ...items[2], ownerName: "Clayton Lima" },
          ],
        }}
        caretX={null}
      />,
    );
    const t = text(html);
    expect(t).toMatch(/Studio B R\$\s120,00 Patrícia Souza 17\/09 · 14:20 Normal Esther Villar/);
    expect(t).toContain("Clayton Lima");
    // Sem permissão: a etiqueta do prestador não é botão e nada abre edição na lista.
    expect(html).not.toContain("Alterar prestador");
    expect(html).not.toContain("Tipo da Limpeza");
    prestador.nome = null;
  });

  it("limpezas: com permissão, só a etiqueta do prestador vira botão (o resto edita no detalhe)", () => {
    acesso.liberado = true;
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent
        date="2026-09-17"
        source={{ mode: "done", items: [{ ...items[1], logId: "11111111-1111-1111-1111-111111111111" }] }}
        caretX={null}
      />,
    );
    const botoes = html.match(/<button[\s\S]*?<\/button>/g) ?? [];
    expect(botoes).toHaveLength(1);
    expect(botoes[0]).toContain('title="Alterar prestador"');
    expect(text(botoes[0] ?? "").trim()).toBe("Sem prestador");
    expect(html).not.toContain("lucide-pencil");
    acesso.liberado = false;
  });

  it("sem expansividade: tudo nasce visível, sem seta", () => {
    acesso.liberado = false;
    for (const mode of ["done", "cost"] as const) {
      const html = renderToStaticMarkup(
        <CleaningDayDetailContent date="2026-09-17" source={{ mode, items }} caretX={null} />,
      );
      expect(html).not.toContain("aria-expanded");
      expect(html).not.toContain("grid-rows-[0fr]");
      expect(html).not.toContain("lucide-chevron-right");
    }
  });

  it("serviços extras (mockup Fin-03): data · hora + etiqueta da situação e a descrição embaixo", () => {
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
              ownerName: "Dono",
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
      />,
    );
    expect(text(html)).toMatch(/Casa A R\$\s80,00 Dono 17\/09 · 14:20 Manutenção Troca do chuveiro/);
    expect(html).not.toContain("Situação:");
    expect(html).not.toContain("aria-expanded");
  });
});

describe("cabeçalho universal de janela ampla", () => {
  afterEach(() => cleanup());

  it("sem ícone e sem X improvisado: cabeçalho padrão das janelas (título 14px, subtítulo 12px) no DialogHeader", () => {
    const html = renderToStaticMarkup(
      <CleaningDayDetailContent date="all" title="Custo Total Limpeza" source={{ mode: "done", items }} caretX={null} />,
    );
    const h2 = html.match(/<h2[^>]*>[\s\S]*?<\/h2>/)?.[0] ?? "";
    expect(text(h2).trim()).toBe("Custo Total Limpeza");
    // Padrão único das janelas (11/2026): faixa 48px, título 14px negrito, subtítulo 12px, filete embaixo, `pr-14` p/ o X oficial.
    for (const c of WINDOW_TITLE_CLASS.split(" ")) expect(h2).toContain(c);
    const header = html.match(/<div class="[^"]*pr-14[^"]*">/)?.[0] ?? "";
    for (const c of WINDOW_HEADER_CLASS.split(" ")) expect(header).toContain(c);
    expect(html).toContain(`class="${WINDOW_SUBTITLE_CLASS}"`);
    expect(html).not.toContain("Fechar detalhe");
    expect(html).not.toContain("size-10");
    expect(html).not.toContain("rounded-xl");
    // Cartões dos lançamentos encostam no cabeçalho (mockup Fin-01..04).
    expect(html).toMatch(/sg-elegant-scroll[^"]*px-4[^"]*py-0/);
  });

  it("dentro da janela, o único X é o oficial do DialogContent", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <CleaningDayDetailContent date="all" title="Custo Total Limpeza" source={{ mode: "done", items }} caretX={null} />
          </DialogContent>
        </Dialog>
      </QueryClientProvider>,
    );
    const fechar = screen.getAllByRole("button", { name: "Fechar" });
    expect(fechar).toHaveLength(1);
    for (const c of ["right-0", "top-0", "size-8", "rounded-bl-[12px]", "bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)]", "text-foreground/70", "hover:bg-[color-mix(in_oklab,var(--foreground)_16%,transparent)]", "focus-visible:ring-2"]) {
      expect(fechar[0].className).toContain(c);
    }
    expect(screen.queryByLabelText("Fechar detalhe")).toBeNull();
  });
});
