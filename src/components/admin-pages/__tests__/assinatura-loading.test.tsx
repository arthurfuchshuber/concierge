// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { sub } = vi.hoisted(() => ({
  sub: { current: {} as Record<string, unknown> },
}));

vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({}) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/hooks/useImpersonation", () => ({ useImpersonation: () => ({ impersonation: null }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => sub.current }));
vi.mock("@/lib/billing/billing.functions", () => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  getAccountPaymentMethod: vi.fn(),
  listMyPayments: vi.fn(),
}));
vi.mock("@/components/pricing/ListingPricing", async (orig) => ({
  ...(await orig<typeof import("@/components/pricing/ListingPricing")>()),
  PriceBands: () => <div>faixas</div>,
}));
vi.mock("../AssinaturaMobile", () => ({ AssinaturaMobile: () => <div>mobile</div> }));
vi.mock("../AssinaturaDesktop", () => ({ AssinaturaDesktop: () => <div>desktop</div> }));

import { AssinaturaPage } from "../AssinaturaPage";

const baseInfo = {
  isActive: false, isManual: false, hasStripeBilling: false, billing: null,
  plan: null, status: null, cancelAtPeriodEnd: false, currentPeriodEnd: null, trialEndsAt: null,
  isTrialing: false, isPastDue: false, billingPaused: false, maxGuides: 0, maxGuidesOverride: null,
  adminNotes: null, features: {},
};

function show(state: Record<string, unknown>) {
  sub.current = { refetch: vi.fn(), isPending: false, isError: false, info: baseInfo, ...state };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AssinaturaPage />
    </QueryClientProvider>,
  );
}

describe("AssinaturaPage — sem flash de 'Sem Assinatura Ativa'", () => {
  beforeEach(() => cleanup());

  it("enquanto carrega mostra só o skeleton (sem faixas de preço nem botão de assinar)", () => {
    show({ isPending: true });
    expect(screen.getByLabelText("Carregando assinatura")).toBeTruthy();
    expect(screen.queryByText("Sem Assinatura Ativa")).toBeNull();
    expect(screen.queryByText("faixas")).toBeNull();
    expect(screen.queryByText("Cadastrar cartão e assinar")).toBeNull();
  });

  it("concluída e sem assinatura: mostra 'Sem Assinatura Ativa' com faixas e botão", () => {
    show({});
    expect(screen.getByText("Sem Assinatura Ativa")).toBeTruthy();
    expect(screen.getByText("faixas")).toBeTruthy();
    expect(screen.getByText("Cadastrar cartão e assinar")).toBeTruthy();
  });

  it("com Stripe mostra as telas reais; manual mostra o aviso de acesso liberado", () => {
    show({ info: { ...baseInfo, hasStripeBilling: true, isActive: true } });
    expect(screen.getByText("mobile")).toBeTruthy();
    expect(screen.queryByText("Sem Assinatura Ativa")).toBeNull();
    cleanup();
    show({ info: { ...baseInfo, isManual: true, isActive: true } });
    expect(screen.getByText("Acesso liberado pela ConciergeIA")).toBeTruthy();
  });

  it("em erro não declara 'sem assinatura': oferece tentar novamente", () => {
    show({ isError: true });
    expect(screen.getByText("Tentar novamente")).toBeTruthy();
    expect(screen.queryByText("Sem Assinatura Ativa")).toBeNull();
  });
});
