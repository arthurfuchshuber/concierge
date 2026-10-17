import { describe, expect, it } from "vitest";
import { parseNotes, richReservationFields } from "@/lib/reservation-rich";

const res = { instant_booked: true, cancellation_policy_category: "tiered_pricing_non_refundable", cancellation_policy_id: "CANCEL_TIERED_PRICING_NON_REFUNDABLE", is_airbnborg_stay: false, host_fee_base: "211.84", host_fee_vat: "29.30" };
const notes = "Listing Base Price: 1134.00\nListing Cancellation Host Fee: 241.14\nCohost Payout: N/A\nCleaning Fee: 190.00\n";

describe("campos ricos da reserva", () => {
  it("lê raw_message como TEXTO JSON (como está no banco)", () => {
    const f = richReservationFields({ raw_message: JSON.stringify({ reservation: res }), notes });
    expect(f.booking_modality).toBe("instant_book");
    expect(f.is_non_refundable).toBe(true);
    expect(f.cancellation_policy_id).toBe("CANCEL_TIERED_PRICING_NON_REFUNDABLE");
    expect(f.listing_base_price).toBe(1134);
    expect(f.cleaning_fee).toBe(190);
    expect(f.channel_host_fee).toBe(241.14);
    expect(f.cohost_payout).toBeNull();
  });
  it("lê raw_message como objeto e pedido de reserva", () => {
    const f = richReservationFields({ raw_message: { reservation: { ...res, instant_booked: false, cancellation_policy_category: "moderate" } } });
    expect(f.booking_modality).toBe("request_to_book");
    expect(f.is_non_refundable).toBe(false);
  });
  it("sem raw_message: tudo nulo, nada presumido", () => {
    const f = richReservationFields({});
    expect(f.booking_modality).toBeNull();
    expect(f.cancellation_policy_category).toBeNull();
    expect(f.is_non_refundable).toBe(false);
  });
  it("notas N/A viram nulo", () => {
    expect(parseNotes("A: N/A\nB: 2.50")).toEqual({ A: null, B: 2.5 });
  });

  it("calcula total líquido e líquido do anfitrião (menos o co-anfitrião)", () => {
    const f = richReservationFields({ amount: "1134.38", notes: "Cohost Payout: 654.07\nCleaning Fee: 200.00\n" });
    expect(f.net_total).toBe(1134.38);
    expect(f.host_net_payout).toBe(480.31);
    const g = richReservationFields({ amount: "900", notes: "Cohost Payout: N/A\n" });
    expect(g.host_net_payout).toBe(900);
    expect(richReservationFields({ amount: "0", notes: "" }).net_total).toBeNull();
  });
});

import { guestVisibleTotal } from "@/lib/reservation-rich";
describe("valor que o hóspede vê", () => {
  it("soma a comissão de volta ao líquido (bruto) e não inventa sem ela", () => {
    expect(guestVisibleTotal(1914.23, 426.27)).toBe(2340.5);
    expect(guestVisibleTotal(1134.38, null)).toBeNull();
    expect(guestVisibleTotal(0, 10)).toBeNull();
  });
});
