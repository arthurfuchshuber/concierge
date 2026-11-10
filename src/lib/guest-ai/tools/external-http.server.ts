/**
 * Transporte dos provedores externos das ferramentas da IA Guest (Etapa 3, 08/11/2026): clima (Open-Meteo,
 * público, sem chave) e voos (AviationStack, `AVIATIONSTACK_API_KEY`). Junto com `google-maps.server.ts`, é
 * o único ponto de rede de `guest-ai/tools/`. Mesmo padrão de Places/Routes, mais:
 *  - chave só no pedido (AviationStack exige `access_key` na consulta): nunca em log, erro ou resultado;
 *  - corpo de resposta de erro nunca lido (só o status);
 *  - CACHE CURTO em memória por consulta (clima 10 min, voos 2 min; até 200 entradas);
 *  - DISJUNTOR por provedor: 3 falhas seguidas abrem por 60 s (nesse tempo a ferramenta responde
 *    `indisponivel` sem ir à rede);
 *  - sem segredo configurado, a ferramenta de voos nem é oferecida ao modelo (`externalToolAvailability`) e,
 *    se chamada, responde `indisponivel` (sem quebrar o turno);
 *  - todo pedido carrega o `signal` (o executor corta em 6 s).
 */
import type { ExternalHttp, ExternalProvider, ToolAvailability } from "./contracts";

const BASE: Record<ExternalProvider, () => string> = {
  open_meteo: () => "https://api.open-meteo.com",
  aviationstack: () => process.env["AVIATIONSTACK_BASE_URL"] || "https://api.aviationstack.com",
};
export const EXTERNAL_CACHE_TTL_MS: Record<ExternalProvider, number> = {
  // 10/11/2026: previsão muda devagar (60 min); status de voo muda mais rápido, mas 10 min evita consultas repetidas
  open_meteo: 60 * 60_000,
  aviationstack: 10 * 60_000,
};
const CACHE_MAX = 200;
export const BREAKER_FAILURES = 3;
export const BREAKER_OPEN_MS = 60_000;

function aviationKey(): string | null {
  const v = process.env["AVIATIONSTACK_API_KEY"];
  return typeof v === "string" && v ? v : null;
}

export function externalToolAvailability(): ToolAvailability {
  return { weather: true, flights: aviationKey() !== null };
}

export class ExternalUnavailable extends Error {
  constructor(code: string) {
    super(code);
    this.name = "ExternalUnavailable";
  }
}

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** Fábrica (testável): cada instância tem o seu cache e disjuntor. */
export function createExternalHttp(opts: { fetch?: Fetch; now?: () => number } = {}): ExternalHttp & {
  reset(): void;
} {
  const doFetch: Fetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? (() => Date.now());
  let cache = new Map<string, { until: number; body: unknown }>();
  const breaker = new Map<ExternalProvider, { fails: number; openUntil: number }>();

  const http = (async (provider, path, init) => {
    const key = `${provider}:${path}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return { ok: true, status: 200, json: async () => hit.body };
    const b = breaker.get(provider) ?? { fails: 0, openUntil: 0 };
    if (b.openUntil > now()) throw new ExternalUnavailable("breaker_open");

    let url = `${BASE[provider]()}${path}`;
    if (provider === "aviationstack") {
      const k = aviationKey();
      if (!k) throw new ExternalUnavailable("config_missing");
      url += `${path.includes("?") ? "&" : "?"}access_key=${encodeURIComponent(k)}`;
    }
    const fail = () => {
      const fails = b.fails + 1;
      breaker.set(provider, { fails, openUntil: fails >= BREAKER_FAILURES ? now() + BREAKER_OPEN_MS : 0 });
    };
    let res: Response;
    try {
      res = await doFetch(url, { signal: init.signal });
    } catch (e) {
      if (!init.signal.aborted) fail();
      throw e instanceof ExternalUnavailable ? e : new ExternalUnavailable("network");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      if (res.status >= 500 || res.status === 429) fail();
      return { ok: false, status: res.status, json: async () => null };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      fail();
      return { ok: false, status: 502, json: async () => null };
    }
    // AviationStack responde erro de conta/limite com 200 e `{ error }`: falha, sem cache
    if (body && typeof body === "object" && "error" in (body as Record<string, unknown>)) {
      fail();
      return { ok: false, status: 502, json: async () => null };
    }
    breaker.set(provider, { fails: 0, openUntil: 0 });
    if (cache.size >= CACHE_MAX) cache = new Map([...cache].slice(1)); // descarta a entrada mais antiga
    cache.set(key, { until: now() + EXTERNAL_CACHE_TTL_MS[provider], body });
    return { ok: true, status: res.status, json: async () => body };
  }) as ExternalHttp & { reset(): void };
  http.reset = () => {
    cache.clear();
    breaker.clear();
  };
  return http;
}

/** Transporte de produção (cache e disjuntor por instância do servidor). */
export const productionExternalHttp = createExternalHttp();
