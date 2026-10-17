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
  setPropertySyncDismissed: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (f: unknown) => f,
  createMiddleware: () => ({ server: () => ({}), client: () => ({}) }),
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
  setPropertySyncDismissed: fns.setPropertySyncDismissed,
}));
vi.mock("@/lib/channex-mode.functions", () => ({
  activateFullMode: vi.fn(),
  chooseLightMode: vi.fn(),
  getOperationMode: vi.fn(),
  validatePricingFn: vi.fn(),
}));
vi.mock("@/lib/stakeholders.functions", () => ({ listStakeholders: fns.listStakeholders }));
vi.mock("../useUnsyncedProperties", () => ({
  useUnsyncedProperties: () => ({
    perm: { allowed: true, loading: false },
    q: { data: { properties: [], blocking: false }, isLoading: false },
    accountOwnerId: null,
  }),
}));
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
    await waitFor(() => expect(screen.getByText("Vincular anúncios")).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText("Escolher anúncio…").length).toBe(2));
  }
  /** Escolhe, no seletor da linha `i`, o anúncio de título `title`. */
  async function pickListing(i: number, title: string) {
    fireEvent.click(screen.getAllByText("Escolher anúncio…")[i]);
    await waitFor(() => expect(screen.getAllByText(title).length).toBeGreaterThan(0));
    const opts = screen.getAllByText(title);
    fireEvent.click(opts[opts.length - 1]);
  }
  const btn = () =>
    screen
      .getByText(/Sincronizar \d+ imóve(l|is)|Escolha ao menos 1/)
      .closest("button") as HTMLButtonElement;

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
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 1 imóvel/));
    // "Anúncios sem imóvel" não repete os anúncios livres enquanto falta imóvel sem par.
    expect(screen.queryByText(/anúncios? sem imóvel/i)).toBeNull();
    await pickListing(0, "Casa Dois");
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 2 imóveis/));
    fireEvent.click(btn());
    await waitFor(() => expect(fns.syncAirbnbPair).toHaveBeenCalledTimes(2));
    expect(fns.syncAirbnbPair.mock.calls.map((c) => c[0].data)).toEqual([
      { accountOwnerId: null, listingId: "L1", propertyId: "p1" },
      { accountOwnerId: null, listingId: "L2", propertyId: "p2" },
    ]);
    await waitFor(() => expect(screen.getByText("2 de 2 sincronizados")).toBeTruthy());
  });

  it("sem imóvel livre, o anúncio que sobrou vai direto para imóvel novo (só pergunta o proprietário)", async () => {
    fns.syncAirbnbPair.mockResolvedValue({
      kind: "created",
      propertyId: "n",
      title: "n",
      pending: [],
    });
    mount({ type: "syncProperties", properties: [PROPS[0]] });
    await waitFor(() => expect(screen.getByText("Vincular anúncios")).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText("Escolher anúncio…").length).toBe(1));
    expect(screen.queryByText(/anúncios? sem imóvel/i)).toBeNull();
    fireEvent.click(screen.getByText("Sugerir"));
    // Casa Um ↔ L1: todos os imóveis têm par, então o anúncio que sobrou aparece e só falta o proprietário(a).
    await waitFor(() => expect(screen.getByText("Anúncio sem imóvel")).toBeTruthy());
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 1 imóvel/));
    expect(screen.queryByText("Ligar a um imóvel")).toBeNull();
    expect(screen.queryByText("Escolher imóvel…")).toBeNull();
    fireEvent.click(screen.getAllByText("Escolher…").at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getAllByText("Livia").length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByText("Livia").at(-1) as HTMLElement);
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 2 imóveis/));
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

  it("com duas contas do Airbnb: lista única, nome da conta em cada anúncio e um clique só", async () => {
    fns.listAirbnbAccounts.mockResolvedValue([
      { channelId: "ch-1-aaaa", title: "Conta Sigma", status: "active", listings: 2, imported: 0 },
      {
        channelId: "ch-2-bbbb",
        title: "Conta Patricia",
        status: "active",
        listings: 1,
        imported: 0,
      },
    ]);
    fns.listAirbnbAccountListings.mockResolvedValue({
      connected: true,
      listings: [{ ...LISTINGS[0] }, { ...LISTINGS[1], channelId: "ch-2-bbbb" }],
    });
    fns.syncAirbnbPair.mockResolvedValue({
      kind: "linked",
      propertyId: "x",
      title: "x",
      pending: [],
    });
    mount({
      type: "syncProperties",
      properties: [
        { id: "p1", name: "Casa Um", ownerName: "Livia" },
        { id: "p2", name: "Casa Dois", ownerName: "Arthur" },
      ],
    });
    // Não pergunta "Qual conta?": já mostra o De → Para com os anúncios das duas contas.
    await waitFor(() => expect(screen.getByText("Vincular anúncios")).toBeTruthy());
    expect(screen.queryByText("Qual conta do Airbnb?")).toBeNull();
    expect(fns.listAirbnbAccountListings.mock.calls[0][0].data.channelId).toBeNull();
    await waitFor(() => expect(screen.getAllByText("Escolher anúncio…").length).toBe(2));
    fireEvent.click(screen.getByText("Sugerir"));
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 2 imóveis/));
    // Cada anúncio escolhido mostra a conta dele.
    expect(screen.getAllByText("Conta Sigma").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Conta Patricia").length).toBeGreaterThan(0);
    fireEvent.click(btn());
    await waitFor(() => expect(fns.syncAirbnbPair).toHaveBeenCalledTimes(2));
    expect(fns.syncAirbnbPair.mock.calls.map((c) => c[0].data.listingId)).toEqual(["L1", "L2"]);
  });

  it("uma falha não derruba as demais e dá para tentar de novo só o que faltou", async () => {
    fns.syncAirbnbPair
      .mockResolvedValueOnce({ kind: "linked", propertyId: "p1", title: "Casa Um", pending: [] })
      .mockRejectedValueOnce(new Error("Anúncio já ligado."))
      .mockResolvedValueOnce({ kind: "linked", propertyId: "p2", title: "Meu Apê", pending: [] });
    await open();
    fireEvent.click(screen.getByText("Sugerir"));
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 1 imóvel/));
    await pickListing(0, "Casa Dois");
    await waitFor(() => expect(btn().textContent).toMatch(/Sincronizar 2 imóveis/));
    fireEvent.click(btn());
    await waitFor(() => expect(screen.getByText("1 de 2 sincronizados")).toBeTruthy());
    expect(screen.getByText("Anúncio já ligado.")).toBeTruthy();
    fireEvent.click(screen.getByText("Tentar o que faltou"));
    await waitFor(() => expect(screen.getByText("2 de 2 sincronizados")).toBeTruthy());
    expect(fns.syncAirbnbPair).toHaveBeenCalledTimes(3);
  });

  it("'Não sincronizar' tira o imóvel da lista (e do aviso) e 'Desfazer' devolve", async () => {
    fns.setPropertySyncDismissed.mockResolvedValue({ ok: true });
    await open();
    fireEvent.keyDown(screen.getAllByLabelText("Mais ações")[1], { key: "Enter" });
    fireEvent.click(await screen.findByText("Não sincronizar", { selector: "b" }));
    await waitFor(() =>
      expect(fns.setPropertySyncDismissed.mock.calls[0][0].data).toEqual({
        accountOwnerId: null,
        propertyId: "p2",
        dismissed: true,
      }),
    );
    // "Meu Apê" sai dos cartões e vai para a seção "Não sincronizar", com "Desfazer".
    await waitFor(() => expect(screen.getByText("Desfazer")).toBeTruthy());
    expect(screen.getAllByLabelText("Mais ações").length).toBe(1);
    fireEvent.click(screen.getByText("Desfazer"));
    await waitFor(() =>
      expect(fns.setPropertySyncDismissed.mock.calls[1][0].data).toEqual({
        accountOwnerId: null,
        propertyId: "p2",
        dismissed: false,
      }),
    );
    await waitFor(() => expect(screen.getAllByLabelText("Mais ações").length).toBe(2));
    expect(screen.queryByText("Desfazer")).toBeNull();
  });
});
