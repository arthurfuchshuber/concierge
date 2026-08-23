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
    setUrl(null);
    createToken({ data: { slug } })
      .then((r) => {
        if (!active) return;
        const t = r?.token ? `&t=${encodeURIComponent(r.token)}` : "";
        setUrl(`/g/${slug}?preview=1${t}`);
      })
      .catch(() => {
        if (active) setUrl(`/g/${slug}?preview=1`);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return url;
}
