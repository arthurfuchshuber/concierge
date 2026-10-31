import type { ReactNode } from "react";
import { CoverImage } from "@/components/ui/cover-image";

/**
 * CABEÇALHO COM A FOTO DO IMÓVEL (mockup aprovado, 22/10/2026).
 *
 * Sem caixinha de miniatura: a foto ocupa o cabeçalho INTEIRO (encosta nas bordas da janela)
 * e um degradê na cor do cartão — da esquerda para a direita e de baixo para cima — mantém os
 * textos legíveis. Usado em "Ver informações do imóvel" e nas "Instruções de Check-In/Checkout".
 */
export function PropertyPhotoHeader({
  urls,
  children,
}: {
  urls: Array<string | null | undefined>;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0 overflow-hidden rounded-t-[inherit]">
      {/* Capa levemente desfocada (regra 12, 31/10/2026): blur 1,5 px, 90% de brilho. */}
      <div className="absolute inset-0 origin-center scale-[1.04] [filter:blur(1.5px)_brightness(.9)]">
        <CoverImage urls={urls} empty={false} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,var(--panel)_0%,color-mix(in_oklab,var(--panel)_82%,transparent)_45%,color-mix(in_oklab,var(--panel)_35%,transparent)_100%),linear-gradient(180deg,transparent_35%,var(--panel)_100%)]"
      />
      <div className="relative flex min-w-0 items-center gap-3 px-4 pb-5 pt-5 pr-14">
        {children}
      </div>
    </div>
  );
}
