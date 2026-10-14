import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fns = vi.hoisted(() => ({
  importAirbnbListings: vi.fn(),
  syncExistingProperty: vi.fn(),
  syncAirbnbPair: vi.fn(),
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
  syncAirbnbPair: fns.syncAirbnbPair,
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

const PROPS = [
  { id: "p1", name: "Casa Um", ownerName: "Livia" },
  { id: "p2", name: "Meu Apê", ownerName: "Arthur" },
];

describe("sincronizar em massa (de → para)", () => {
  async function open() {
    mount({ type: "syncProperties", properties: PROPS });
    await waitFor(() => expect(screen.getByText("Qual anúncio é cada imóvel?")).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText("Anúncio sem imóvel").length).toBe(2));
  }
  const btn = () =>
    screen.getByText(/Sincronizar \d+ par(es)?|Falta \d/).closest("button") as HTMLButtonElement;

  it("mostra todos os imóveis, sugere por nome e deixa o anúncio solto escolher um imóvel", async () => {
    fns.syncAirbnbPair.mockResolvedValue({
      kind: "linked",
      propertyId: "x",
      title: "x",
      pending: [],
    });
    await open();
    expect(screen.getAllByText("Casa Um").length).toBeGreaterThan(0);
    expect(screen.getByText("Meu Apê")).toBeTruthy();
    expect(btn().disabled).toBe(true);
    fireEvent.click(screen.getByText("Sugerir"));
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 1 par/));
    // sobra o anúncio "Casa Dois": escolhe o imóvel "Meu Apê" para ele
    fireEvent.click(screen.getByText("Escolher imóvel…"));
    await waitFor(() => expect(screen.getAllByText("Meu Apê").length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByText("Meu Apê")[1]);
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 2 pares/));
    fireEvent.click(btn());
    await waitFor(() => expect(fns.syncAirbnbPair).toHaveBeenCalledTimes(2));
    expect(fns.syncAirbnbPair.mock.calls.map((c) => c[0].data)).toEqual([
      { accountOwnerId: null, listingId: "L1", propertyId: "p1" },
      { accountOwnerId: null, listingId: "L2", propertyId: "p2" },
    ]);
    await waitFor(() => expect(screen.getByText("2 de 2 sincronizados")).toBeTruthy());
  });

  it("anúncio sem imóvel pode virar imóvel novo, mas exige o proprietário(a)", async () => {
    fns.syncAirbnbPair.mockResolvedValue({
      kind: "created",
      propertyId: "n",
      title: "n",
      pending: [],
    });
    await open();
    fireEvent.click(screen.getByText("Sugerir"));
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 1 par/));
    fireEvent.click(screen.getByText("Escolher imóvel…"));
    await waitFor(() =>
      expect(screen.getByText("Criar imóvel novo a partir do anúncio")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Criar imóvel novo a partir do anúncio"));
    await waitFor(() => expect(screen.getByText("Falta 1 proprietário(a)")).toBeTruthy());
    expect(btn().disabled).toBe(true);
    fireEvent.click(screen.getAllByText("Escolher…").at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getAllByText("Livia").length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByText("Livia").at(-1) as HTMLElement);
    await waitFor(() => expect(btn().disabled).toBe(false));
    fireEvent.click(btn());
    await waitFor(() => expect(fns.syncAirbnbPair).toHaveBeenCalledTimes(2));
    expect(fns.syncAirbnbPair.mock.calls[1][0].data).toEqual({
      accountOwnerId: null,
      listingId: "L2",
      ownerId: "o1",
    });
  });

  it("sem imóvel livre, o anúncio que sobrou vai direto para imóvel novo (só pergunta o proprietário)", async () => {
    fns.syncAirbnbPair.mockResolvedValue({
      kind: "created",
      propertyId: "n",
      title: "n",
      pending: [],
    });
    mount({ type: "syncProperties", properties: [PROPS[0]] });
    await waitFor(() => expect(screen.getByText("Qual anúncio é cada imóvel?")).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText("Anúncio sem imóvel").length).toBe(2));
    fireEvent.click(screen.getByText("Sugerir"));
    // Casa Um ↔ L1: não sobra imóvel, então a pergunta do imóvel some e só falta o proprietário(a).
    await waitFor(() => expect(screen.getByText("Falta 1 proprietário(a)")).toBeTruthy());
    expect(screen.queryByText("Qual imóvel é este anúncio?")).toBeNull();
    expect(screen.getByText("Quem é o proprietário(a)?")).toBeTruthy();
    expect(btn().disabled).toBe(true);
    fireEvent.click(screen.getAllByText("Escolher…").at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getAllByText("Livia").length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByText("Livia").at(-1) as HTMLElement);
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 2 pares/));
    fireEvent.click(btn());
    await waitFor(() => expect(fns.syncAirbnbPair).toHaveBeenCalledTimes(2));
    expect(fns.syncAirbnbPair.mock.calls[0][0].data).toEqual({
      accountOwnerId: null,
      listingId: "L1",
      propertyId: "p1",
    });
    expect(fns.syncAirbnbPair.mock.calls[1][0].data).toEqual({
      accountOwnerId: null,
      listingId: "L2",
      ownerId: "o1",
    });
  });

  it("uma falha não derruba as demais e dá para tentar de novo só o que faltou", async () => {
    fns.syncAirbnbPair
      .mockResolvedValueOnce({ kind: "linked", propertyId: "p1", title: "Casa Um", pending: [] })
      .mockRejectedValueOnce(new Error("Anúncio já ligado."))
      .mockResolvedValueOnce({ kind: "linked", propertyId: "p2", title: "Meu Apê", pending: [] });
    await open();
    fireEvent.click(screen.getByText("Sugerir"));
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 1 par/));
    fireEvent.click(screen.getByText("Escolher imóvel…"));
    await waitFor(() => expect(screen.getAllByText("Meu Apê").length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByText("Meu Apê")[1]);
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 2 pares/));
    fireEvent.click(btn());
    await waitFor(() => expect(screen.getByText("1 de 2 sincronizados")).toBeTruthy());
    expect(screen.getByText("Anúncio já ligado.")).toBeTruthy();
    fireEvent.click(screen.getByText("Tentar o que faltou"));
    await waitFor(() => expect(screen.getByText("2 de 2 sincronizados")).toBeTruthy());
    expect(fns.syncAirbnbPair).toHaveBeenCalledTimes(3);
  });
});
