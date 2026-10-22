import { guardNestedOutside, useOverlayLayer } from "@/lib/global-overlay-store";
import { useAntiClipWindow } from "@/hooks/useAntiClipWindow";
("use client");

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-background/70 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Janela obrigatória (sem "X"): só fecha quando a pessoa cumprir o que ela pede. */
    hideClose?: boolean;
    /**
     * TELA CHEIA NO TABLET E NO CELULAR (pedido explícito, 21/10/2026): abaixo de `lg` a janela
     * ocupa a tela inteira, sem margem nas laterais nem no topo, e o "X" de canto fica colado
     * no canto superior direito. No computador (lg+) a janela continua centralizada como antes.
     */
    bleed?: boolean;
  }
>(({ className, children, hideClose, bleed, ...props }, ref) => {
  const [layerRef, layerNodeRef] = useOverlayLayer("window", useAntiClipWindow(ref));
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={layerNodeRef}
        className={cn(
          // Teto de ~75% da altura da tela (pedido explícito, 24/09/2026),
          // ainda descontando o teclado (`--kb-inset`) e a margem de 3rem —
          // `min(...)` garante o menor dos dois. `sg-elegant-scroll`: barra de
          // rolagem fina e visível, igual aos demais tooltips/popovers.
          "sg-elegant-scroll fixed left-[50%] top-[50%] z-50 grid grid-cols-[minmax(0,1fr)] w-[calc(100%_-_2rem)] max-w-lg translate-x-[-50%] translate-y-[calc(-50%_-_var(--kb-inset,0px)_/_2)] gap-4 rounded-[var(--win-radius)] border border-[var(--panel-border)] bg-[var(--panel)] text-foreground p-5 sm:p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.05)] before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:content-[''] before:bg-[image:var(--panel-hair)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 max-h-[min(90dvh,calc(100dvh_-_var(--kb-inset,0px)_-_3rem))] overflow-y-auto",
          bleed &&
            "max-lg:!left-0 max-lg:!top-0 max-lg:!h-[100dvh] max-lg:!max-h-none max-lg:!w-screen max-lg:!max-w-none max-lg:!translate-x-0 max-lg:!translate-y-0 max-lg:!rounded-none max-lg:!border-0",
          className,
        )}
        {...props}
        onPointerDownOutside={guardNestedOutside(layerRef, props.onPointerDownOutside)}
        onInteractOutside={guardNestedOutside(layerRef, props.onInteractOutside)}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            data-window-close
            // X DE CANTO MAIS DELICADO (pedido explícito, 21/10/2026, mockup aprovado): aba de 32px
            // (era 44px), canto de 12px, fundo e fio de luz mais leves e ícone de 13px com traço 1.8.
            // Mora AQUI para valer em todas as janelas; abaixo de `lg`, em janela de tela cheia
            // (`bleed`), o canto superior direito é reto.
            className={cn(
              "absolute right-0 top-0 z-[5] grid size-8 cursor-pointer place-items-center rounded-bl-[12px] rounded-tr-[calc(var(--win-radius,12px)-1px)] bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] text-muted-foreground shadow-[inset_1px_-1px_0_color-mix(in_oklab,var(--foreground)_9%,transparent)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
              bleed && "max-lg:!rounded-tr-none",
            )}
          >
            <X className="size-[13px]" strokeWidth={1.8} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-left pr-12", className)} {...props} />
);

DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 pt-4 mt-1 border-t border-border/50 sm:flex-row sm:justify-end sm:gap-2",
      className,
    )}

    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
