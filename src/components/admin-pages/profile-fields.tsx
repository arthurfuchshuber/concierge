import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Campos "sem caixa" do celular (direção E): rótulo pequeno em cima, valor em texto e só um fio embaixo. */
export const UHAIR = "border-foreground/[0.07]";
export const UROW = `flex h-[34px] min-w-0 items-center gap-2 border-b ${UHAIR} text-[14px] text-foreground tabular-nums focus-within:border-foreground/40`;
export const UINPUT_BARE =
  "h-full w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] text-foreground outline-none placeholder:text-[var(--faint)]";
export const UINPUT = `${UINPUT_BARE} border-b ${UHAIR} focus:border-foreground/40`;

export function UField({
  label,
  required,
  optional,
  info,
  badge,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  info?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-h-4 items-center gap-1.5">
        <label className="text-[11.5px] font-semibold text-[var(--faint)]">
          {label}
          {optional ? <span className="font-medium"> (Opcional)</span> : null}
          {required ? <span className="text-[#c98c8c]"> *</span> : null}
        </label>
        {badge}
        {info ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Mais informações" className="ml-auto flex cursor-pointer text-[var(--faint)]">
                <Info className="size-[13px]" strokeWidth={2} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[260px] max-w-[calc(100vw-32px)] p-3 text-[12px] leading-[1.45] text-muted-foreground">
              {info}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      {children}
    </div>
  );
}
