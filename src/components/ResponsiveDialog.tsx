import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

/**
 * Painel responsivo: dialog centralizado no desktop, bottom-sheet (drawer)
 * no mobile — mesmo conteúdo, mesma API do Dialog do shadcn.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        {children}
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  );
}

export function ResponsiveDialogContent({
  className,
  children,
  scrollable = true,
}: {
  className?: string;
  children: React.ReactNode;
  /**
   * true (padrão, comportamento inalterado): o conteúdo inteiro (cabeçalho +
   * corpo + rodapé) rola como um bloco único — é preciso descer até o fim
   * para alcançar o rodapé.
   * false: o próprio conteúdo controla o scroll internamente (ex.: cabeçalho
   * e rodapé fixos, só a área do meio rola) — use quando o rodapé precisa
   * ficar sempre visível na tela.
   */
  scrollable?: boolean;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerContent className={cn("max-h-[92dvh] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]", className)}>
        {scrollable ? <div className="overflow-y-auto">{children}</div> : children}
      </DrawerContent>
    );
  }
  return (
    <DialogContent className={cn(!scrollable && "p-0 sm:p-0 gap-0 overflow-y-hidden flex flex-col", className)}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveDialogHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? DrawerHeader : DialogHeader;
  return <Comp className={cn(isMobile && "px-0 text-left", className)}>{children}</Comp>;
}

export function ResponsiveDialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? DrawerTitle : DialogTitle;
  return <Comp className={className}>{children}</Comp>;
}

export function ResponsiveDialogDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? DrawerDescription : DialogDescription;
  return <Comp className={className}>{children}</Comp>;
}

export function ResponsiveDialogFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? DrawerFooter : DialogFooter;
  return <Comp className={cn(isMobile && "px-0", className)}>{children}</Comp>;
}
