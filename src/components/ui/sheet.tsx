import { anyWindowOpenNow, guardNestedOutside, useOverlayLayer } from "@/lib/global-overlay-store";
"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { CORNER_CLOSE_CLASS } from "@/components/ui/corner-close";
import { splitWindowChildren, WindowBody } from "@/components/ui/window-body";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  const [skipFade] = React.useState(() => anyWindowOpenNow());
  return (
  <SheetPrimitive.Overlay
    data-dialog-overlay
    className={cn(
      "fixed inset-0 z-50 bg-background/70 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      // Janela trocada por outra: sem fade, o véu já está lá (evita o "pisca").
      skipFade && "data-[state=open]:!animate-none",
      className,
    )}
    {...props}
    ref={ref}
  />
  );
});
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Substitui o visual padrão do X (ex.: botão redondo de 32px, igual ao das janelas). */
  closeClassName?: string;
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, closeClassName, children, ...props }, ref) => {
  const [layerRef, layerNodeRef] = useOverlayLayer("window", ref);
  // ROLAGEM SÓ NO CONTEÚDO (08/11/2026): painel que rola (`overflow-y-auto` do chamador) vira casca fixa,
  // com cabeçalho/rodapé fora e a barra só na área do conteúdo.
  const wrapBody = /(^|\s)overflow-y-auto(\s|$)/.test(String(className ?? ""));
  const split = splitWindowChildren(children);
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={layerNodeRef}
        className={cn(sheetVariants({ side }), className, wrapBody && "flex flex-col !overflow-hidden")}
        {...props}
        onPointerDownOutside={guardNestedOutside(layerRef, props.onPointerDownOutside)}
        onInteractOutside={guardNestedOutside(layerRef, props.onInteractOutside)}
      >
        <SheetPrimitive.Close
          data-window-close
          className={
            closeClassName ??
            // MESMO X DE CANTO DAS JANELAS (pedido explícito, 21/10/2026): aba delicada de 32px
            // colada no canto superior direito. Painéis que passam `closeClassName` seguem com o seu.
            CORNER_CLOSE_CLASS
          }
        >
          <X className="size-[13px]" strokeWidth={1.8} />
          <span className="sr-only">Fechar</span>
        </SheetPrimitive.Close>
        {wrapBody ? (
          <>
            {split.head}
            {split.body.length > 0 ? <WindowBody>{split.body}</WindowBody> : null}
            {split.foot}
          </>
        ) : (
          children
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 pr-12 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
