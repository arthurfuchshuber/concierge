import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

interface MaskedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  /** Padrão com "0" para dígitos. Ex.: "000.000.000-00" */
  mask: string;
  value: string;
  onValueChange: (raw: string, formatted: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
}

export function applyMask(raw: string, mask: string): string {
  let result = "";
  let i = 0;
  for (let m = 0; m < mask.length && i < raw.length; m++) {
    if (mask[m] === "0") {
      result += raw[i];
      i++;
    } else {
      result += mask[m];
    }
  }
  return result;
}

export function stripMask(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

function maxDigits(mask: string): number {
  return (mask.match(/0/g) || []).length;
}

export const MaskedInput = React.forwardRef<HTMLInputElement, MaskedInputProps>(
  ({ mask, value, onValueChange, label, error, hint, icon, className, ...props }, ref) => {
    const emit = (input: string) => {
      const raw = stripMask(input).slice(0, maxDigits(mask));
      onValueChange(raw, applyMask(raw, mask));
    };

    return (
      <div className="space-y-1.5">
        {label && <Label className="text-xs text-muted-foreground">{label}</Label>}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</div>
          )}
          <input
            ref={ref}
            type="text"
            inputMode="numeric"
            value={applyMask(stripMask(value), mask)}
            onChange={(e) => emit(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              emit(e.clipboardData.getData("text"));
            }}
            className={cn(
              "flex h-10 w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm transition-all",
              "placeholder:text-muted-foreground/50",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
              icon && "pl-10",
              error && "border-destructive focus:ring-destructive/30 focus:border-destructive",
              className,
            )}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    );
  },
);
MaskedInput.displayName = "MaskedInput";
