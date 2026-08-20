import { cn } from "@/lib/utils";

/**
 * Presença "digitando" (ref.: mockup 05_padroes_sistema/05_presenca_digitando).
 * Faixa com ponto pulsante, nome de quem digita em destaque e um trecho de
 * prévia do texto sendo digitado.
 */
export function TypingIndicator({
  name,
  preview,
  className,
}: {
  name: string;
  preview?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "ds-surface flex items-center gap-2 border border-primary/30 bg-primary/5 px-3 py-2.5",
        className,
      )}
    >
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      <p className="ds-body min-w-0 truncate">
        <span className="font-semibold text-primary">{name} está digitando:</span>{" "}
        {preview ? <span className="text-muted-foreground">"{preview}"</span> : null}
      </p>
    </div>
  );
}
