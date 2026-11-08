/** Transporte falso do Google Maps para os testes (nenhuma rede). */
import type { MapsHttp } from "@/lib/guest-ai/tools/contracts";

export type FakeRoute = { meters: number; seconds?: number } | null;

export interface FakeMapsOptions {
  places?: unknown;
  placesStatus?: number;
  /** Trajeto por destino (texto exato do parâmetro) e modo. */
  walk?: (dest: string) => FakeRoute;
  drive?: (dest: string) => FakeRoute;
  matrixStatus?: number;
  /** Nunca responde (para testar o prazo). */
  hang?: boolean;
  /** Lança como falha de rede. */
  throwError?: boolean;
}

export function fakeMaps(opts: FakeMapsOptions = {}) {
  const calls: Array<{ path: string; body?: string; headers?: Record<string, string> }> = [];
  const http: MapsHttp = (path, init) => {
    calls.push({ path, body: init.body, headers: init.headers });
    if (opts.throwError) return Promise.reject(new Error("network"));
    if (opts.hang) {
      return new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    }
    if (path.startsWith("/places/v1/places:searchText")) {
      const status = opts.placesStatus ?? 200;
      return Promise.resolve({
        ok: status < 400,
        status,
        json: async () => opts.places ?? { places: [] },
      });
    }
    if (path.startsWith("/maps/api/distancematrix/json")) {
      const status = opts.matrixStatus ?? 200;
      const q = new URLSearchParams(path.split("?")[1]);
      const mode = q.get("mode");
      const dests = (q.get("destinations") ?? "").split("|");
      const fn = mode === "walking" ? opts.walk : opts.drive;
      const elements = dests.map((d) => {
        const r = fn ? fn(d) : null;
        return r
          ? { status: "OK", distance: { value: r.meters }, duration: { value: r.seconds ?? 600 } }
          : { status: "ZERO_RESULTS" };
      });
      return Promise.resolve({
        ok: status < 400,
        status,
        json: async () => ({ status: "OK", rows: [{ elements }] }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => null });
  };
  return { http, calls };
}

export const PLACES_RESPONSE = {
  places: [
    {
      id: "a",
      displayName: { text: "Pizzaria Longe" },
      formattedAddress: "Av. Brasil, 900",
      rating: 4.6,
      userRatingCount: 812,
      currentOpeningHours: { openNow: true },
      location: { latitude: -25.53, longitude: -54.58 },
      primaryTypeDisplayName: { text: "Pizzaria" },
      googleMapsUri: "https://maps.google.com/?cid=111",
      businessStatus: "OPERATIONAL",
    },
    {
      id: "b",
      displayName: { text: "Pizzaria Perto" },
      formattedAddress: "Rua Almirante, 120",
      rating: 4.8,
      userRatingCount: 230,
      currentOpeningHours: { openNow: false },
      location: { latitude: -25.5161, longitude: -54.5853 },
      primaryTypeDisplayName: { text: "Pizzaria" },
      googleMapsUri: "https://evil.example/?x=1",
      businessStatus: "OPERATIONAL",
    },
    {
      id: "c",
      displayName: { text: "Pizzaria Fechada" },
      location: { latitude: -25.52, longitude: -54.59 },
      businessStatus: "CLOSED_PERMANENTLY",
    },
  ],
};
