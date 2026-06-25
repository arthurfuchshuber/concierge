import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cityKey } from "@/lib/city-key";

export function useCityReferencesRealtime(cityLabel: string | null | undefined, onChange: () => void) {
  const key = cityKey(cityLabel);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
        () => onChangeRef.current(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [key]);
}