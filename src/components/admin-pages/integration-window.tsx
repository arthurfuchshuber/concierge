import type { ReactNode } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAntiClipRows } from "@/hooks/useAntiClipRows";
import { cn } from "@/lib/utils";

/**
 * JANELAS DAS INTEGRAÇÕES (mockups aprovados, 08/11/2026 — ClickSign e Google Agenda).
 * Peças comuns às duas janelas, no padrão das janelas do sistema: título 14px e subtitulo 12px
 * à esquerda (com respiro para o X de canto), botões suaves para alternar visões, corpo que rola
 * com a regra anticorte (`data-clip-row`) e rodapé com o botão verde principal + quadrados de 28px.
 *
 * `inWindow`: dentro da janela (celular) as peças levam os recuos de 16px da janela e o cabeçalho;
 * fora dela (cartão expandido no computador) ficam sem cabeçalho e sem recuo próprio.
 */

/** Classe da casca da janela (DialogContent) das integrações: sem rolagem própria, até 90% da tela. */
export const INTEGRATION_WINDOW_CLASS =
  "flex max-h-[min(90dvh,calc(100dvh_-_var(--kb-inset,0px)_-_3rem))] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-md";

export type StatusTone = "ok" | "warn" | "bad" | "neutral";

const TONE_COLOR: Record<Exclude<StatusTone, "neutral">, string> = {
  ok: "#7fb79a",
  warn: "#c9a962",
  bad: "#c98c8c",
};

/** Etiqueta de status (cantos de 5px, cor do status). */
export function StatusTag({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const color = tone === "neutral" ? null : TONE_COLOR[tone];
  return (
    <span
      className={cn(
        "inline-flex h-[17px] shrink-0 items-center whitespace-nowrap rounded-[5px] px-1.5 text-[10px] leading-none",
        color ? "font-bold" : "bg-foreground/[0.07] font-semibold text-muted-foreground",
      )}
      style={
        color
          ? { color, backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)` }
          : undefined
      }
    >
      {children}
    </span>
  );
}

/** Botões suaves de alternância (regra de janelas: nada de barra de abas dentro de janela). */
export function SoftToggles<K extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: ReadonlyArray<{ key: K; label: string }>;
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 gap-2", className)}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={value === it.key}
          onClick={() => onChange(it.key)}
          className={cn(
            "h-9 min-w-0 flex-1 truncate rounded-[10px] border px-2 text-xs transition-colors",
            value === it.key
              ? "border-foreground/[0.12] bg-foreground/10 font-bold text-foreground"
              : "border-foreground/5 bg-foreground/[0.04] font-semibold text-muted-foreground hover:text-foreground",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Botão principal verde da fileira de ações (28px). */
export function PrimaryAction({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-2 rounded-[7px] bg-emerald-600 px-2.5 text-[12px] font-semibold leading-none tracking-tight text-white transition-colors hover:bg-emerald-600/90 disabled:opacity-60"
    >
      <span className="grid shrink-0 place-items-center [&_svg]:size-3.5">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Quadrado de ação da fileira (28px, fundo padrão dos quadrados). */
export function ActionSquare({
  label,
  children,
  onClick,
  disabled,
  active,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-[7px] border-0 text-foreground transition-colors hover:bg-primary/[0.08] disabled:opacity-50 [&_svg]:size-3.5",
        active ? "bg-primary/[0.08]" : "bg-[var(--action-sq-bg)]",
      )}
    >
      {children}
    </button>
  );
}

/** "⋯" com as ações secundárias — nas integrações, só "Desconectar". */
export function DisconnectMenu({
  onDisconnect,
  disabled,
}: {
  onDisconnect: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Mais Ações"
          title="Mais Ações"
          className="grid size-7 shrink-0 place-items-center rounded-[7px] border-0 bg-[var(--action-sq-bg)] text-foreground transition-colors hover:bg-primary/[0.08] data-[state=open]:bg-primary/[0.08]"
        >
          <MoreHorizontal className="size-3.5" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-48">
        <DropdownMenuItem
          onSelect={onDisconnect}
          disabled={disabled}
          className="text-[#e06666] focus:text-[#e06666]"
        >
          <Trash2 className="mr-2 size-3.5" /> Desconectar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Campo único (valor + botão no fim), sem divisória entre os dois. */
export function MergedField({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="flex h-9 min-w-0 items-center rounded-[10px] border border-border bg-[color-mix(in_oklab,var(--card),var(--background)_55%)]">
        <span className="min-w-0 flex-1 pl-3 pr-2">{children}</span>
        {action}
      </span>
    </label>
  );
}

/** Botão no fim do campo único (ícone, sem fundo próprio). */
export function FieldAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="grid h-full w-[42px] shrink-0 place-items-center text-foreground/80 transition-colors hover:text-foreground [&_svg]:size-[15px]"
    >
      {children}
    </button>
  );
}

/** Passo numerado (quadradinho centralizado ao texto). */
export function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-foreground/[0.08] text-[10.5px] font-bold tabular-nums text-foreground/90">
        {n}
      </span>
      <span className="min-w-0 text-[12px] leading-[1.45] text-foreground/85">{children}</span>
    </div>
  );
}

/**
 * Casca das integrações: cabeçalho (só na janela), botões suaves, corpo com rolagem anticorte e
 * rodapé fixo. O corpo recebe os itens já com `data-clip-row` onde houver linhas de lista.
 */
export function IntegrationShell({
  inWindow,
  title,
  subtitle,
  toggles,
  above,
  footer,
  bodyDeps,
  children,
  icon,
}: {
  inWindow: boolean;
  title: string;
  subtitle?: ReactNode;
  /** Ícone no cabeçalho da janela (janelas Bancos e Asaas PJ, mockup 10/11/2026). */
  icon?: ReactNode;
  toggles?: ReactNode;
  /** Linha fixa entre os botões suaves e a lista (ex.: "3 Selecionados"). */
  above?: ReactNode;
  footer?: ReactNode;
  bodyDeps: unknown[];
  children: ReactNode;
}) {
  const bodyRef = useAntiClipRows<HTMLDivElement>(bodyDeps);
  return (
    <>
      {inWindow ? (
        <DialogHeader className={cn("shrink-0 px-4 pr-12 text-left", icon ? "pt-4" : "pt-3")}>
          {icon ? (
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-border/70 bg-muted text-foreground [&_svg]:size-4">
                {icon}
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-base font-extrabold leading-5">{title}</DialogTitle>
                {subtitle ? (
                  <div className="!mt-0.5 truncate text-[11.5px] leading-[15px] text-muted-foreground">{subtitle}</div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <DialogTitle className="truncate text-sm font-bold leading-6">{title}</DialogTitle>
              {subtitle ? (
                <div className="!mt-0 truncate text-xs leading-5 text-muted-foreground">{subtitle}</div>
              ) : null}
            </>
          )}
        </DialogHeader>
      ) : null}
      {toggles ? (
        <div className={cn("shrink-0", inWindow ? "px-4 pt-3" : "")}>{toggles}</div>
      ) : null}
      {above ? (
        <div className={cn("shrink-0", inWindow ? "px-4 pt-3" : "pt-3")}>{above}</div>
      ) : null}
      <div
        ref={bodyRef}
        className={cn(
          "sg-elegant-scroll grid min-h-0 grid-cols-[minmax(0,1fr)] content-start overflow-y-auto overscroll-contain",
          inWindow ? "flex-1 px-4 pt-2.5" : "max-h-[440px] pt-2.5",
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className={cn("shrink-0", inWindow ? "px-4 pb-4 pt-3" : "pt-3")}>
          <div className="flex items-center gap-1.5">{footer}</div>
        </div>
      ) : null}
    </>
  );
}
