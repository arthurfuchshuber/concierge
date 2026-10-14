import { useState, type ReactNode } from "react";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Quadradinho do imóvel: mostra a foto principal quando existe; sem foto (ou se ela falhar
 * ao carregar) volta para o ícone da casinha. O tamanho e o raio vêm do `className`.
 */
export function PropertyThumb({
  src,
  className,
  iconClassName = "size-[18px]",
}: {
  src?: string | null;
  className?: string;
  iconClassName?: string;
}): ReactNode {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-foreground/[0.05] text-muted-foreground",
        className,
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <Home className={iconClassName} />
      )}
    </span>
  );
}
