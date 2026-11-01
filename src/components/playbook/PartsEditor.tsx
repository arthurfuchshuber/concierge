import { MoneyInput } from "@/components/ui/money-input";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimePicker } from "@/components/ui/time-picker";
import { DURATION_OPTIONS, type PartDef, type PartGroup } from "@/lib/playbook-parts";

const EYEBROW = "mb-1.5 text-[10.5px] font-bold uppercase leading-tight tracking-[0.08em] text-muted-foreground";

function PartControl({ def, value, onChange, disabled }: { def: PartDef; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  if (def.kind === "money") {
    return (
      <MoneyInput
        cents={value === "" ? null : Number(value)}
        onChange={(c) => onChange(c == null ? "" : String(c))}
        disabled={disabled}
        className="h-9 rounded-[9px] text-[13px] font-medium"
      />
    );
  }
  if (def.kind === "duration") {
    return (
      <Select value={value} onValueChange={(v) => onChange(v)} disabled={disabled}>
        <SelectTrigger className="h-9 rounded-[9px] text-[13px] font-medium" aria-label={def.label}>
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          <div className="grid grid-cols-4 gap-1 p-1">
            {DURATION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)} className="justify-center rounded-md px-2 py-1.5 text-center tabular-nums">
                {o.label}
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
    );
  }
  if (def.kind === "time") {
    return <TimePicker value={value} onChange={onChange} className="h-9 rounded-[9px] text-[13px]" />;
  }
  if (def.kind === "bool") {
    return (
      <div role="radiogroup" aria-label={def.label} className="flex gap-1.5">
        {([["true", "Sim"], ["false", "Não"]] as const).map(([v, label]) => {
          const on = value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(v)}
              className={`inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-[9px] border text-[12.5px] font-semibold transition-colors ${
                on ? "border-foreground/12 bg-foreground/10 text-foreground" : "border-foreground/5 bg-foreground/[0.04] text-muted-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <Input
      value={value}
      maxLength={40}
      placeholder={def.placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-[9px] text-[13px] font-medium"
    />
  );
}

/**
 * Campos compostos do Dossiê (opção B aprovada): cada grupo num cartão com barra lateral, e cada parte com o MESMO
 * controle do guia do imóvel (dinheiro, duração de 30 em 30 min, horário, Sim/Não, texto curto).
 */
export function PartsEditor({
  groups,
  values,
  onChange,
  disabled,
}: {
  groups: PartGroup[];
  values: Record<string, string>;
  onChange: (id: string, v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((g) => {
        const visible = g.parts.filter((d) => !d.showWhen || values[d.showWhen] === "true");
        const single = visible.length === 1;
        return (
          <section
            key={g.id}
            aria-label={g.title}
            className="relative rounded-xl border border-foreground/[0.07] bg-[var(--card-surface)] py-3 pl-4 pr-3 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-xl before:bg-[#8d857f] before:content-['']"
          >
            <div className="mb-2.5 text-[13px] font-bold leading-[18px] text-foreground">{g.title}</div>
            <div className={`grid gap-2.5 ${single || visible.some((d) => d.kind === "bool") ? "grid-cols-1" : "grid-cols-2"}`}>
              {visible.map((d) => (
                <div key={d.id} className="min-w-0">
                  <div className={EYEBROW}>{d.label}</div>
                  <PartControl def={d} value={values[d.id] ?? ""} onChange={(v) => onChange(d.id, v)} disabled={disabled} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
