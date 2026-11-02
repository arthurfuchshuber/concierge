import { describe, expect, it } from "vitest";
import { structuredListing, houseRulesText } from "@/lib/listing-structured";

const settings = {
  booking_setting: {
    check_in_time_start: "14", check_in_time_end: "22", check_out_time: "11",
    instant_booking_allowed_category: "everyone",
    cancellation_policy_settings: { cancellation_policy_category: "moderate" },
    guest_controls: { allows_pets_as_host: true, pet_capacity: 2, allows_events_as_host: false, allows_smoking_as_host: false },
  },
};

describe("anúncio estruturado", () => {
  it("extrai janela, instantânea, política e regras", () => {
    const s = structuredListing(settings);
    expect(s.checkin_window).toEqual({ start: "14:00", end: "22:00" });
    expect(s.checkout_time).toBe("11:00");
    expect(s.instant_booking_enabled).toBe(true);
    expect(s.cancellation_policy_label).toBe("Moderada");
    expect(s.house_rules.find((r) => r.key === "pets")?.detail).toBe("até 2");
    expect(houseRulesText(s.house_rules)).toContain("Festas e eventos: não permitido");
  });
  it("sem dados não inventa nada", () => {
    const s = structuredListing({});
    expect(s.instant_booking_enabled).toBeNull();
    expect(s.cancellation_policy_default).toBeNull();
    expect(s.house_rules).toEqual([]);
  });
});
