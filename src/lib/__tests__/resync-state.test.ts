import { afterEach, describe, expect, it, vi } from "vitest";
import { beginResync, endResync, isResyncing } from "@/lib/resync-state";
import { semDadosVelhos } from "@/routes/__root";

afterEach(() => {
  endResync();
  vi.useRealTimers();
});

describe("resync-state", () => {
  it("liga e desliga", () => {
    expect(isResyncing()).toBe(false);
    beginResync();
    expect(isResyncing()).toBe(true);
    endResync();
    expect(isResyncing()).toBe(false);
  });
  it("trava de segurança solta sozinha (rede ruim não prende o botão)", () => {
    vi.useFakeTimers();
    beginResync();
    vi.advanceTimersByTime(8_001);
    expect(isResyncing()).toBe(false);
  });
});

describe("semDadosVelhos", () => {
  const c = { clientState: { queries: [{ queryKey: ["dash-list", 1] }, { queryKey: ["my-team"] }], mutations: [] } };
  it("com internet não restaura dado do servidor", () => {
    expect(semDadosVelhos(c, true).clientState.queries).toEqual([]);
  });
  it("sem internet mantém a última visão", () => {
    expect(semDadosVelhos(c, false).clientState.queries).toHaveLength(2);
  });
});
