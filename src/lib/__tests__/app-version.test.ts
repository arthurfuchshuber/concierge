// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_RELOAD_ATTEMPTS, dropStaleAppShell, registerReloadAttempt } from "@/lib/app-version";

beforeEach(() => window.sessionStorage.clear());

describe("registerReloadAttempt", () => {
  it("permite até 3 tentativas por serverId e depois pausa; passada a pausa, tenta de novo", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_RELOAD_ATTEMPTS; i++) expect(registerReloadAttempt("v2", t0 + i)).toBe(true);
    expect(registerReloadAttempt("v2", t0 + 10)).toBe(false);
    expect(registerReloadAttempt("v2", t0 + 11 * 60_000)).toBe(true);
  });

  it("um serverId novo zera o contador; flag legada (texto puro) não trava", () => {
    for (let i = 0; i < MAX_RELOAD_ATTEMPTS; i++) registerReloadAttempt("v2");
    expect(registerReloadAttempt("v3")).toBe(true);
    window.sessionStorage.setItem("sg-app-reloaded-for", "v4");
    expect(registerReloadAttempt("v4")).toBe(true);
  });
});

describe("dropStaleAppShell", () => {
  it("avisa o controller do SW e aparia todos os caches 'ci-'", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { controller: { postMessage }, getRegistration: async () => undefined },
    });
    const del = vi.fn(async (_n: string) => true);
    vi.stubGlobal("caches", { keys: async () => ["ci-html-1", "ci-asset-1", "ci-img-1", "outro"], delete: del });
    await dropStaleAppShell();
    expect(postMessage).toHaveBeenCalledWith({ tipo: "ci-limpar-cache" });
    expect(del.mock.calls.map((c) => c[0] as string).sort()).toEqual(["ci-asset-1", "ci-html-1", "ci-img-1"]);
    vi.unstubAllGlobals();
  });
});

describe("desfazer checkout limpa a nota", () => {
  it("revertArrival (from cleaning) zera note junto de status/done_at/concluded_at", () => {
    const src = readFileSync(path.resolve(__dirname, "..", "dashboard.functions.ts"), "utf8");
    expect(src).toContain('.update({ status: "pending", done_at: null, concluded_at: null, note: null })');
  });
});
