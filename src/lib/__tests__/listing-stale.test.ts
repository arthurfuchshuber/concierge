import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/airbnb-public-parse", () => ({ parsePublicListingHtml: () => null }));
import { isListingStale } from "@/lib/channex-listing.server";

describe("releitura automática do anúncio", () => {
  const now = Date.parse("2026-10-30T18:00:00Z");
  it("nunca checado = antigo", () => expect(isListingStale(null, now)).toBe(true));
  it("checado há 1h59 = fresco", () => expect(isListingStale("2026-10-30T16:01:00Z", now)).toBe(false));
  it("checado há 2h = antigo", () => expect(isListingStale("2026-10-30T16:00:00Z", now)).toBe(true));
});
