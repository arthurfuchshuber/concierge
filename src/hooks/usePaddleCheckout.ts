import { useState } from "react";
import { initializePaddle, getPaddlePriceId } from "@/lib/paddle";

export function usePaddleCheckout() {
  const [loading, setLoading] = useState(false);

  const openCheckout = async (options: {
    priceId: string;
    quantity?: number;
    customerEmail?: string;
    customData?: Record<string, string>;
    successUrl?: string;
    /**
     * Quando definido, renderiza o checkout inline dentro do elemento
     * que tenha esta CLASSE CSS (não id — Paddle.js procura por classe).
     */
    frameTarget?: string;
    frameStyle?: string;
  }) => {
    setLoading(true);
    try {
      await initializePaddle();
      if (!window.Paddle?.Checkout?.open) {
        throw new Error("Paddle SDK não carregou. Verifique bloqueadores de anúncio/script.");
      }

      let paddlePriceId: string;
      try {
        paddlePriceId = await getPaddlePriceId(options.priceId);
      } catch {
        throw new Error(`Preço "${options.priceId}" não encontrado no provedor.`);
      }

      const settings: Record<string, unknown> = {
        allowLogout: false,
      };
      if (options.successUrl) settings.successUrl = options.successUrl;

      if (options.frameTarget) {
        const el = document.getElementsByClassName(options.frameTarget)[0];
        if (!el) {
          throw new Error(`Container "${options.frameTarget}" não existe no DOM.`);
        }
        // Garante que o container esteja vazio (re-abrir, fallback, etc).
        el.replaceChildren();
        settings.displayMode = "inline";
        settings.frameTarget = options.frameTarget;
        settings.frameInitialHeight = "450";
        settings.frameStyle =
          options.frameStyle ||
          "width: 100%; min-width: 312px; background-color: transparent; border: none;";
      } else {
        settings.displayMode = "overlay";
        settings.variant = "one-page";
      }

      const payload: Record<string, unknown> = {
        items: [{ priceId: paddlePriceId, quantity: options.quantity ?? 1 }],
        settings,
      };
      if (options.customerEmail) payload.customer = { email: options.customerEmail };
      if (options.customData && Object.keys(options.customData).length > 0) {
        payload.customData = options.customData;
      }

      window.Paddle.Checkout.open(payload);
    } finally {
      setLoading(false);
    }
  };

  return { openCheckout, loading };
}
