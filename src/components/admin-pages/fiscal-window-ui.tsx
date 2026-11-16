import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Lock, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Peças das janelas "Notas Fiscais (NFS-e)" (mockups A–R, 16/11/2026). Padrão de campo das janelas:
 * rótulo 12/16px em uma linha só, caixa de 36px com cantos de 10px, adornos à direita de 34px
 * (cadeado = dado da Receita, seta = lista, lupa = busca, "%" = percentual).
 */
export const BOX =
  "flex h-9 min-w-0 items-center rounded-[10px] border border-border bg-[color-mix(in_oklab,var(--card),var(--background)_55%)]";
export const INPUT = "min-w-0 flex-1 bg-transparent px-3 text-[13px] outline-none disabled:cursor-default";
const ADORN = "grid h-full w-[34px] shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5";

export function Field({ label, optional, children, className, style }: { label: string; optional?: boolean; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <label className={cn("grid min-w-0 gap-1.5", className)} style={style}>
      <span className="truncate whitespace-nowrap text-[12px] leading-4 text-muted-foreground">
        {label}
        {optional ? <span className="opacity-75"> (opcional)</span> : null}
      </span>
      {children}
    </label>
  );
}

/** Campo bloqueado: dado que veio sozinho da Receita Federal (cadeado). */
export function LockedField({ label, value, className, style, optional }: { label: string; value: string; className?: string; style?: React.CSSProperties; optional?: boolean }) {
  return (
    <Field label={label} optional={optional} className={className} style={style}>
      <span className={BOX}>
        <input readOnly tabIndex={-1} value={value} aria-readonly="true" className={cn(INPUT, "text-muted-foreground/80")} />
        <span className={ADORN} aria-hidden><Lock /></span>
      </span>
    </Field>
  );
}

export function TextField({
  label, value, onChange, optional, className, style, adornment, inputMode, maxLength, type, autoComplete, placeholder, onFocus,
}: {
  label: string; value: string; onChange: (v: string) => void; optional?: boolean; className?: string; style?: React.CSSProperties;
  adornment?: ReactNode; inputMode?: "numeric" | "decimal" | "text" | "email" | "tel"; maxLength?: number; type?: string; autoComplete?: string; placeholder?: string; onFocus?: () => void;
}) {
  return (
    <Field label={label} optional={optional} className={className} style={style}>
      <span className={BOX}>
        <input
          type={type ?? "text"} inputMode={inputMode} autoComplete={autoComplete ?? "off"} maxLength={maxLength} placeholder={placeholder} value={value}
          onFocus={onFocus} onChange={(e) => onChange(e.target.value)} className={INPUT}
        />
        {adornment ? <span className={ADORN}>{adornment}</span> : null}
      </span>
    </Field>
  );
}

export function PercentField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <TextField
      label={label} value={value} inputMode="decimal" maxLength={6} className="flex-1"
      onChange={(v) => onChange(v.replace(/[^0-9,.]/g, ""))}
      adornment={<span className="text-[12px] font-semibold">%</span>}
    />
  );
}

export function TextAreaField({ label, value, onChange, optional, maxLength }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean; maxLength?: number }) {
  return (
    <Field label={label} optional={optional}>
      <textarea
        value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)}
        className="h-16 min-w-0 resize-none rounded-[10px] border border-border bg-[color-mix(in_oklab,var(--card),var(--background)_55%)] px-3 py-2 text-[13px] leading-[1.4] outline-none"
      />
    </Field>
  );
}

/** Lista suspensa no padrão das janelas: caixa com seta e lista flutuante (✓ no atual). */
export function SelectField<V extends string | number>({ label, value, options, onChange, className }: { label: string; value: V; options: ReadonlyArray<{ value: V; label: string }>; onChange: (v: V) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <Field label={label} className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn(BOX, "w-full text-left")}>
            <span className="min-w-0 flex-1 truncate px-3 text-[13px]">{cur?.label ?? ""}</span>
            <span className={ADORN}><ChevronDown /></span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
          {options.map((o) => (
            <button
              key={String(o.value)} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
              className="flex w-full min-w-0 items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12.5px] hover:bg-foreground/[0.06]"
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.value === value ? <Check className="size-3.5 shrink-0" /> : null}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </Field>
  );
}

/** Campo com lupa: ao digitar abre a lista de resultados "**código** - descrição". */
export function SearchField<R extends { code: string; description: string }>({
  label, value, onChange, results, format, onPick, optional, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; results: R[]; format: (code: string) => string; onPick: (r: R) => void; optional?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Field label={label} optional={optional}>
      <Popover open={open && results.length > 0} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <span className={BOX}>
            <input
              value={value} placeholder={placeholder} autoComplete="off" onFocus={() => setOpen(true)}
              onChange={(e) => { onChange(e.target.value); setOpen(true); }} className={INPUT}
            />
            <span className={ADORN}><Search /></span>
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" onOpenAutoFocus={(e) => e.preventDefault()} className="w-[var(--radix-popover-trigger-width)] p-1">
          {results.map((r) => (
            <button
              key={r.code} type="button" onClick={() => { onPick(r); setOpen(false); }}
              className="block w-full min-w-0 rounded-[7px] px-2.5 py-2 text-left text-[12px] leading-[1.4] hover:bg-foreground/[0.06]"
            >
              <span className="line-clamp-2"><b>{format(r.code)}</b> - {r.description}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </Field>
  );
}

/** Caixa informativa (chave/valor ou texto). */
export function InfoBox({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 rounded-[12px] border border-border bg-[var(--card-surface)] p-3 text-[12px] leading-[1.5]">{children}</div>;
}
export function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate font-semibold">{v}</span>
    </div>
  );
}

/** Faixa de aviso (vermelho suave / âmbar suave). */
export function Banner({ tone, icon, children }: { tone: "bad" | "warn"; icon: ReactNode; children: ReactNode }) {
  const color = tone === "bad" ? "#c98c8c" : "#c9a962";
  return (
    <div role={tone === "bad" ? "alert" : undefined} className="flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[12px] leading-[1.45]" style={{ color, backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}>
      <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
