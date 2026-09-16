import { resolvePaddlePrice } from "@/lib/payments.functions";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

declare global {
  interface Window {
    Paddle: any;
  }
}

export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

let paddleInitPromise: Promise<void> | null = null;

export async function initializePaddle(): Promise<void> {
  if (paddleInitPromise) return paddleInitPromise;
  if (!clientToken) throw new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set");

  paddleInitPromise = new Promise<void>((resolve, reject) => {
    const SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";
    const finalize = () => {
      try {
        if (!window.Paddle) {
          reject(new Error("Paddle SDK script carregou mas window.Paddle não existe (bloqueador?)."));
          return;
        }
        const paddleJsEnvironment =
          getPaddleEnvironment() === "sandbox" ? "sandbox" : "production";
        window.Paddle.Environment.set(paddleJsEnvironment);
        window.Paddle.Initialize({
          token: clientToken,
          eventCallback: (data: any) => {
            // Surface checkout errors for debugging.
            if (data?.name === "checkout.error" || data?.name === "checkout.warning") {
              // eslint-disable-next-line no-console
              console.error("[Paddle event]", data?.name, data);
            }
          },
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    };

    // Already loaded
    if (window.Paddle) {
      finalize();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    if (existing) {
      // Script tag exists but may still be loading — poll for window.Paddle.
      const start = Date.now();
      const iv = setInterval(() => {
        if (window.Paddle) {
          clearInterval(iv);
          finalize();
        } else if (Date.now() - start > 10000) {
          clearInterval(iv);
          reject(new Error("Tempo esgotado aguardando o carregamento do Paddle SDK."));
        }
      }, 100);
      existing.addEventListener("error", () => {
        clearInterval(iv);
        reject(new Error("Falha ao carregar o Paddle SDK (script error)."));
      });
      return;
    }

    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    script.onload = finalize;
    script.onerror = () => reject(new Error("Falha ao carregar o Paddle SDK (rede/bloqueador)."));
    document.head.appendChild(script);
  }).catch((err) => {
    // Allow retry on next call.
    paddleInitPromise = null;
    throw err;
  });

  return paddleInitPromise;
}

const priceCache = new Map<string, string>();

export async function getPaddlePriceId(priceId: string): Promise<string> {
  const environment = getPaddleEnvironment();
  const cacheKey = `${environment}:${priceId}`;
  const cached = priceCache.get(cacheKey);
  if (cached) return cached;
  const id = await resolvePaddlePrice({ data: { priceId, environment } });
  priceCache.set(cacheKey, id);
  return id;
}
