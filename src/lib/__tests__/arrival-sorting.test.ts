import { describe, it, expect } from "vitest";
import { sortCheckinRowsCore, sortCheckoutRows } from "@/lib/arrival-sorting";
import { compareArrivalRowsServer } from "@/lib/arrival-order";
import type { ArrivalRow } from "@/lib/dashboard.functions";

const TODAY = "2026-10-17";
let n = 0;
const row = (p: Partial<ArrivalRow>) =>
  ({ logId: `l${++n}`, status: "pending", date: TODAY, propertyId: `p${n}`, propertyName: `Imóvel ${n}`, ownerName: "Z", ...p }) as ArrivalRow;
const ids = (rs: ArrivalRow[]) => rs.map((r) => r.propertyName);
const NONE = new Set<string>();

describe("check-ins (pendentes, amanhã, futuros): relógio = previsão de CHECK-IN", () => {
  it("previsão informada manda; sem previsão usa o horário inicial do imóvel; sem nada vai por último", () => {
    const a = row({ propertyName: "A", arrivalTimeOverride: "17:00", propertyCheckinTime: "14:00" });
    const b = row({ propertyName: "B", propertyCheckinTime: "15:00" }); // limite 15:00
    const c = row({ propertyName: "C", guestArrivalTime: "13:00", propertyCheckinTime: "15:00" });
    const d = row({ propertyName: "D" });
    expect(ids(sortCheckinRowsCore([d, a, b, c], NONE, TODAY))).toEqual(["C", "B", "A", "D"]);
  });
  it("o relógio de saída (checkout) NÃO interfere", () => {
    const a = row({ propertyName: "A", propertyCheckinTime: "16:00", propertyCheckoutTime: "08:00" });
    const b = row({ propertyName: "B", propertyCheckinTime: "15:00", propertyCheckoutTime: "12:00" });
    expect(ids(sortCheckinRowsCore([a, b], NONE, TODAY))).toEqual(["B", "A"]);
  });
  it("atrasado no topo (mais antigo primeiro), depois o dia mais próximo — mesmo com horário mais tarde", () => {
    const hoje = row({ propertyName: "hoje 09", date: TODAY, arrivalTimeOverride: "09:00" });
    const atras1 = row({ propertyName: "atrasado 15/10", date: "2026-10-15", arrivalTimeOverride: "20:00" });
    const atras2 = row({ propertyName: "atrasado 16/10", date: "2026-10-16", arrivalTimeOverride: "08:00" });
    const amanha = row({ propertyName: "amanhã 07", date: "2026-10-18", arrivalTimeOverride: "07:00" });
    expect(ids(sortCheckinRowsCore([amanha, hoje, atras2, atras1], NONE, TODAY))).toEqual([
      "atrasado 15/10",
      "atrasado 16/10",
      "hoje 09",
      "amanhã 07",
    ]);
  });
  it("futuros: dia mais próximo primeiro e, no mesmo dia, pela previsão de check-in", () => {
    const f1 = row({ propertyName: "20/10 16h", date: "2026-10-20", arrivalTimeOverride: "16:00" });
    const f2 = row({ propertyName: "20/10 10h", date: "2026-10-20", arrivalTimeOverride: "10:00" });
    const f3 = row({ propertyName: "19/10", date: "2026-10-19", arrivalTimeOverride: "23:00" });
    expect(ids(sortCheckinRowsCore([f1, f2, f3], NONE, TODAY))).toEqual(["19/10", "20/10 10h", "20/10 16h"]);
  });
  it("imóvel bloqueado (checkout/limpeza pendente) fica abaixo dos liberados", () => {
    const livre = row({ propertyName: "livre", propertyId: "L", arrivalTimeOverride: "18:00" });
    const bloq = row({ propertyName: "bloqueado", propertyId: "B", arrivalTimeOverride: "08:00" });
    expect(ids(sortCheckinRowsCore([bloq, livre], new Set(["B"]), TODAY))).toEqual(["livre", "bloqueado"]);
  });
  it("empate de horário: o mais PERTO do anterior vem em seguida (rota curta)", () => {
    const at = (name: string, lat: number, lng: number) => row({ propertyName: name, lat, lng, arrivalTimeOverride: "15:00" });
    const a = at("A", -25.5, -54.5);
    const far = at("Longe", -25.9, -54.9);
    const near = at("Perto", -25.5005, -54.5005);
    expect(ids(sortCheckinRowsCore([a, far, near], NONE, TODAY))).toEqual(["A", "Perto", "Longe"]);
  });
});

describe("checkouts (pendentes, amanhã): relógio = previsão de CHECKOUT", () => {
  const sort = (rows: ArrivalRow[], ci: ArrivalRow[] = []) => sortCheckoutRows(rows, [ci], TODAY);
  it("sem previsão usa o horário LIMITE de saída do imóvel; a hora de chegada do hóspede é ignorada", () => {
    const a = row({ propertyName: "A", guestArrivalTime: "09:00", propertyCheckoutTime: "11:00" });
    const b = row({ propertyName: "B", guestArrivalTime: "18:00", propertyCheckoutTime: "10:00" });
    expect(ids(sort([a, b]))).toEqual(["B", "A"]);
  });
  it("previsão informada vence o limite", () => {
    const a = row({ propertyName: "A", arrivalTimeOverride: "08:30", propertyCheckoutTime: "12:00" });
    const b = row({ propertyName: "B", propertyCheckoutTime: "10:00" });
    expect(ids(sort([b, a]))).toEqual(["A", "B"]);
  });
  it("atrasado no topo e dias em ordem", () => {
    const hoje = row({ propertyName: "hoje", propertyCheckoutTime: "08:00" });
    const atras = row({ propertyName: "atrasado", date: "2026-10-16", propertyCheckoutTime: "12:00" });
    const amanha = row({ propertyName: "amanhã", date: "2026-10-18", propertyCheckoutTime: "07:00" });
    expect(ids(sort([amanha, hoje, atras]))).toEqual(["atrasado", "hoje", "amanhã"]);
  });
  it("o horário de saída manda: 02:00 fica acima de 11:00 mesmo que o de 11:00 tenha giro", () => {
    const giro = row({ propertyName: "giro-11h", propertyId: "G", propertyCheckoutTime: "11:00" });
    const cedo = row({ propertyName: "cedo-02h", propertyCheckoutTime: "02:00" });
    const ci = row({ propertyId: "G", date: TODAY, propertyCheckinTime: "15:00" });
    expect(ids(sort([giro, cedo], [ci]))).toEqual(["cedo-02h", "giro-11h"]);
  });
  it("mesmo horário de saída: o giro desempata e sobe", () => {
    const giro = row({ propertyName: "giro", propertyId: "G", propertyCheckoutTime: "11:00" });
    const comum = row({ propertyName: "comum", propertyCheckoutTime: "11:00" });
    const ci = row({ propertyId: "G", date: TODAY, propertyCheckinTime: "15:00" });
    expect(ids(sort([comum, giro], [ci]))).toEqual(["giro", "comum"]);
  });
  it("empate: proximidade de endereço", () => {
    const at = (name: string, lat: number, lng: number) => row({ propertyName: name, lat, lng, propertyCheckoutTime: "11:00" });
    expect(ids(sort([at("A", -25.5, -54.5), at("Longe", -25.9, -54.9), at("Perto", -25.5005, -54.5005)]))).toEqual(["A", "Perto", "Longe"]);
  });
});

describe("ordem base do servidor usa o relógio de cada lista", () => {
  it("checkout: previsão/limite de SAÍDA (não a hora de chegada), mais cedo primeiro", () => {
    const a = row({ propertyName: "A", guestArrivalTime: "08:00", propertyCheckoutTime: "11:00" });
    const b = row({ propertyName: "B", guestArrivalTime: "20:00", propertyCheckoutTime: "10:00" });
    expect([a, b].sort((x, y) => compareArrivalRowsServer(x, y, "checkout", TODAY)).map((r) => r.propertyName)).toEqual(["B", "A"]);
  });
  it("atrasado → pendente → concluído (concluído: o mais recente primeiro)", () => {
    const atras = row({ propertyName: "atrasado", date: "2026-10-10" });
    const pend = row({ propertyName: "pendente" });
    const d1 = row({ propertyName: "done velho", status: "done", date: "2026-10-12" });
    const d2 = row({ propertyName: "done novo", status: "done", date: "2026-10-16" });
    expect([d1, pend, d2, atras].sort((x, y) => compareArrivalRowsServer(x, y, "checkin", TODAY)).map((r) => r.propertyName)).toEqual([
      "atrasado",
      "pendente",
      "done novo",
      "done velho",
    ]);
  });
});
