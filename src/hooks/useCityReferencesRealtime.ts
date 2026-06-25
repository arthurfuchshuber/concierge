import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cityKey } from "@/lib/city-key";

export function useCityReferencesRealtime(cityLabel: string | null | undefined, onChange: () => void) {
  const key = cityKey(cityLabel);

  useEffect(() => {
    if (!key) return;

    const channel = supabase
      .channel(`city-references:${key}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "city_references",
          filter: `city_key=eq.${key}`,
        },
        () => onChange(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [key, onChange]);
}