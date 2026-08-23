import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createGuidePreviewToken } from "@/lib/guide-preview.functions";

/**
 * URL de pré-visualização do guia. Busca um token assinado para que guias
 * ainda em rascunho (não publicados) também possam ser visualizados.
 * Retorna null enquanto o token não chegou.
 */
export function useGuidePreviewUrl(slug: string | null | undefined) {
  const createToken = useServerFn(createGuidePreviewToken);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!slug) {
      setUrl(null);
      return;
    }
    // Mostra o guia imediatamente; o token (que libera rascunhos) chega depois.
    setUrl(`/g/${slug}?preview=1`);
    createToken({ data: { slug } })
      .then((r) => {
        if (!active || !r?.token) return;
        setUrl(`/g/${slug}?preview=1&t=${encodeURIComponent(r.token)}`);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return url;
}
