import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DatePickerProps {
  // value as ISO yyyy-MM-dd string (or "")
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
  fromYear?: number;
  toYear?: number;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Selecione uma data",
  className,
  disabled,
  allowClear = true,
  fromYear = 2000,
  toYear = new Date().getFullYear() + 5,
}: DatePickerProps) {
  const date = React.useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal h-10",
            !date && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-4 mr-2 shrink-0" />
          <span className="flex-1 truncate">
            {date ? format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : placeholder}
          </span>
          {allowClear && value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onChange("");
              }}
              className="ml-2 size-5 grid place-items-center rounded-md hover:bg-secondary"
              aria-label="Limpar data"
            >
              <X className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
          initialFocus
          locale={ptBR}
          captionLayout="dropdown-buttons"
          fromYear={fromYear}
          toYear={toYear}
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}

interface DateTimePickerProps {
  // value as "yyyy-MM-ddTHH:mm" (datetime-local format) or ""
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function DateTimePicker({ value, onChange, className }: DateTimePickerProps) {
  const [datePart, timePart] = React.useMemo(() => {
    if (!value) return ["", ""];
    const [d, t] = value.split("T");
    return [d ?? "", (t ?? "").slice(0, 5)];
  }, [value]);

  function emit(d: string, t: string) {
    if (!d && !t) return onChange("");
    if (d && t) return onChange(`${d}T${t}`);
    if (d) return onChange(`${d}T00:00`);
    onChange("");
  }

  return (
    <div className={cn("grid grid-cols-[1fr_auto] gap-2", className)}>
      <DatePicker value={datePart} onChange={(d) => emit(d, timePart)} />
      <TimePickerInline value={timePart} onChange={(t) => emit(datePart, t)} />
    </div>
  );
}

// Local import to avoid circular issues; reuse the TimePicker
import { TimePicker as TimePickerInline } from "./time-picker";
