import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type AddressSuggestion = {
  label: string;
  address: string;
  district: string;
  city: string;
  state: string;
  cep: string;
};

/**
 * Autocompletar de endereço brasileiro enquanto a pessoa digita.
 * Usa o Nominatim (OpenStreetMap), que é público e cobre o país inteiro.
 */
export const searchBrAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ q: z.string().trim().min(3).max(160) }).parse(i))
  .handler(async ({ data }): Promise<AddressSuggestion[]> => {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=br&limit=6&q=" +
      encodeURIComponent(data.q);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "sigma-concierge/1.0" },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as Array<Record<string, any>>;
      return json.map((r) => {
        const a = (r["address"] ?? {}) as Record<string, string>;
        const street = a["road"] ?? a["pedestrian"] ?? a["neighbourhood"] ?? "";
        const number = a["house_number"] ?? "";
        return {
          label: String(r["display_name"] ?? ""),
          address: [street, number].filter(Boolean).join(", "),
          district: a["suburb"] ?? a["neighbourhood"] ?? a["city_district"] ?? "",
          city: a["city"] ?? a["town"] ?? a["village"] ?? a["municipality"] ?? "",
          state: (a["ISO3166-2-lvl4"] ?? "").replace("BR-", ""),
          cep: (a["postcode"] ?? "").replace(/\D/g, ""),
        };
      });
    } catch {
      return [];
    }
  });
