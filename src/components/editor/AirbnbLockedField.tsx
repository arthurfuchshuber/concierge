import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FILTER_PANEL_CLASS,
  FILTER_PANEL_COLLISION,
  FILTER_PANEL_OFFSET,
} from "@/components/dashboard/filter-panel";
import { cn } from "@/lib/utils";

/**
 * CAMPO PREENCHIDO PELO AIRBNB — travado, e com o MOTIVO a um toque.
 *
 * Pedido explícito (01/10/2026): "TRAVE TODOS os campos que recebem
 * informações automaticamente do Airbnb... e, quando o usuário tentar clicar
 * em cima, deverá visualizar o motivo de não conseguir editar tal campo".
 *
 * Com um anúncio conectado, o botão Importar SUBSTITUI esses campos inteiros
 * (decisão do cliente, 01/10/2026). Editar à mão seria perder o trabalho no
 * próximo Importar — por isso o campo vira só leitura, e quem tenta editar
 * descobre por quê, em vez de achar que a tela travou.
 *
 * O motivo abre no MESMO quadrante dos Filtros (casca, 16px de folga lateral,
 * 8px do campo). Véu com desfoque, limite de altura e "tocar fora fecha" vêm
 * do `PopoverContent` base — as regras de janela flutuante que valem para o
 * sistema inteiro.
 */

/** O texto do motivo — um lugar só, para todo campo travado dizer o mesmo. */
export const AIRBNB_LOCK_REASON =
  "Este campo é preenchido automaticamente pelo anúncio do Airbnb e, por isso, não pode ser editado aqui. Para mudar, altere no Airbnb e clique em Importar, na aba Airbnb.";

/** Quadrante do motivo. `children` é o gatilho (o próprio campo travado). */
export function AirbnbLockReason({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={FILTER_PANEL_OFFSET}
        collisionPadding={FILTER_PANEL_COLLISION}
        className={FILTER_PANEL_CLASS}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--panel-div)] px-3.5 py-3">
          <Lock className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="ds-eyebrow text-muted-foreground">Vem do Airbnb</span>
        </div>
        <div className="flex flex-col gap-1.5 px-3.5 py-3">
          {label ? (
            <p className="truncate text-[13px] font-semibold text-foreground">{label}</p>
          ) : null}
          <p className="text-[12px] leading-relaxed text-muted-foreground">{AIRBNB_LOCK_REASON}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * O valor travado, com a cara de um campo do formulário (36px, raio 8px) e o
 * cadeado à direita. Tocar nele abre o motivo.
 */
export function AirbnbLockedValue({
  value,
  label,
  placeholder = "Ainda não importado",
  multiline = false,
  className,
}: {
  value: string | null | undefined;
  /** Nome do campo, repetido no quadrante do motivo. */
  label?: string;
  placeholder?: string;
  /** Texto longo (regras, observações): quebra linha e respeita cada linha. */
  multiline?: boolean;
  className?: string;
}) {
  const has = !!(value ?? "").trim();
  return (
    <AirbnbLockReason label={label}>
      <button
        type="button"
        aria-label={label ? `${label} — por que não posso editar?` : "Por que não posso editar?"}
        className={cn(
          "flex w-full min-w-0 cursor-help gap-2 rounded-[0.5rem] bg-foreground/[0.04] px-3 text-left text-[13px] shadow-[inset_0_0_0_1px_var(--input)] transition-colors hover:bg-foreground/[0.06]",
          multiline ? "min-h-[84px] items-start py-2.5" : "h-9 items-center",
          className,
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1",
            multiline ? "whitespace-pre-line break-words leading-relaxed" : "truncate",
            has ? "text-foreground/90" : "italic text-muted-foreground",
          )}
        >
          {has ? value : placeholder}
        </span>
        <Lock className={cn("size-3.5 shrink-0 text-muted-foreground", multiline && "mt-0.5")} />
      </button>
    </AirbnbLockReason>
  );
}
