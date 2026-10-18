import { describe, it, expect } from "vitest";
import { sortingTimeOf } from "@/lib/arrival-order";
import type { ArrivalRow } from "@/lib/dashboard.functions";

const row = (p: Partial<ArrivalRow>) => p as ArrivalRow;

describe("sortingTimeOf — horário previsto ou, sem previsão, o limite do imóvel", () => {
  it("checkout com previsão usa a previsão", () => {
    expect(sortingTimeOf(row({ arrivalTimeOverride: "9:30", propertyCheckoutTime: "11:00" }), "checkout")).toBe("09:30");
  });
  it("checkout sem previsão usa o horário LIMITE de saída (não a chegada do hóspede)", () => {
    expect(sortingTimeOf(row({ guestArrivalTime: "15:00", propertyCheckoutTime: "11:00" }), "checkout")).toBe("11:00");
  });
  it("checkin sem previsão usa o horário de chegada informado pelo hóspede; sem ele, o início do imóvel", () => {
    expect(sortingTimeOf(row({ guestArrivalTime: "16:30", propertyCheckinTime: "15:00" }), "checkin")).toBe("16:30");
    expect(sortingTimeOf(row({ propertyCheckinTime: "15:00" }), "checkin")).toBe("15:00");
  });
  it("sem nada, devolve null (vai para o fim)", () => {
    expect(sortingTimeOf(row({}), "checkout")).toBeNull();
  });
  it("não grava nem altera os campos de previsão", () => {
    const r = row({ propertyCheckoutTime: "11:00" });
    sortingTimeOf(r, "checkout");
    expect(r.arrivalTimeOverride).toBeUndefined();
  });
});
