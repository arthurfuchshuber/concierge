import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Realtime de `city_references` por escopo (property_id OU group_id).
 * Não escuta mais por city_key — a lista NUNCA é compartilhada por cidade.
 */
export function useCityReferencesRealtime(
  scope: { propertyId?: string | null; groupId?: string | null },
  onChange: () => void,
) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const groupId = scope.groupId ?? null;
  const propertyId = scope.propertyId ?? null;

  useEffect(() => {
    // Quando há grupo, escuta o grupo; senão, escuta a property.
    const filter = groupId
      ? `group_id=eq.${groupId}`
      : propertyId
        ? `property_id=eq.${propertyId}`
        : null;
    if (!filter) return;
    const tag = groupId ?? propertyId;

    const channel = supabase
      .channel(`city-references:${tag}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "city_references", filter },
        () => onChangeRef.current(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, propertyId]);
}
