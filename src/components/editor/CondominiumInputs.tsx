import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PARKING_SPOTS_MAX } from "@/lib/property-location";

/**
 * PEÇAS DO GRUPO "CONDOMÍNIO?" (mockup "Local dentro do prédio", aprovado
 * 01/10/2026). Usadas pelo editor do guia e pela edição em massa, para os dois
 * escreverem os mesmos campos do mesmo jeito.
 */

/**
 * Vagas de garagem: um campo por vaga e, logo abaixo do primeiro, o texto
 * discreto "Adicionar +" (pedido explícito: "só a frase, discreta, e bem
 * próxima ao campo da primeira vaga" — sem fundo e sem explicação). Cada vaga
 * extra ganha um "x" para remover; o "Adicionar +" desce junto, colado ao
 * último campo.
 */
export function ParkingSpotsInput({
  value,
  onChange,
  placeholder,
  idPrefix = "parking-spot",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  idPrefix?: string;
}) {
  const list = value.length ? value : [""];
  const set = (i: number, v: string) => onChange(list.map((s, j) => (j === i ? v : s)));
  const remove = (i: number) => onChange(list.filter((_, j) => j !== i));
  return (
    <div className="flex flex-col gap-1.5">
      {list.map((spot, i) => (
        <div key={i} className="relative">
          <Input
            id={`${idPrefix}-${i}`}
            value={spot}
            maxLength={40}
            inputMode="text"
            aria-label={list.length > 1 ? `Vaga ${i + 1}` : "Vaga de garagem"}
            placeholder={placeholder}
            onChange={(e) => set(i, e.target.value)}
            className={i > 0 ? "pr-9" : undefined}
          />
          {i > 0 && (
            <button
              type="button"
              aria-label={`Remover vaga ${i + 1}`}
              onClick={() => remove(i)}
              className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {list.length < PARKING_SPOTS_MAX && (
        <button
          type="button"
          onClick={() => onChange([...list, ""])}
          className="self-start py-0.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Adicionar +
        </button>
      )}
    </div>
  );
}

/**
 * Elevador: "Tem" / "Não tem". Tocar de novo na opção marcada volta a "não
 * informado" (nada é mostrado em lugar nenhum).
 */
export function ElevatorSegment({
  value,
  onChange,
  className,
}: {
  value: boolean | null | undefined;
  onChange: (next: boolean | null) => void;
  className?: string;
}) {
  const opts = [
    { v: true, label: "Tem" },
    { v: false, label: "Não tem" },
  ] as const;
  return (
    <div
      role="group"
      aria-label="Elevador"
      className={cn(
        "flex h-9 overflow-hidden rounded-[0.5rem] bg-foreground/[0.04] shadow-[inset_0_0_0_1px_var(--input)]",
        className,
      )}
    >
      {opts.map((o, i) => {
        const active = value === o.v;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : o.v)}
            className={cn(
              "flex-1 text-[12px] transition-colors",
              i > 0 && "border-l border-foreground/10",
              active
                ? "bg-foreground/[0.1] font-bold text-foreground shadow-[inset_0_1px_0_rgba(246,243,239,.1)]"
                : "font-semibold text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
