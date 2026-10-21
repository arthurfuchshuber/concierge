import { describe, it, expect } from "vitest";
import { accessGuidanceText } from "../access-guidance.server";

describe("access guidance after check-in time", () => {
  it("forbids repeating the check-in start time once it has passed", () => {
    const txt = accessGuidanceText({ isCheckinDay: true, early: false, allowed: "15:00" } as never, false, "deliver");
    expect(txt).toContain("é PROIBIDO mencionar o horário de início do check-in");
    expect(txt).not.toContain("reforce com gentileza o horário de check-in");
  });
  it("still reinforces the time before check-in", () => {
    const txt = accessGuidanceText({ isCheckinDay: true, early: true, allowed: "15:00" } as never, false, "deliver");
    expect(txt).toContain("reforce com gentileza o horário de check-in");
  });
});
