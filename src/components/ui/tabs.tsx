import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Nunca "overflow-hidden" (escondia abas que não cabiam em vez de
      // rolar) — sempre rolagem horizontal, nunca quebra em 2ª linha.
      // Cada aba é sua própria pílula com espaço entre elas, não um bloco
      // único de fundo compartilhado.
      "flex w-full max-w-full items-center justify-start gap-1.5 overflow-x-auto whitespace-nowrap text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Pílula própria, com borda quando inativa; o item ativo ganha o
      // gradiente da marca (mesmo tratamento do menu inferior/badges em
      // todo o resto do app), nunca só uma leve mudança de fundo.
      "shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs sm:text-sm font-medium ring-offset-background cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed hover:text-foreground data-[state=active]:border-transparent data-[state=active]:bg-gradient-to-br data-[state=active]:from-[#7C1AD8] data-[state=active]:to-[#E82DAE] data-[state=active]:text-white [&_svg]:inline [&_svg]:align-[-0.18em] [&_svg]:mr-1.5 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
