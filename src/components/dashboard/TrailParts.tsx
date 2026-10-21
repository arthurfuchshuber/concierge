import type { ReactNode } from "react";
import { Check, Home, MapPin, Search, User, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Peças da TRILHA DE PERGUNTAS do "+" (Nova limpeza e Novo registro): a
 * pergunta que recolhe com o check verde, o cartão de escolha e a lista em
 * poço com busca de uma linha. Ficam num arquivo próprio para o "+ Registro"
 * não precisar importar a Limpeza avulsa (e o servidor dela) só por isso.
 */

export function ddmm(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";
}
export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Uma pergunta da trilha: respondida, ativa ou futura. */
export function Step({
  n,
  active,
  done,
  last,
  question,
  answer,
  onReopen,
  children,
}: {
  n: number;
  active: boolean;
  done: boolean;
  last?: boolean;
  question: string;
  answer?: string;
  onReopen: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 pb-3.5">
      {!last && (
        <span
          aria-hidden
          className="absolute bottom-0.5 left-[10.5px] top-6 w-px bg-[var(--panel-div)]"
        />
      )}
      <span
        className={cn(
          "relative z-[1] grid size-[22px] place-items-center rounded-full text-[10.5px] font-extrabold",
          done
            ? "bg-[rgba(127,183,154,.16)] text-[#7fb79a]"
            : active
              ? "bg-accent/[0.14] text-accent"
              : "bg-foreground/[0.05] text-foreground/35",
        )}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 pt-[3px]">
        {done && !active ? (
          <button
            type="button"
            onClick={onReopen}
            title="Alterar esta resposta"
            className="block w-full min-w-0 text-left"
          >
            <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
              {question}
            </span>
            <span className="mt-0.5 block truncate text-[13px] font-bold leading-snug text-foreground">
              {answer}
            </span>
          </button>
        ) : (
          <span
            className={cn(
              "block text-[13px] leading-snug",
              active ? "font-bold text-foreground" : "font-medium text-foreground/40",
            )}
          >
            {question}
          </span>
        )}
        {active && children ? <div className="mt-2.5">{children}</div> : null}
      </div>
    </li>
  );
}

/** Cartão de escolha (passos 1 e 5) — mesmo poço dos chips do quadrante "Acesso". */
export function Choice({
  icon: Icon,
  title,
  sub,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 rounded-[10px] px-2.5 py-2.5 text-left transition-colors",
        selected
          ? "bg-accent/[0.12] ring-1 ring-inset ring-accent/60"
          : "bg-[var(--panel-well)] hover:bg-foreground/[0.07]",
      )}
    >
      <Icon
        className={cn("size-4", selected ? "text-accent" : "text-muted-foreground")}
        strokeWidth={2}
      />
      <span className="truncate text-[12.5px] font-bold text-foreground">{title}</span>
      <span className="text-[10.5px] leading-tight text-muted-foreground">{sub}</span>
    </button>
  );
}

/** Lista em poço, com busca opcional em UMA linha (reticências, nunca quebra). */
export function PickList({
  search,
  onSearch,
  placeholder,
  empty,
  children,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  placeholder?: string;
  empty: string | null;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] bg-[var(--panel-well)]">
      {onSearch && (
        <label className="flex h-8 min-w-0 items-center gap-2 border-b border-[var(--panel-div)] px-2.5">
          <Search className="size-3.5 shrink-0 text-foreground/40" />
          <input
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 truncate bg-transparent text-[12px] text-foreground outline-none placeholder:text-foreground/40"
          />
        </label>
      )}
      <div className="sg-elegant-scroll max-h-[min(48dvh,380px)] overflow-y-auto overscroll-contain">
        {empty ? (
          <p className="px-3.5 py-3 text-[12px] text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}


/**
 * JANELA DA TRILHA (pedido explícito, 20/10/2026, com prints): "abrir a
 * janela inteira e grande ao centro da tela" e "o passo a passo precisa seguir
 * sempre com o mesmo tamanho de janela". Altura FIXA (até 90% da tela) do
 * primeiro ao último passo; só o miolo rola. Cabeçalho e botão final fixos.
 */
export function TrailDialog({
  open,
  onOpenChange,
  title,
  progress,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  progress: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex h-[min(680px,90dvh)] w-[min(560px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden border-[var(--panel-border)] bg-[var(--panel)] p-0 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--panel-div)] py-3.5 pl-5 pr-14">
          <DialogTitle className="ds-eyebrow min-w-0 flex-1 text-muted-foreground">{title}</DialogTitle>
          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-foreground/55">{progress}</span>
        </div>
        <DialogDescription className="sr-only">Responda as perguntas, uma de cada vez.</DialogDescription>
        <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4">
          {children}
        </div>
        <div className="shrink-0 border-t border-[var(--panel-div)] px-5 py-3.5">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}

/** Linha de imóvel com foto, nome inteiro (quebra, nunca corta), proprietário e cidade. */
export function PropertyPickRow({
  name,
  photoUrl,
  ownerName,
  city,
  extra,
  selected,
  last,
  onClick,
}: {
  name: string;
  photoUrl?: string | null;
  ownerName?: string | null;
  city?: string | null;
  extra?: string | null;
  selected: boolean;
  last?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]",
        !last && "border-b border-[var(--panel-div)]",
        selected && "bg-accent/[0.10]",
      )}
    >
      <span className="relative size-14 shrink-0 overflow-hidden rounded-[10px] bg-foreground/[0.06]">
        {photoUrl ? (
          <img src={photoUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Home className="absolute inset-0 m-auto size-5 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        {extra ? (
          <span className="block text-[13px] font-bold leading-snug text-foreground">{extra}</span>
        ) : null}
        <span
          className={cn(
            "block break-words leading-snug",
            extra ? "text-[12px] text-foreground/80" : "text-[13px] font-semibold text-foreground",
          )}
        >
          {name}
        </span>
        {(ownerName || city) && (
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {ownerName && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <User className="size-3 shrink-0" />
                <span className="break-words">{ownerName}</span>
              </span>
            )}
            {city && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" />
                <span className="break-words">{city}</span>
              </span>
            )}
          </span>
        )}
      </span>
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full",
          selected ? "bg-accent text-accent-foreground" : "ring-1 ring-inset ring-foreground/20",
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3} />}
      </span>
    </button>
  );
}
