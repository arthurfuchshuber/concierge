import { useEffect, useState } from "react";

/**
 * FOTO DE CAPA À PROVA DE LINK QUEBRADO (05/10/2026).
 *
 * As capas dos imóveis vêm do Airbnb (`a0.muscache.com`). Quando o anfitrião
 * troca ou apaga a foto lá, o endereço salvo passa a devolver 404 — e a tela
 * ficava com um quadrado escuro, sem explicação (caso "Casa Completa Próx. a
 * Avenida Turística": a 1ª foto saiu do ar, as outras três seguiam ótimas).
 *
 * Agora recebe a lista de candidatas (capa + galeria) e tenta uma a uma; só
 * quando TODAS falham aparece "Sem foto", e nunca um vazio.
 */
export function CoverImage({
  urls,
  className = "absolute inset-0 size-full object-cover",
  empty = true,
}: {
  urls: Array<string | null | undefined>;
  className?: string;
  /** Mostra "Sem foto" quando não há (ou nenhuma carrega). */
  empty?: boolean;
}) {
  const list = Array.from(new Set(urls.filter((u): u is string => !!u)));
  const key = list.join("|");
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [key]);
  const src = list[i];
  if (!src) {
    return empty ? (
      <div className="absolute inset-0 grid place-items-center text-[10px] text-muted-foreground">Sem foto</div>
    ) : null;
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setI((n) => n + 1)}
    />
  );
}
