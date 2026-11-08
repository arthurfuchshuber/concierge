import { anyWindowOpenNow, dialogHandoffActive, guardNestedOutside, useOverlayLayer } from "@/lib/global-overlay-store";
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
>(({ className, ...props }, ref) => {
  const [skipFade] = React.useState(() => anyWindowOpenNow() || dialogHandoffActive());
  return (
  <DialogPrimitive.Overlay
    ref={ref}
    data-dialog-overlay
    className={cn(
      "fixed inset-0 z-50 bg-background/70 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      // Janela trocada por outra: sem fade, o véu já está lá (evita o "pisca").
      skipFade && "data-[state=open]:!animate-none",
      className,
    )}
    {...props}
  />
  );
});
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Janela obrigatória (sem "X"): só fecha quando a pessoa cumprir o que ela pede. */
    hideClose?: boolean;
    /**
     * JANELA "COMO PÁGINA" (regra global, 22/10/2026): no tablet e no celular (abaixo de `lg`) a
     * janela NÃO é tela cheia — fica logo abaixo do cabeçalho do sistema (60px + 20px de respiro),
     * com 10px nas laterais, sem "X": quem fecha é o "Voltar" no canto superior direito, na mesma
     * linha da data (`DialogDateRow`). No computador (lg+) segue centralizada, com o "X" de canto.
     * Janelas pequenas (confirmações, menus, passos) NÃO usam esta prop e mantêm o "X".
     */
    pageLike?: boolean;
    /** Véu desta janela (ex.: janela pequena POR CIMA de outra, que precisa deixar a de baixo visível). */
    overlayClassName?: string;
  }
>(({ className, children, hideClose, pageLike, overlayClassName, ...props }, ref) => {
  const [layerRef, layerNodeRef] = useOverlayLayer("window", useAntiClipWindow(ref));
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        ref={layerNodeRef}
        className={cn(
          // Teto de ~75% da altura da tela (pedido explícito, 24/09/2026),
          // ainda descontando o teclado (`--kb-inset`) e a margem de 3rem —
          // `min(...)` garante o menor dos dois. `sg-elegant-scroll`: barra de
          // rolagem fina e visível, igual aos demais tooltips/popovers.
          "sg-elegant-scroll fixed left-[50%] top-[50%] z-50 grid grid-cols-[minmax(0,1fr)] w-[calc(100%_-_2rem)] max-w-lg translate-x-[-50%] translate-y-[calc(-50%_-_var(--kb-inset,0px)_/_2)] gap-4 rounded-[var(--win-radius)] border border-[var(--panel-border)] bg-[var(--panel)] text-foreground p-5 sm:p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.05)] before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:content-[''] before:bg-[image:var(--panel-hair)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 max-h-[min(90dvh,calc(100dvh_-_var(--kb-inset,0px)_-_3rem))] overflow-y-auto overscroll-contain touch-pan-y",
          pageLike &&
            "max-lg:!left-[10px] max-lg:!top-[80px] max-lg:!h-[calc(100dvh_-_80px)] max-lg:!max-h-none max-lg:!w-[calc(100vw_-_20px)] max-lg:!max-w-none max-lg:!translate-x-0 max-lg:!translate-y-0 max-lg:!rounded-b-none max-lg:!border-b-0",
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
            // X OFICIAL (08/11/2026): BOTÃO estruturado, não ícone solto — 28px, cantos `rounded-lg`, fundo sutil
            // e borda suave, alinhado à linha do título (`top-3.5 right-4`; o cabeçalho reserva `pr-14`). Ícone
            // nítido de 16px, hover/foco visíveis e área de toque ampliada pelo `after` (sem mudar o desenho).
            // Mora AQUI para valer em todas as janelas; abaixo de `lg`, em janela "como página" (`pageLike`),
            // ele some e o "Voltar" (`DialogDateRow`) assume.
            className={cn(
              "absolute right-4 top-3.5 z-10 grid size-7 cursor-pointer place-items-center rounded-lg border border-border/40 bg-foreground/5 text-foreground/80 transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
              pageLike && "max-lg:hidden",
            )}
          >
            <X className="size-4" strokeWidth={2} />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

/**
 * Linha de topo das janelas "como página" (mockup aprovado, 22/10/2026): data dourada igual à das
 * páginas (`PageShell`) e, abaixo de `lg`, o "Voltar" alinhado à direita NA MESMA linha. No
 * computador o "Voltar" some (fecha pelo "X" de canto) e a linha reserva 40px para ele.
 */
const DialogDateRow = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const hoje = new Date()
    .toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .replace(/^\w/, (c) => c.toUpperCase());
  return (
    <div
      className={cn("flex min-w-0 items-center justify-between gap-3 lg:pr-10", className)}
      {...props}
    >
      <p className="ds-eyebrow ds-data truncate text-[10.5px] leading-[22px] tracking-[0.2em]">
        {hoje}
      </p>
      <DialogPrimitive.Close
        data-window-close
        className="inline-flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-md text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        Voltar
      </DialogPrimitive.Close>
    </div>
  );
};
DialogDateRow.displayName = "DialogDateRow";

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-left pr-12", className)} {...props} />
);

DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Rodapé que NUNCA some (celular): gruda na base da janela enquanto o corpo rola por cima.
      "sticky bottom-0 z-[4] flex shrink-0 flex-col-reverse gap-2 p-4 mt-1 border-t border-border/60 bg-card/60 backdrop-blur-sm sm:flex-row sm:justify-end sm:gap-2",
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
  DialogDateRow,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
