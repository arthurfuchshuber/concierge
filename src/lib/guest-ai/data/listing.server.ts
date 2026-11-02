/**
 * Fatos do anúncio (audiência P, cobertura integral — ver `listing-normalized.ts`) + endereço
 * (audiência G, só quando concedida).
 */
import type { ListingFacts, ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { getGuestAiDb, type GuestAiDb } from "./client.server";
import { LISTING_COLUMNS, PROPERTY_OPERATIONAL_COLUMNS, PROPERTY_PUBLIC_COLUMNS, cols } from "./projections";
import { pickNormalized } from "./listing-normalized";

export { pickNormalized };

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface ListingFetchResult {
  facts: ListingFacts;
  /** Havia mais de uma linha de anúncio para o imóvel (gêmeos); usada a mais recente. */
  multipleListingRows: boolean;
}

export async function fetchListingFacts(
  turn: ValidatedTurn,
  opts: { includeAddress: boolean },
  deps?: { db?: GuestAiDb },
): Promise<ListingFetchResult> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  const db = deps?.db ?? (await getGuestAiDb());

  const propertyCols = opts.includeAddress
    ? [...PROPERTY_PUBLIC_COLUMNS, ...PROPERTY_OPERATIONAL_COLUMNS]
    : [...PROPERTY_PUBLIC_COLUMNS];
  const [prop, listing] = await Promise.all([
    db.from("properties").select(cols(propertyCols)).eq("id", turn.propertyId).maybeSingle(),
    db
      .from("property_listing_raw_data")
      .select(cols(LISTING_COLUMNS))
      .eq("property_id", turn.propertyId)
      .order("synced_at", { ascending: false })
      .limit(5),
  ]);
  if (prop.error || listing.error) throw new Error("listing_lookup_failed");
  const p = (prop.data as Row | null) ?? {};
  const rows = ((listing.data ?? []) as Row[]).filter((r) => r["property_id"] === turn.propertyId);
  const first = rows[0] ?? null;

  return {
    multipleListingRows: rows.length > 1,
    facts: {
      name: s(p["name"]),
      city: s(p["city"]),
      state: s(p["state"]),
      country: s(p["country"]),
      shortDescription: s(p["short_description"]),
      address: opts.includeAddress ? s(p["address"]) : null,
      normalized: first ? pickNormalized(first["normalized"], s(p["name"])) : null,
      syncedAt: first ? s(first["synced_at"]) : null,
    },
  };
}

/** Conflitos objetivos entre fontes (sem segredo). Não decide qual está certa: só preserva o conflito. */
export function detectListingConflicts(
  listing: ListingFacts["normalized"],
  property: { checkInTime: string | null; checkOutTime: string | null },
): string[] {
  const out: string[] = [];
  const hm = (v: string | null) => (v ? v.slice(0, 5) : null);
  if (listing?.checkoutTime && property.checkOutTime && hm(listing.checkoutTime) !== hm(property.checkOutTime)) {
    out.push(`checkout_time: anúncio ${hm(listing.checkoutTime)} × cadastro ${hm(property.checkOutTime)}`);
  }
  if (listing?.checkinWindow?.start && property.checkInTime && hm(listing.checkinWindow.start) !== hm(property.checkInTime)) {
    out.push(`checkin_time: anúncio ${hm(listing.checkinWindow.start)} × cadastro ${hm(property.checkInTime)}`);
  }
  return out;
}
