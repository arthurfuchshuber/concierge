import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Home, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchBrAddress, type AddressSuggestion } from "@/lib/address-lookup.functions";

/** Campo de logradouro com sugestões enquanto a pessoa digita. */
export function AddressAutocomplete({
  value,
  label,
  error,
  cityHint,
  onChange,
  onPick,
}: {
  value: string;
  label: string;
  error?: string;
  cityHint?: string;
  onChange: (v: string) => void;
  onPick: (s: AddressSuggestion) => void;
}) {
  const searchFn = useServerFn(searchBrAddress);
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || value.trim().length < 4) {
      setItems([]);
      return;
    }
    const q = [value.trim(), cityHint?.trim()].filter(Boolean).join(", ");
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchFn({ data: { q } });
        setItems(res);
        setOpen(res.length > 0);
      } finally {
        setLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [value, cityHint]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="space-y-1.5 min-w-0" ref={boxRef}>
      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Home className="size-3.5" /> {label}
        {loading && <Loader2 className="size-3 animate-spin text-primary" />}
      </Label>
      <div className="relative">
        <Input
          maxLength={300}
          placeholder="Rua, avenida, número..."
          value={value}
          autoComplete="off"
          onFocus={() => items.length > 0 && setOpen(true)}
          onChange={(e) => {
            typed.current = true;
            onChange(e.target.value);
          }}
          className={`w-full ${error ? "border-destructive" : ""}`}
        />
        {open && items.length > 0 && (
          <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
            {items.map((s, i) => (
              <li key={`${s.label}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    typed.current = false;
                    onPick(s);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-xs leading-snug hover:bg-secondary"
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
