/**
 * Cliente mínimo da API da Stripe (REST + fetch), compatível com o runtime de borda.
 *
 * Segredos (Lovable → Secrets): `STRIPE_SECRET_KEY` (sk_live_/sk_test_/rk_…) e
 * `STRIPE_WEBHOOK_SECRET` (whsec_…). Nunca são logados nem devolvidos ao navegador.
 */
import { PRICE_LOOKUP_KEY } from "@/lib/billing/listing-billing";

/** Versão fixa: as respostas mudam de forma entre versões (ex.: período no item da assinatura). */
export const STRIPE_API_VERSION = "2025-03-31.basil";
const API = "https://api.stripe.com/v1";

export type BillingEnv = "sandbox" | "live";

function secretKey(): string {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY não configurada.");
  return key;
}

/** Ambiente da conta Stripe, deduzido da chave (teste → sandbox). */
export function stripeEnv(): BillingEnv {
  return secretKey().includes("_live_") ? "live" : "sandbox";
}

/** Como `stripeEnv`, mas sem lançar erro quando a chave não está configurada. */
export function stripeEnvOrNull(): BillingEnv | null {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) return null;
  return key.includes("_live_") ? "live" : "sandbox";
}

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

type Param = string | number | boolean | null | undefined | Param[] | { [k: string]: Param };

/** Codifica objetos aninhados no formato `a[b][0][c]=…` que a Stripe espera. */
export function encodeForm(params: Record<string, Param>): string {
  const out: string[] = [];
  const walk = (prefix: string, v: Param) => {
    if (v === undefined) return;
    if (v === null) {
      out.push(`${encodeURIComponent(prefix)}=`);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    } else if (typeof v === "object") {
      for (const [k, child] of Object.entries(v)) walk(`${prefix}[${k}]`, child);
    } else {
      out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join("&");
}

export async function stripeRequest<T = any>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Record<string, Param>,
  opts?: { idempotencyKey?: string },
): Promise<T> {
  const body = params ? encodeForm(params) : "";
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: method === "GET" ? undefined : body });
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as any;
    if (res.ok) return json as T;
    const e = json?.error ?? {};
    const retryable = res.status === 429 || res.status >= 500 || res.headers.get("stripe-should-retry") === "true";
    lastErr = new StripeApiError(e.message ?? `Stripe ${res.status}`, res.status, e.type, e.code);
    if (!retryable) throw lastErr;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error("Falha de comunicação com a Stripe.");
}

// ───────────────────────── Preço oficial ─────────────────────────

let priceCache: { at: number; id: string; productId: string } | null = null;

/** Preço vigente buscado pela chave de consulta (nunca por ID fixo no código). */
export async function getListingPrice(): Promise<{ id: string; productId: string }> {
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache;
  const list = await stripeRequest<{ data: Array<{ id: string; product: string; active: boolean }> }>(
    "GET",
    "/prices",
    { lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 },
  );
  const p = list.data[0];
  if (!p) throw new Error(`Preço '${PRICE_LOOKUP_KEY}' não encontrado na Stripe.`);
  priceCache = { at: Date.now(), id: p.id, productId: typeof p.product === "string" ? p.product : (p.product as any).id };
  return priceCache;
}

// ───────────────────────── Leitura de assinatura ─────────────────────────

export type StripeSubscription = {
  id: string;
  status: string;
  customer: string | { id: string };
  metadata: Record<string, string>;
  cancel_at_period_end: boolean;
  pause_collection: { behavior: string; resumes_at: number | null } | null;
  current_period_start?: number;
  current_period_end?: number;
  default_payment_method?: any;
  items: {
    data: Array<{
      id: string;
      quantity: number;
      current_period_start?: number;
      current_period_end?: number;
      price: { id: string; product: string | { id: string } };
    }>;
  };
};

export function subscriptionItem(sub: StripeSubscription) {
  const item = sub.items?.data?.[0];
  if (!item) throw new Error(`Assinatura ${sub.id} sem item.`);
  return item;
}

/** Período atual (a partir de 2025 a Stripe informa no item; antes, na assinatura). */
export function subscriptionPeriod(sub: StripeSubscription): { start: number; end: number } {
  const item = sub.items?.data?.[0];
  return {
    start: item?.current_period_start ?? sub.current_period_start ?? 0,
    end: item?.current_period_end ?? sub.current_period_end ?? 0,
  };
}

export function customerId(sub: { customer: string | { id: string } }): string {
  return typeof sub.customer === "string" ? sub.customer : sub.customer.id;
}

export async function retrieveSubscription(id: string, expand: string[] = []): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`, expand.length ? { expand } : undefined);
}

// ───────────────────────── Assinatura do webhook ─────────────────────────

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Valida o cabeçalho `Stripe-Signature` (`t=…,v1=…`) sobre o corpo cru, com tolerância de 5 min.
 * Aceita mais de um segredo (troca de segredo sem janela de falha).
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secrets: string[],
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header || !secrets.length) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)));
    if (sigs.some((s) => timingSafeEqualHex(s, expected))) return true;
  }
  return false;
}
