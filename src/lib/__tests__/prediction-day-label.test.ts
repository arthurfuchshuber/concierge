import { describe, expect, it } from "vitest";
import { isDawnTime, predictionDayLabel } from "@/lib/prediction-day-label";

const TODAY = "2026-10-29";
const TOMORROW = "2026-10-30";
const YESTERDAY = "2026-10-28";

describe("predictionDayLabel — madrugada", () => {
  it("check-in às 02:00 com data de hoje → madrugada", () => {
    expect(predictionDayLabel(TODAY, TODAY, "02:00", "checkin")).toEqual({ label: "madrugada", tone: "accent" });
  });

  it("check-in às 00:00 e 05:59 com data de hoje → madrugada", () => {
    expect(predictionDayLabel(TODAY, TODAY, "00:00", "checkin")).toEqual({ label: "madrugada", tone: "accent" });
    expect(predictionDayLabel(TODAY, TODAY, "05:59", "checkin")).toEqual({ label: "madrugada", tone: "accent" });
  });

  it("check-in às 06:00 e 15:00 com data de hoje → hoje", () => {
    expect(predictionDayLabel(TODAY, TODAY, "06:00", "checkin")).toEqual({ label: "hoje", tone: "muted" });
    expect(predictionDayLabel(TODAY, TODAY, "15:00", "checkin")).toEqual({ label: "hoje", tone: "muted" });
  });

  it("check-out às 02:00 com data de hoje → hoje (madrugada só vale no check-in)", () => {
    expect(predictionDayLabel(TODAY, TODAY, "02:00", "checkout")).toEqual({ label: "hoje", tone: "muted" });
  });

  it("check-in às 02:00 de amanhã → madrugada", () => {
    expect(predictionDayLabel(TOMORROW, TODAY, "02:00", "checkin")).toEqual({ label: "madrugada", tone: "accent" });
  });

  it("amanhã sem horário de madrugada → amanhã", () => {
    expect(predictionDayLabel(TOMORROW, TODAY, "15:00", "checkin")).toEqual({ label: "amanhã", tone: "accent" });
  });

  it("data de ontem → ontem (atrasado)", () => {
    expect(predictionDayLabel(YESTERDAY, TODAY, "02:00", "checkin")).toEqual({ label: "ontem", tone: "late" });
  });

  it("sem data → rótulo vazio", () => {
    expect(predictionDayLabel(null, TODAY)).toEqual({ label: "", tone: "muted" });
  });

  it("isDawnTime ignora valores inválidos", () => {
    expect(isDawnTime(null)).toBe(false);
    expect(isDawnTime("abc")).toBe(false);
  });
});
