/**
 * Anúncios gêmeos: dois anúncios do Airbnb da mesma unidade física passam a
 * consumir o mesmo Room Type (estoque = 1) na Channex. Fluxo oficial da API:
 * cria tarifa no Room Type principal → remove o vínculo antigo do gêmeo →
 * aguarda o Airbnb confirmar → recria o vínculo na tarifa nova → republica.
 */
const B = "https://app.channex.io/api/v1";

function headers() {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  return { "user-api-key": key, "Content-Type": "application/json", Accept: "application/json" };
}

async function cx<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${B}${path}`, { ...init, headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Channex ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ListingRow = {
  channelId: string;
  channelTitle: string;
  listingId: string;
  title: string;
  mappingId: string;
  ratePlanId: string;
  roomTypeId: string | null;
  propertyId: string | null;
};

/** Lista todos os anúncios Airbnb mapeados, com o Room Type que cada um consome. */
export async function listAirbnbListings(): Promise<ListingRow[]> {
  const chans = await cx<{ data: any[] }>("/channels?pagination[limit]=100");
  const out: ListingRow[] = [];
  for (const c of chans.data ?? []) {
    if (c.attributes?.channel !== "AirBNB") continue;
    const [full, listings] = await Promise.all([
      cx<{ data: any }>(`/channels/${c.id}`),
      cx<{ data: any }>(`/channels/${c.id}/action/listings`).catch(() => null),
    ]);
    const titles = new Map<string, string>(
      ((listings?.data?.listing_id_dictionary?.values ?? []) as any[]).map((l) => [String(l.id), String(l.title ?? l.id)]),
    );
    for (const m of full.data.attributes.rate_plans ?? []) {
      const rp = await cx<{ data: any }>(`/rate_plans/${m.rate_plan_id}`).catch(() => null);
      const listingId = String(m.settings?.listing_id ?? "");
      out.push({
        channelId: c.id,
        channelTitle: String(c.attributes?.title ?? ""),
        listingId,
        title: titles.get(listingId) ?? listingId,
        mappingId: m.id,
        ratePlanId: m.rate_plan_id,
        roomTypeId: rp?.data?.relationships?.room_type?.data?.id ?? null,
        propertyId: rp?.data?.relationships?.property?.data?.id ?? null,
      });
    }
  }
  return out;
}

/** Faz o anúncio gêmeo consumir o mesmo estoque do anúncio principal. */
export async function linkTwinListing(input: { channelId: string; primaryListingId: string; twinListingId: string }) {
  if (input.primaryListingId === input.twinListingId) throw new Error("Escolha dois anúncios diferentes.");
  const rows = (await listAirbnbListings()).filter((r) => r.channelId === input.channelId);
  const primary = rows.find((r) => r.listingId === input.primaryListingId);
  const twin = rows.find((r) => r.listingId === input.twinListingId);
  if (!primary?.roomTypeId || !primary.propertyId) throw new Error("Anúncio principal não encontrado na Channex.");
  if (!twin) throw new Error("Anúncio gêmeo não encontrado na Channex.");
  if (twin.roomTypeId === primary.roomTypeId) return { alreadyLinked: true };

  const old = await cx<{ data: any }>(`/rate_plans/${twin.ratePlanId}`);
  const occupancy = old.data?.attributes?.options?.[0]?.occupancy ?? 2;
  const rate = Number(old.data?.attributes?.options?.[0]?.rate ?? 0) || 1;
  const created = await cx<{ data: { id: string } }>("/rate_plans", {
    method: "POST",
    body: JSON.stringify({
      rate_plan: {
        // Nome público do anúncio gêmeo, para o PriceLabs identificá-lo.
        title: (twin.title.includes(" · ") ? twin.title.slice(twin.title.lastIndexOf(" · ") + 3) : twin.title).trim() || "Tarifa Anúncio Gêmeo",
        property_id: primary.propertyId,
        room_type_id: primary.roomTypeId,
        currency: old.data?.attributes?.currency ?? "BRL",
        sell_mode: "per_room",
        rate_mode: "manual",
        options: [{ occupancy, is_primary: true, rate }],
      },
    }),
  });

  await cx(`/channels/${input.channelId}/mappings/${twin.mappingId}`, { method: "DELETE" });
  await sleep(35_000); // a Channex exige pausa entre remover e recriar o vínculo do Airbnb
  await cx(`/channels/${input.channelId}/mappings`, {
    method: "POST",
    body: JSON.stringify({ mapping: { rate_plan_id: created.data.id, settings: { listing_id: twin.listingId } } }),
  });
  await sleep(10_000);
  await cx(`/channels/${input.channelId}/execute/publish`, {
    method: "POST",
    body: JSON.stringify({ listing_id: twin.listingId }),
  }).catch(() => undefined);
  return { alreadyLinked: false, newRatePlanId: created.data.id };
}
