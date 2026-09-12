// Meta Pixel (Facebook Pixel) helper — official snippet + typed wrappers.
// Reusable across the app; safe to call before the pixel finishes loading
// (fbq queues events until the script is ready).

export const META_PIXEL_ID = "1320285053650616";

type FbqParams = Record<string, unknown>;
type Fbq = {
  (command: "init", pixelId: string, params?: FbqParams): void;
  (command: "track", event: string, params?: FbqParams): void;
  (command: "trackCustom", event: string, params?: FbqParams): void;
  (command: string, ...args: unknown[]): void;
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  callMethod?: (...args: unknown[]) => void;
  push?: (...args: unknown[]) => void;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    __metaPixelInitialized?: boolean;
    __metaPixelLastPath?: string;
  }
}

/**
 * Loads the Meta Pixel script once and initializes it with our Pixel ID.
 * Does NOT fire the initial PageView — that is handled by `metaPixelPageView`
 * so SPA navigations and the first mount share the same code path (no dupes).
 */
export function initMetaPixel(): void {
  if (typeof window === "undefined") return;
  if (window.__metaPixelInitialized) return;
  window.__metaPixelInitialized = true;

  // Official Meta Pixel base code (adapted; no auto PageView).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (function (f: any, b: Document, e: string, v: string) {
    if (f.fbq) return;
    const n: any = function () {
      // eslint-disable-next-line prefer-rest-params
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    f.fbq = n;
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    const t = b.createElement(e) as HTMLScriptElement;
    t.async = true;
    t.src = v;
    const s = b.getElementsByTagName(e)[0];
    s?.parentNode?.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  try {
    window.fbq?.("init", META_PIXEL_ID);
  } catch {
    /* noop */
  }
}

function safeFbq(): Fbq | null {
  if (typeof window === "undefined") return null;
  return window.fbq ?? null;
}

/** Fires PageView, deduplicating consecutive calls for the same path. */
export function metaPixelPageView(path?: string): void {
  const fbq = safeFbq();
  if (!fbq) return;
  const current = path ?? (typeof window !== "undefined" ? window.location.pathname + window.location.search : "");
  if (typeof window !== "undefined" && window.__metaPixelLastPath === current) return;
  if (typeof window !== "undefined") window.__metaPixelLastPath = current;
  try {
    fbq("track", "PageView");
  } catch {
    /* noop */
  }
}

/** Standard Meta event (e.g. InitiateCheckout, Purchase). */
export function metaPixelTrack(event: string, params?: FbqParams): void {
  const fbq = safeFbq();
  if (!fbq) return;
  try {
    if (params) fbq("track", event, params);
    else fbq("track", event);
  } catch {
    /* noop */
  }
}

/** Custom Meta event (e.g. ViewPlans, ChatClick). */
export function metaPixelTrackCustom(event: string, params?: FbqParams): void {
  const fbq = safeFbq();
  if (!fbq) return;
  try {
    if (params) fbq("trackCustom", event, params);
    else fbq("trackCustom", event);
  } catch {
    /* noop */
  }
}

/**
 * Fires a custom event at most once per page-session (uses sessionStorage,
 * scoped by event name). Useful for viewport-triggered events like ViewPlans.
 */
export function metaPixelTrackCustomOnce(event: string, params?: FbqParams): void {
  if (typeof window === "undefined") return;
  const key = `fb_once_${event}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    /* If storage unavailable, still fire once per tab via a module flag. */
    const w = window as unknown as { __fbOnce?: Record<string, boolean> };
    w.__fbOnce = w.__fbOnce || {};
    if (w.__fbOnce[event]) return;
    w.__fbOnce[event] = true;
  }
  metaPixelTrackCustom(event, params);
}

/** Standard event fired at most once per page-session (used for Purchase). */
export function metaPixelTrackOnce(event: string, params?: FbqParams): void {
  if (typeof window === "undefined") return;
  const key = `fb_once_std_${event}_${params ? JSON.stringify(params) : ""}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    const w = window as unknown as { __fbOnce?: Record<string, boolean> };
    w.__fbOnce = w.__fbOnce || {};
    if (w.__fbOnce[key]) return;
    w.__fbOnce[key] = true;
  }
  metaPixelTrack(event, params);
}
