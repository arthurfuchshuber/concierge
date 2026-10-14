import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  hook: {
    perm: { allowed: true, loading: false },
    q: { data: undefined as unknown },
  },
}));

vi.mock("../useUnsyncedProperties", () => ({ useUnsyncedProperties: () => state.hook }));
vi.mock("../AirbnbAccountFlow", () => ({
  AirbnbAccountFlow: ({ request }: { request: { type: string; properties?: unknown[] } | null }) =>
    request ? (
      <div data-testid="flow">
        {request.type}:{request.properties?.length ?? 1}
      </div>
    ) : null,
}));

import { SyncAlertBanner } from "../SyncAlertBanner";
import { isSyncAlertAccount, SIGMA_ACCOUNT_ID } from "@/lib/sync-alert-accounts";

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
const THREE = [
  P("a", "Apê Aconchegante a 2 km do Centro"),
  P("b", "Casa Completa em Bairro Residencial"),
  P("c", "Casa Completa Próx. a Avenida Turística"),
];

function set(opts: { allowed?: boolean; loading?: boolean; alert?: boolean; props?: unknown[] }) {
  state.hook = {
    perm: { allowed: opts.allowed ?? true, loading: opts.loading ?? false },
    q: {
      data:
        opts.props === undefined && opts.alert === undefined
          ? undefined
          : {
              properties: opts.props ?? [],
              availableListings: 4,
              blocking: true,
              alert: opts.alert,
            },
    },
  };
}
function mount() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <SyncAlertBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => cleanup());
afterEach(cleanup);

describe("faixa de imóveis sem sincronização", () => {
  it("conta Sigma, administrador, 3 pendentes: mostra a faixa com 3 imóveis", () => {
    set({ alert: true, props: THREE });
    mount();
    expect(screen.getByText("Imóveis sem sincronização com o Airbnb")).toBeTruthy();
    expect(screen.getByText("3 imóveis")).toBeTruthy();
    expect(screen.getByText("Sincronizar agora")).toBeTruthy();
  });
  it("outra conta (servidor não marcou o alerta): nunca aparece", () => {
    set({ alert: false, props: THREE });
    mount();
    expect(screen.queryByText("Imóveis sem sincronização com o Airbnb")).toBeNull();
  });
  it("Sigma com 0 pendentes: não aparece", () => {
    set({ alert: true, props: [] });
    mount();
    expect(screen.queryByText("Imóveis sem sincronização com o Airbnb")).toBeNull();
  });
  it("Sigma sem a permissão de administrar (prestador, visualizador): não aparece", () => {
    set({ allowed: false, alert: true, props: THREE });
    mount();
    expect(screen.queryByText("Imóveis sem sincronização com o Airbnb")).toBeNull();
  });
  it("sem piscada: enquanto a permissão ou a consulta carregam, não desenha nada", () => {
    set({ loading: true, alert: true, props: THREE });
    mount();
    expect(screen.queryByText("Imóveis sem sincronização com o Airbnb")).toBeNull();
    cleanup();
    state.hook = { perm: { allowed: true, loading: false }, q: { data: undefined } };
    mount();
    expect(screen.queryByText("Imóveis sem sincronização com o Airbnb")).toBeNull();
  });
  it("o botão abre o fluxo em massa com os pendentes (1 pendente abre o fluxo individual)", () => {
    set({ alert: true, props: THREE });
    mount();
    fireEvent.click(screen.getByText("Sincronizar agora"));
    expect(screen.getByTestId("flow").textContent).toBe("syncProperties:3");
    cleanup();
    set({ alert: true, props: [THREE[0]] });
    mount();
    expect(screen.getByText("1 imóvel")).toBeTruthy();
    fireEvent.click(screen.getByText("Sincronizar agora"));
    expect(screen.getByTestId("flow").textContent).toBe("syncProperty:1");
  });
});

describe("lista de contas do alerta", () => {
  it("só a Anfitrião Sigma está na lista", () => {
    expect(isSyncAlertAccount(SIGMA_ACCOUNT_ID)).toBe(true);
    expect(isSyncAlertAccount("00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(isSyncAlertAccount(null)).toBe(false);
    expect(isSyncAlertAccount(undefined)).toBe(false);
  });
});
