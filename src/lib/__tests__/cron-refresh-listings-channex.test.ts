import { describe, it, expect, vi, beforeEach } from "vitest";

const { sync, covers, scrape, hostApi } = vi.hoisted(() => ({
  sync: vi.fn(),
  covers: vi.fn(async () => ({ covers: 0 })),
  scrape: vi.fn(async () => ({ changed: false })),
  hostApi: vi.fn(async () => ({ checked: 1, updated: 1, failed: 0 })),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
}));
vi.mock("@/lib/cron-auth.server", () => ({ verifyCronSecret: () => true, unauthorizedCronResponse: () => new Response(null, { status: 401 }) }));
vi.mock("@/lib/channex-entity-sync.server", () => ({ syncChannexEntities: sync }));
vi.mock("@/lib/airbnb-cover.server", () => ({ refreshAllListingCovers: covers }));
vi.mock("@/lib/channex-listing.server", () => ({ scrapePublicListingForProperty: scrape, backfillHostListings: hostApi }));
vi.mock("@/integrations/supabase/client.server", () => {
  const q = { select: () => q, not: () => q, is: async () => ({ data: [{ property_id: "p1" }] }) };
  return { supabaseAdmin: { from: () => q } };
});

import { Route } from "@/routes/api/public/cron.refresh-airbnb-listings";

const post = (Route as unknown as { options: { server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } } } })
  .options.server.handlers.POST;

describe("cron 4x/dia — releitura da Channex atualiza o dossiê sem depender de webhook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("relê a Channex (forçado, sem throttle) e segue com capa e página pública", async () => {
    sync.mockResolvedValueOnce({ entities: 10, changed: 2, renamedRoomTypes: 0, listingsUpdated: 3 });
    const res = await post({ request: new Request("http://x", { method: "POST" }) });
    const body = await res.json();
    expect(sync).toHaveBeenCalledWith({ force: true, source: "cron:4x-dia" });
    expect(body.channex).toEqual({ listingsUpdated: 3, changed: 2 });
    expect(covers).toHaveBeenCalled();
    expect(scrape).toHaveBeenCalledWith("p1", { onlyIfChanged: true });
    expect(hostApi).toHaveBeenCalled();
    expect(body.hostApi).toEqual({ checked: 1, updated: 1, failed: 0 });
  });

  it("falha na API do anfitrião não derruba o restante", async () => {
    sync.mockResolvedValueOnce({ entities: 0, changed: 0, renamedRoomTypes: 0, listingsUpdated: 0 });
    hostApi.mockRejectedValueOnce(new Error("airbnb fora"));
    const res = await post({ request: new Request("http://x", { method: "POST" }) });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.hostApi).toBeNull();
  });

  it("falha na Channex não impede capa nem página pública", async () => {
    sync.mockRejectedValueOnce(new Error("channex fora"));
    const res = await post({ request: new Request("http://x", { method: "POST" }) });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.channex).toBeNull();
    expect(covers).toHaveBeenCalled();
    expect(scrape).toHaveBeenCalled();
  });
});
