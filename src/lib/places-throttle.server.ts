// Throttle + retry + short-lived in-memory cache for Google Places
// (searchText) calls. Prevents bursts of parallel requests from tripping the
// per-minute quota (HTTP 429) at the connector gateway.
//
// Runs per Worker isolate. That is enough to smooth out the common failure
// mode — a single request assembling many POIs in Promise.all.

const MAX_CONCURRENCY = 4;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [300, 900, 1800];
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX_ENTRIES = 500;

type CacheEntry = { at: number; status: number; body: string };
const cache = new Map<string, CacheEntry>();

let active = 0;
const waiters: Array<() => void> = [];

async function acquire() {
  if (active < MAX_CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

function release() {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

function cacheGet(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function cacheSet(key: string, entry: CacheEntry) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, entry);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Runs fetch(url, init) with global concurrency cap, retry on 429/5xx, and
 * optional in-memory cache keyed on `cacheKey` (24h TTL). Returns a Response
 * that behaves like the original for `.ok`, `.status`, `.text()`, `.json()`.
 */
export async function throttledFetch(
  url: string,
  init: RequestInit,
  cacheKey?: string,
): Promise<Response> {
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) {
      return new Response(hit.body, { status: hit.status });
    }
  }

  await acquire();
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const res = await fetch(url, init);
      const shouldRetry = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!shouldRetry || attempt === MAX_RETRIES) {
        if (cacheKey && res.ok) {
          const body = await res.clone().text();
          cacheSet(cacheKey, { at: Date.now(), status: res.status, body });
        }
        return res;
      }
      await sleep(RETRY_DELAYS_MS[attempt] ?? 1000);
    }
    // Unreachable — the loop always returns.
    return await fetch(url, init);
  } finally {
    release();
  }
}
