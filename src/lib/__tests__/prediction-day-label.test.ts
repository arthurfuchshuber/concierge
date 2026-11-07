import { describe, expect, it } from "vitest";
import { isDawnTime, predictionDayLabel } from "@/lib/prediction-day-label";

const TODAY = "2026-10-29";
const TOMORROW = "2026-10-30";
const YESTERDAY = "2026-10-28";

describe("predictionDayLabel — madrugada", () => {
  it("check-in às 02:00 com data de hoje → nesta madrugada", () => {
    expect(predictionDayLabel(TODAY, TODAY, "02:00", "checkin")).toEqual({
      label: "nesta madrugada",
      tone: "accent",
    });
  });

  it("madrugada = 00:00 até antes das 05:00 (mesma regra da IA, diretriz de 06/11/2026)", () => {
    expect(predictionDayLabel(TODAY, TODAY, "00:00", "checkin")).toEqual({
      label: "nesta madrugada",
      tone: "accent",
    });
    expect(predictionDayLabel(TODAY, TODAY, "04:59", "checkin")).toEqual({
      label: "nesta madrugada",
      tone: "accent",
    });
    expect(predictionDayLabel(TODAY, TODAY, "05:00", "checkin")).toEqual({
      label: "hoje",
      tone: "muted",
    });
  });

  it("virou o dia e ainda é madrugada: chegada da noite de ontem continua 'nesta madrugada', nunca atraso", () => {
    expect(predictionDayLabel(YESTERDAY, TODAY, "02:00", "checkin", 90)).toEqual({
      label: "nesta madrugada",
      tone: "accent",
    });
    // depois das 05:00 a chegada pendente da noite anterior é atraso
    expect(predictionDayLabel(YESTERDAY, TODAY, "02:00", "checkin", 6 * 60)).toEqual({
      label: "ontem",
      tone: "late",
    });
  });

  it("check-in às 06:00 e 15:00 com data de hoje → hoje", () => {
    expect(predictionDayLabel(TODAY, TODAY, "06:00", "checkin")).toEqual({
      label: "hoje",
      tone: "muted",
    });
    expect(predictionDayLabel(TODAY, TODAY, "15:00", "checkin")).toEqual({
      label: "hoje",
      tone: "muted",
    });
  });

  it("check-out às 02:00 com data de hoje → hoje (madrugada só vale no check-in)", () => {
    expect(predictionDayLabel(TODAY, TODAY, "02:00", "checkout")).toEqual({
      label: "hoje",
      tone: "muted",
    });
  });

  it("check-in às 02:00 de amanhã → madrugada (nunca 'amanhã')", () => {
    expect(predictionDayLabel(TOMORROW, TODAY, "02:00", "checkin")).toEqual({
      label: "madrugada",
      tone: "accent",
    });
  });

  it("amanhã sem horário de madrugada → amanhã", () => {
    expect(predictionDayLabel(TOMORROW, TODAY, "15:00", "checkin")).toEqual({
      label: "amanhã",
      tone: "accent",
    });
  });

  it("data de ontem → ontem (atrasado)", () => {
    expect(predictionDayLabel(YESTERDAY, TODAY, "02:00", "checkin")).toEqual({
      label: "ontem",
      tone: "late",
    });
  });

  it("sem data → rótulo vazio", () => {
    expect(predictionDayLabel(null, TODAY)).toEqual({ label: "", tone: "muted" });
  });

  it("isDawnTime ignora valores inválidos", () => {
    expect(isDawnTime(null)).toBe(false);
    expect(isDawnTime("abc")).toBe(false);
  });
});
