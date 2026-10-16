import { describe, it, expect } from "vitest";
import { resolveReservationIdentity } from "@/lib/reservation-identity";

describe("resolveReservationIdentity", () => {
  it("API reservation: name is never used as code", () => {
    const r = resolveReservationIdentity({
      source: "channex",
      guest_hint: "José Kauê Bunde Martins",
      guest_contacts: { code: "HMHA3MYK4E", names: ["José Kauê Bunde Martins"], phones: ["5547991333980"] },
      occupancy: { adults: 2, children: 0, infants: 0 },
      ota_name: "AirBNB",
    });
    expect(r.guestName).toBe("José Kauê Bunde Martins");
    expect(r.reservationCode).toBe("HMHA3MYK4E");
    expect(r.guestPhone).toBe("+5547991333980");
    expect(r.channel).toBe("Airbnb");
    expect(r.adults).toBe(2);
  });
  it("iCal reservation: hint is the code, no name", () => {
    const r = resolveReservationIdentity({ source: "airbnb", guest_hint: "HMFKFBK9TC" });
    expect(r.reservationCode).toBe("HMFKFBK9TC");
    expect(r.guestName).toBeNull();
  });
});
