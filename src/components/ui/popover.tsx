import * as React from "react";
import { OVERLAY_COLLISION_PADDING } from "@/components/ui/overlay-collision";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { guardNestedOutside, useOverlayLayer } from "@/lib/global-overlay-store";

import { cn } from "@/lib/utils";

/**
 * FUNDO COM DESFOQUE GLOBAL (pedido explícito, 24/09/2026): todo Popover do
 * sistema avisa a central (`pushGlobalOverlay`) quando abre/fecha — o véu em
 * si é desenhado uma única vez por `GlobalOverlayScrim`, no `__root`. Nada
 * muda para quem já usa `<Popover>` hoje: controlado ou não, com ou sem o
 * próprio `onOpenChange`, continua funcionando igual — só ganha esse aviso a
 * mais.
 */
const Popover = ({
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) => {
  return <PopoverPrimitive.Root onOpenChange={onOpenChange} {...props} />;
};

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, collisionPadding = OVERLAY_COLLISION_PADDING, ...props }, ref) => {
  const layerRef = useOverlayLayer("float");
  return (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // Espaçamento mínimo da borda da tela (pedido explícito): nenhum
      // popover/tooltip do sistema pode ficar "colado" na lateral do
      // viewport. Um chamador específico ainda pode sobrescrever passando
      // seu próprio collisionPadding.
      collisionPadding={collisionPadding}
      className={cn(
        // Tooltip/popover jamais pode abrir "para fora" da tela: limita a
        // altura ao espaço realmente disponível (a mesma variável que o
        // Radix já expõe e que o DropdownMenuContent do projeto já usa) e
        // rola por dentro em vez de estourar a viewport.
        // TAMANHO MÁXIMO DE TELA (pedido explícito, 24/09/2026): além de
        // nunca estourar o espaço disponível perto do gatilho, nenhum
        // tooltip pode passar de ~75% da ALTURA TOTAL do aparelho — daí o
        // `min(75dvh, …)`. `sg-elegant-scroll`: barra de rolagem fina,
        // visível e na cor da marca (pedido explícito: "elegante e
        // visível" — a nativa some sozinha em alguns navegadores/SOs).
        // z-[60]: acima do véu global (`GlobalOverlayScrim`, z-[55]) e do
        // overlay de Dialog (z-50) — corrigido no mesmo pedido do desfoque:
        // um Popover aberto dentro de um Dialog já aberto precisa continuar
        // nítido POR CIMA do véu que agora também cobre o conteúdo do Dialog.
        "sg-elegant-scroll z-[60] w-72 max-h-[min(75dvh,var(--radix-popover-content-available-height))] overflow-y-auto ds-overlay max-w-[calc(100vw-32px)] p-4  outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-popover-content-transform-origin)",
        className,
      )}
      {...props}
      onPointerDownOutside={guardNestedOutside(layerRef, props.onPointerDownOutside)}
      onInteractOutside={guardNestedOutside(layerRef, props.onInteractOutside)}
    />
  </PopoverPrimitive.Portal>
);
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
