import * as React from "react";
import { Clock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface TimePickerProps {
  value: string; // "HH:MM" or ""
  onChange: (value: string) => void;
  placeholder?: string;
  step?: number; // minutes; default 15
  className?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

function buildOptions(step: number) {
  const opts: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += step) {
      opts.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return opts;
}

export function TimePicker({
  value,
  onChange,
  placeholder = "Selecione um horário",
  step = 30,
  className,
  allowEmpty = true,
  emptyLabel = "Nenhum",
}: TimePickerProps) {
  const options = React.useMemo(() => buildOptions(step), [step]);

  // Ensure current value is selectable even if not in step grid
  const allOptions = React.useMemo(() => {
    if (value && /^\d{2}:\d{2}$/.test(value) && !options.includes(value)) {
      return [value, ...options].sort();
    }
    return options;
  }, [options, value]);

  const SENTINEL = "__none__";
  return (
    <Select
      value={value || (allowEmpty ? SENTINEL : "")}
      onValueChange={(v) => onChange(v === SENTINEL ? "" : v)}
    >
      <SelectTrigger className={cn("w-full", className)}>
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="size-4 text-muted-foreground shrink-0" />
          <SelectValue placeholder={placeholder} />
        </div>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {allowEmpty && <SelectItem value={SENTINEL}>{emptyLabel}</SelectItem>}
        {allOptions.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
