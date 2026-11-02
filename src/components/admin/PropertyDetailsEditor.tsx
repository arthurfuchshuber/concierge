import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ImagePlus, X, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useAutosave } from "@/hooks/useAutosave";
import { AudioRecorderButton } from "@/components/handoff/AudioRecorderButton";
import { usePresence, useLiveState } from "@/hooks/usePresence";
import { FieldTypingBadge } from "@/components/presence/FieldTypingBadge";
import {
  listPropertyDetails,
  savePropertyDetail,
  deletePropertyDetail,
  transcribeDetailAudio,
} from "@/lib/property-details.functions";

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(bin);
}

function DetailImages({ paths, onRemove }: { paths: string[]; onRemove?: (p: string) => void }) {
  const { data: urls } = useQuery({
    queryKey: ["detail-images", paths],
    enabled: paths.length > 0,
    queryFn: async () => {
      const out: Record<string, string> = {};
      for (const p of paths) {
        const { data } = await supabase.storage.from("property-images").createSignedUrl(p, 60 * 60);
        if (data?.signedUrl) out[p] = data.signedUrl;
      }
      return out;
    },
  });
  if (!paths.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {paths.map((p) => (
        <div key={p} className="relative size-20 rounded-lg overflow-hidden border border-border bg-muted/40">
          {urls?.[p] ? <img src={urls[p]} alt="" className="size-full object-cover" /> : null}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(p)}
              className="absolute top-0.5 right-0.5 size-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground"
              aria-label="Remover imagem"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * "Detalhamento do Imóvel": um único campo livre (redação contínua) que cresce
 * conforme o usuário escreve — sem blocos nem botão "adicionar detalhe".
 * Persiste em um único registro de `property_details`; registros antigos são
 * mesclados no texto e removidos ao salvar.
 */
export function usePrefetchPropertyDetails(propertyId: string | null | undefined) {
  const listFn = useServerFn(listPropertyDetails);
  const qc = useQueryClient();
  useEffect(() => {
    if (!propertyId) return;
    qc.prefetchQuery({
      queryKey: ["property-details", propertyId],
      queryFn: () => listFn({ data: { propertyId } }),
      staleTime: 5 * 60_000,
    });
  }, [propertyId, qc, listFn]);
}
