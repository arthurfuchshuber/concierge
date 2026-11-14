import { describe, it, expect } from "vitest";
import { roundUpToSlot } from "@/lib/guest-ai-ops-apply.server";

describe("previsão do hóspede arredonda para cima no slot de 30 min", () => {
  it("horário exato fica igual", () => expect(roundUpToSlot("05:00")).toBe("05:00"));
  it("05:10 vira 05:30", () => expect(roundUpToSlot("05:10")).toBe("05:30"));
  it("05:40 vira 06:00", () => expect(roundUpToSlot("05:40")).toBe("06:00"));
  it("normaliza 9:30", () => expect(roundUpToSlot("9:30")).toBe("09:30"));
});
