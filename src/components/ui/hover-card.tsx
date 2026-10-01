import * as React from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";

import { cn } from "@/lib/utils";
import { guardNestedOutside, useOverlayLayer } from "@/lib/global-overlay-store";

const HoverCard = HoverCardPrimitive.Root;

const HoverCardTrigger = HoverCardPrimitive.Trigger;

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const [layerRef, layerNodeRef] = useOverlayLayer("float", ref);
  return (
  <HoverCardPrimitive.Content
    ref={layerNodeRef}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      "z-[60] w-64 ds-overlay max-w-[calc(100vw-32px)] p-4 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-hover-card-content-transform-origin)",
      className,
    )}
    {...props}
    onPointerDownOutside={guardNestedOutside(layerRef, props.onPointerDownOutside)}
    onInteractOutside={guardNestedOutside(layerRef, props.onInteractOutside)}
  />
  );
});
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardTrigger, HoverCardContent };
