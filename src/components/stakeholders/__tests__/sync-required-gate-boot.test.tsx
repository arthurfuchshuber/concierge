import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";

const state = vi.hoisted(() => ({
  hook: {
    perm: { allowed: true, loading: true },
    q: { data: undefined as unknown, isLoading: true, isFetching: true, refetch: () => undefined },
  },
}));

vi.mock("../useUnsyncedProperties", () => ({ useUnsyncedProperties: () => state.hook }));
vi.mock("../AirbnbAccountFlow", () => ({ AirbnbAccountFlow: () => null }));
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
    const r = render(<SyncRequiredGate />);
    expect(cover()).toBeTruthy();
    expect(screen.queryByText("Sincronize seus imóveis")).toBeNull();

    load({ blocking: true, props: [P("a", "Apê A"), P("b", "Casa B")] });
    r.rerender(<SyncRequiredGate />);
    // Mesmo quadro: a janela já está no DOM e a cobertura ainda segura a tela.
    expect(screen.getByText("Sincronize seus imóveis")).toBeTruthy();
    expect(cover()).toBeTruthy();
    // Depois do respiro (janela pintada) a cobertura sai.
    await waitFor(() => expect(cover()).toBeNull());
    expect(screen.getByText("Sincronize seus imóveis")).toBeTruthy();
  });

  it("sem aviso a mostrar (não bloqueia): a cobertura sai na hora, sem esperar janela", async () => {
    load({ blocking: false, loading: true });
    const r = render(<SyncRequiredGate />);
    expect(cover()).toBeTruthy();
    load({ blocking: false, props: [] });
    r.rerender(<SyncRequiredGate />);
    await waitFor(() => expect(cover()).toBeNull());
    expect(screen.queryByText("Sincronize seus imóveis")).toBeNull();
  });

  it("segurança: se a consulta nunca responder, a cobertura se solta em 2,5 s", async () => {
    vi.useFakeTimers();
    load({ blocking: false, loading: true });
    render(<SyncRequiredGate />);
    expect(cover()).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2600);
    });
    expect(cover()).toBeNull();
    vi.useRealTimers();
  });
});
