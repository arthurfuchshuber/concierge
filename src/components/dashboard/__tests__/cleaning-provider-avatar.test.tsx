import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Quadro de prestadores controlado pelo teste: Esther é o padrão do imóvel "p1".
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/hooks/useImpersonation", () => ({ useImpersonation: () => ({ impersonation: null }) }));
vi.mock("@/lib/cleaning-assign.functions", () => ({
  getCleaningProviderBoard: async () => ({
    providers: [{ id: "e", name: "Esther Villar", avatarUrl: null }],
    defaults: { p1: "e" } as Record<string, string>,
    assigned: {} as Record<string, string>,
  }),
  setCleaningAssignment: async () => ({}),
}));
import { CleaningProviderAvatar } from "../CleaningProviderAvatar";
import { EDIT_BTN } from "../edit-frame";

const LOG = "11111111-1111-1111-1111-111111111111";
const wrap = (el: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);

afterEach(cleanup);

describe("CleaningProviderAvatar — moldura editável padrão", () => {
  it('look="raised": iniciais justas na mesma moldura do valor, sem lápis nem padding extra', async () => {
    wrap(<CleaningProviderAvatar propertyId="p1" logId={LOG} reservationId={null} look="raised" />);
    const btn = await screen.findByRole("button", { name: "Responsável: Esther Villar. Trocar" });
    expect(btn.className).toBe(EDIT_BTN);
    expect(btn.textContent).toBe("EV");
    expect(btn.querySelector("svg")).toBeNull();
    const face = btn.querySelector("span[title]") as HTMLElement;
    expect(face.style.paddingInline).toBe("");
    expect(face.style.minWidth).toBe("");
  });

  it('look="raised" sem prestador: "?" na mesma moldura', () => {
    wrap(<CleaningProviderAvatar propertyId="sem" logId={LOG} reservationId={null} look="raised" />);
    const btn = screen.getByRole("button", { name: "Atribuir prestador" });
    expect(btn.className).toBe(EDIT_BTN);
    expect(btn.textContent).toBe("?");
  });

  it("rowStyle (card do Kanban): nome do prestador dentro da moldura, com reticências", async () => {
    wrap(<CleaningProviderAvatar propertyId="p1" logId={LOG} reservationId={null} rowStyle />);
    const btn = await screen.findByRole("button", { name: "Responsável: Esther Villar. Trocar" });
    expect(btn.className).toContain(EDIT_BTN);
    expect(btn.className).toContain("min-w-0");
    expect(btn.textContent).toBe("Esther Villar");
    expect(btn.querySelector(".truncate")).not.toBeNull();
    expect(btn.querySelector("svg")).toBeNull();
  });
});
