import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fns = vi.hoisted(() => ({
  importAirbnbListings: vi.fn(),
  syncExistingProperty: vi.fn(),
  listAirbnbAccountListings: vi.fn(),
  listAirbnbAccounts: vi.fn(),
  listStakeholders: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (f: unknown) => f,
  createServerFn: () => ({
    middleware: () => ({ inputValidator: () => ({ handler: () => null }) }),
  }),
}));
vi.mock("@/lib/airbnb-account.functions", () => ({
  checkAirbnbReconnection: vi.fn(),
  detectAirbnbConnection: vi.fn(),
  disconnectAirbnbAccount: vi.fn(),
  importAirbnbListings: fns.importAirbnbListings,
  listAirbnbAccountListings: fns.listAirbnbAccountListings,
  listAirbnbAccounts: fns.listAirbnbAccounts,
  retryAirbnbChat: vi.fn(),
  startAirbnbConnect: vi.fn(),
  syncExistingProperty: fns.syncExistingProperty,
  syncAirbnbPair: vi.fn(),
}));
vi.mock("@/lib/channex-mode.functions", () => ({
  activateFullMode: vi.fn(),
  chooseLightMode: vi.fn(),
  getOperationMode: vi.fn(),
  validatePricingFn: vi.fn(),
}));
vi.mock("@/lib/stakeholders.functions", () => ({ listStakeholders: fns.listStakeholders }));
vi.mock("@/components/PhoneActionButton", () => ({ PhoneActionButton: () => null }));
vi.mock("../StakeholderFormDialog", () => ({
  StakeholderFormDialog: () => null,
  emptyStakeholderForm: {},
}));

import { AirbnbAccountFlow, type AirbnbFlowRequest } from "../AirbnbAccountFlow";

const LISTINGS = [
  {
    listingId: "L1",
    title: "Casa Um",
    city: "Foz",
    channelId: "ch-1-aaaa",
    imported: false,
    paused: false,
    propertyId: null,
    notFound: false,
    ownerName: null,
    ownerPhone: null,
    ownerPhoneCountry: null,
  },
  {
    listingId: "L2",
    title: "Casa Dois",
    city: "Foz",
    channelId: "ch-1-aaaa",
    imported: false,
    paused: false,
    propertyId: null,
    notFound: false,
    ownerName: null,
    ownerPhone: null,
    ownerPhoneCountry: null,
  },
];

function mount(request: AirbnbFlowRequest) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AirbnbAccountFlow request={request} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fns.listAirbnbAccounts.mockResolvedValue([
    { channelId: "ch-1-aaaa", title: "Conta Maria", status: "active", listings: 2, imported: 0 },
  ]);
  fns.listAirbnbAccountListings.mockResolvedValue({ connected: true, listings: LISTINGS });
  fns.listStakeholders.mockResolvedValue({
    rows: [
      { id: "o1", name: "Livia", phone: null, phone_country: null },
      { id: "o2", name: "Arthur", phone: null, phone_country: null },
    ],
  });
});

describe("sincronizar imóvel existente", () => {
  it("escolhe o anúncio, confirma e chama syncExistingProperty com imóvel + anúncio", async () => {
    fns.syncExistingProperty.mockResolvedValue({ ok: true, title: "Casa Um", pending: [] });
    mount({ type: "syncProperty", property: { id: "p1", name: "Meu Apê", ownerName: "Livia" } });
    await waitFor(() => expect(screen.getByText("Casa Um")).toBeTruthy());
    expect((screen.getByText("Continuar").closest("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByText("Casa Um"));
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(screen.getByText("Confirmar sincronização")).toBeTruthy());
    fireEvent.click(screen.getByText("Sincronizar imóvel"));
    await waitFor(() => expect(fns.syncExistingProperty).toHaveBeenCalled());
    expect(fns.syncExistingProperty.mock.calls[0][0]).toEqual({
      data: { accountOwnerId: null, propertyId: "p1", listingId: "L1" },
    });
    await waitFor(() => expect(screen.getByText("Imóvel sincronizado")).toBeTruthy());
  });

  it("sem anúncio livre mostra 'Nenhum anúncio disponível'", async () => {
    fns.listAirbnbAccountListings.mockResolvedValue({
      connected: true,
      listings: LISTINGS.map((l) => ({ ...l, imported: true })),
    });
    mount({ type: "syncProperty", property: { id: "p1", name: "Meu Apê", ownerName: null } });
    await waitFor(() => expect(screen.getByText("Nenhum anúncio disponível")).toBeTruthy());
  });
});

describe("de → para (2+ anúncios)", () => {
  async function toPairs() {
    mount({ type: "resync" });
    await waitFor(() => expect(screen.getByText("Conta Maria")).toBeTruthy());
    fireEvent.click(screen.getByText("Conta Maria"));
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(screen.getByText("Casa Um")).toBeTruthy());
    fireEvent.click(screen.getByText("Casa Um"));
    fireEvent.click(screen.getByText("Casa Dois"));
    fireEvent.click(screen.getByText(/Importar 2 anúncios/));
    await waitFor(() => expect(screen.getByText("De quem são os anúncios?")).toBeTruthy());
  }
  async function pick(index: number, name: string) {
    fireEvent.click(screen.getAllByText("Escolher…")[index]);
    await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
    fireEvent.click(screen.getByText(name));
  }

  it("só libera Importar com todos os proprietários e envia um proprietário por anúncio", async () => {
    fns.importAirbnbListings.mockResolvedValue({ imported: 2, failed: [], pending: [] });
    await toPairs();
    const btn = () =>
      screen.getByText(/Importar 2 anúncios|Falta/).closest("button") as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    // linha 1 (índice 0 é "Mesmo para todos"): escolhe Livia no 1º anúncio
    await pick(1, "Livia");
    await waitFor(() => expect(screen.getByText("Falta 1 proprietário(a)")).toBeTruthy());
    expect(btn().disabled).toBe(true);
    await pick(1, "Arthur");
    await waitFor(() => expect(btn().disabled).toBe(false));
    fireEvent.click(btn());
    await waitFor(() => expect(fns.importAirbnbListings).toHaveBeenCalled());
    expect(fns.importAirbnbListings.mock.calls[0][0]).toEqual({
      data: {
        accountOwnerId: null,
        items: [
          { listingId: "L1", ownerId: "o1" },
          { listingId: "L2", ownerId: "o2" },
        ],
      },
    });
  });

  it("'Mesmo para todos' preenche todas as linhas", async () => {
    fns.importAirbnbListings.mockResolvedValue({ imported: 2, failed: [], pending: [] });
    await toPairs();
    await pick(0, "Livia");
    await waitFor(() => expect(screen.getByText(/Importar 2 anúncios/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Importar 2 anúncios/));
    await waitFor(() => expect(fns.importAirbnbListings).toHaveBeenCalled());
    const items = fns.importAirbnbListings.mock.calls[0][0].data.items;
    expect(items).toHaveLength(2);
    expect(items.every((i: { ownerId: string }) => i.ownerId === "o1")).toBe(true);
  });
});
