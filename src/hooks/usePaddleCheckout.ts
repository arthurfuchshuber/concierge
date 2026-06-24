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
    /** When set, renders inline checkout inside the element with this id. */
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
      } catch (e) {
        throw new Error(`Preço "${options.priceId}" não encontrado no provedor.`);
      }

      const settings: Record<string, unknown> = {
        successUrl:
          options.successUrl || `${window.location.origin}/admin/assinatura?checkout=success`,
        allowLogout: false,
      };

      if (options.frameTarget) {
        const el = document.getElementById(options.frameTarget);
        if (!el) {
          throw new Error(`Elemento "#${options.frameTarget}" não existe no DOM.`);
        }
        settings.displayMode = "inline";
        settings.frameTarget = options.frameTarget;
        settings.frameInitialHeight = 480;
        settings.frameStyle =
          options.frameStyle ||
          "width: 100%; min-width: 312px; background-color: transparent; border: none;";
      } else {
        settings.displayMode = "overlay";
        settings.variant = "one-page";
      }

      window.Paddle.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: options.quantity ?? 1 }],
        customer: options.customerEmail ? { email: options.customerEmail } : undefined,
        customData: options.customData,
        settings,
      });
    } finally {
      setLoading(false);
    }
  };


  return { openCheckout, loading };
}
