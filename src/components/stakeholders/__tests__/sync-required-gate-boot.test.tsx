import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  hook: {
    perm: { allowed: true, loading: true },
    q: { data: undefined as unknown, isLoading: true, isFetching: true, refetch: () => undefined },
  },
}));

vi.mock("../useUnsyncedProperties", () => ({ useUnsyncedProperties: () => state.hook }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/airbnb-account.functions", () => ({
  listAirbnbAccounts: async () => [
    { channelId: "c1", title: "Conta Anfitrião Sigma", status: "active", listings: 5, imported: 1 },
    { channelId: "c2", title: "Conta Maria Souza", status: "active", listings: 2, imported: 0 },
    { channelId: "c3", title: "Conta Velha", status: "expired", listings: null, imported: 0 },
  ],
}));
vi.mock("../AirbnbAccountFlow", () => ({
  AirbnbAccountFlow: ({ request }: { request: { type: string; properties?: unknown[] } | null }) =>
    request ? (
      <div data-testid="flow">
        {request.type}:{request.properties?.length ?? 1}
      </div>
    ) : null,
}));
vi.mock("@/components/PhoneActionButton", () => ({ PhoneActionButton: () => null }));

import { SyncRequiredGate } from "../SyncRequiredGate";

const P = (id: string, name: string) => ({
  id,
  name,
  city: null,
  ownerName: "Livia",
  ownerPhone: null,
  ownerPhoneCountry: null,
  imageUrl: null,
  imageUrls: [],
});
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (ui: ReactElement) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
const cover = () => document.querySelector("div.fixed.inset-0.z-\\[60\\]");

function load(opts: { blocking: boolean; props?: unknown[]; loading?: boolean }) {
  state.hook = {
    perm: { allowed: true, loading: false },
    q: {
      data: opts.loading
        ? undefined
        : { properties: opts.props ?? [], availableListings: 2, blocking: opts.blocking },
      isLoading: !!opts.loading,
      isFetching: !!opts.loading,
      refetch: () => undefined,
    },
  };
}

afterEach(cleanup);

describe("aviso obrigatório: sem piscada ao recarregar", () => {
  it("enquanto carrega: cobertura de boot; ao confirmar o bloqueio a janela abre no mesmo quadro e a cobertura só sai depois", async () => {
    load({ blocking: false, loading: true });
    const r = render(wrap(<SyncRequiredGate />));
    expect(cover()).toBeTruthy();
    expect(screen.queryByText("Sincronize seus imóveis")).toBeNull();

    load({ blocking: true, props: [P("a", "Apê A"), P("b", "Casa B")] });
    r.rerender(wrap(<SyncRequiredGate />));
    // Mesmo quadro: a janela já está no DOM e a cobertura ainda segura a tela.
    expect(screen.getByText("Sincronize seus imóveis")).toBeTruthy();
    expect(cover()).toBeTruthy();
    // Depois do respiro (janela pintada) a cobertura sai.
    await waitFor(() => expect(cover()).toBeNull());
    expect(screen.getByText("Sincronize seus imóveis")).toBeTruthy();
  });

  it("conta primeiro: contas, botão único 'Vincular anúncios' e imóveis só informativos (sem checkboxes)", async () => {
    load({
      blocking: true,
      props: [P("a", "Apê A"), P("b", "Casa B"), P("c", "Casa C")],
    });
    render(wrap(<SyncRequiredGate />));
    await screen.findByText("Conta Anfitrião Sigma");
    expect(screen.getAllByText(/no Airbnb/).length).toBe(2);
    expect(screen.getByText("Precisa reconectar")).toBeTruthy();
    // "Imóveis pendentes" é um botão que abre a lista informativa (sem seleção e sem "Sincronizar 0")
    expect(screen.queryByText("Apê A")).toBeNull();
    fireEvent.click(screen.getByText("Imóveis pendentes"));
    expect(screen.getByText("Apê A")).toBeTruthy();
    expect(screen.getByText("Casa C")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox").length).toBe(0);
    expect(screen.queryByText(/Selecionar todos/)).toBeNull();
    expect(screen.queryByText(/^Sincronizar \d/)).toBeNull();
    // um único botão principal, que leva TODOS os pendentes ao fluxo unificado
    expect(screen.getAllByText("Vincular anúncios").length).toBe(1);
    fireEvent.click(screen.getByText("Vincular anúncios"));
    expect(screen.getByTestId("flow").textContent).toBe("syncProperties:3");
  });

  it("'Conectar conta' abre o fluxo de conectar", async () => {
    load({ blocking: true, props: [P("a", "Apê A"), P("b", "Casa B")] });
    render(wrap(<SyncRequiredGate />));
    await screen.findByText("Conta Maria Souza");
    fireEvent.click(screen.getByText("Conectar conta"));
    expect(screen.getByTestId("flow").textContent).toBe("connect:1");
  });

  it("um único imóvel pendente abre o fluxo individual", async () => {
    load({ blocking: true, props: [P("a", "Apê A")] });
    render(wrap(<SyncRequiredGate />));
    await screen.findByText("Conta Maria Souza");
    fireEvent.click(screen.getByText("Vincular anúncios"));
    expect(screen.getByTestId("flow").textContent).toBe("syncProperty:1");
  });

  it("sem aviso a mostrar (não bloqueia): a cobertura sai na hora, sem esperar janela", async () => {
    load({ blocking: false, loading: true });
    const r = render(wrap(<SyncRequiredGate />));
    expect(cover()).toBeTruthy();
    load({ blocking: false, props: [] });
    r.rerender(wrap(<SyncRequiredGate />));
    await waitFor(() => expect(cover()).toBeNull());
    expect(screen.queryByText("Sincronize seus imóveis")).toBeNull();
  });

  it("segurança: se a consulta nunca responder, a cobertura se solta em 5 s", async () => {
    vi.useFakeTimers();
    load({ blocking: false, loading: true });
    render(wrap(<SyncRequiredGate />));
    expect(cover()).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(5100);
    });
    expect(cover()).toBeNull();
    vi.useRealTimers();
  });
});
