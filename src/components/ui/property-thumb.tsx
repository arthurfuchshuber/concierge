import { useState, type ReactNode } from "react";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Quadradinho do imóvel: mostra a foto principal e, se ela não carregar (link expirado no
 * Airbnb, por exemplo), tenta as próximas fotos da lista. Só cai para a casinha quando nenhuma
 * funciona ou não há foto. O tamanho e o raio vêm do `className`.
 */
export function PropertyThumb({
  src,
  fallbacks,
  className,
  iconClassName = "size-[18px]",
}: {
  src?: string | null;
  fallbacks?: string[] | null;
  className?: string;
  iconClassName?: string;
}): ReactNode {
  const urls = [...new Set([src, ...(fallbacks ?? [])].filter((u): u is string => !!u))];
  const [idx, setIdx] = useState(0);
  const current = urls[idx];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-foreground/[0.05] text-muted-foreground",
        className,
      )}
    >
      {current ? (
        <img
          key={current}
          src={current}
          alt=""
          loading="lazy"
          onError={() => setIdx((i) => i + 1)}
          className="size-full object-cover"
        />
      ) : (
        <Home className={iconClassName} />
      )}
    </span>
  );
}
