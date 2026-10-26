import { CoverImage } from "@/components/ui/cover-image";
import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { ownerLabel } from "@/components/dashboard/card-colors";
import { useLongPress } from "@/hooks/useLongPress";

export type GuideCardVariant = "split" | "grid";

export type GuideCardData = {
  id: string;
  name: string;
  city?: string | null;
  country?: string | null;
  tagline?: string | null;
  hero_image_url?: string | null;
  gallery_images?: string[] | null;
  access_mode?: string | null;
  published?: boolean | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  ownerPhoneCountry?: string | null;
};

/**
 * Cartão de guia no padrão dos cartões do Dashboard (casca `PANEL_SHELL`,
 * título `ds-card-title`, proprietário neutro com contato, cidade discreta).
 * Três variantes: lista (miniatura), lado a lado (foto 40% com selos em cima)
 * e grade (foto em cima). Nada pode cortar na margem direita: todo texto
 * tem `min-w-0` + `truncate` e os controles são `shrink-0`.
 */
export function GuideCard({
  p,
  variant,
  score,
  barClass,
  toggling,
  onTogglePublished,
  actions,
  onOpenMenu,
  attention,
  selected,
  selectionMode,
  onToggleSelect,
  onLongPressSelect,
}: {
  p: GuideCardData;
  variant: GuideCardVariant;
  score: number;
  barClass: string;
  toggling?: boolean;
  onTogglePublished: (next: boolean) => void;
  /** Menu de ações (Popover ancorado ao card inteiro). */
  actions: ReactNode;
  /**
   * Toque em qualquer ponto do card (10/10/2026, pedido explícito) abre o menu
   * "⋯" que já existe. Mesmo guarda dos cards do Kanban: cliques nascidos em
   * algo interativo (checkbox, chat, interruptor, o próprio ⋯) são ignorados,
   * então todo controle novo já nasce protegido.
   */
  onOpenMenu?: () => void;
  /** Seleção em lote SEM checkbox: o card selecionado ganha anel de destaque. */
  selected?: boolean;
  /** Há algum card selecionado: o toque só alterna a seleção (não abre o menu). */
  selectionMode?: boolean;
  onToggleSelect?: () => void;
  /** Pressionar e segurar (~500ms) entra no modo de seleção com este card. */
  onLongPressSelect?: () => void;
  /** Guia publicado que precisa de atenção (selo rosado sobre a foto). */
  attention?: boolean;
}) {
  const { handlers: pressHandlers, consumeClick } = useLongPress(() => onLongPressSelect?.());
  const onCardClick = (e: React.MouseEvent<HTMLElement>) => {
    if (consumeClick()) return; // o toque longo já selecionou: não abre o menu
    const el = e.target as HTMLElement | null;
    const interactive = el?.closest(
      "button, a, input, select, textarea, label, [role='button'], [role='checkbox'], [role='switch'], [data-radix-popper-content-wrapper]",
    );
    if (interactive && interactive !== e.currentTarget) return;
    if (selectionMode) onToggleSelect?.();
    else onOpenMenu?.();
  };
  const interactiveCard = !!onOpenMenu || !!onToggleSelect;
  const cardProps = {
    onClick: interactiveCard ? onCardClick : undefined,
    ...(onLongPressSelect ? pressHandlers : {}),
  };
  const cardFx = `select-none [-webkit-touch-callout:none] transition-all duration-150 ${
    selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/[0.04]" : ""
  } ${interactiveCard ? "cursor-pointer" : ""}`;
  const pub = (withLabel: boolean) => (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-background/75 py-[2px] pr-0.5 backdrop-blur ${withLabel ? "pl-2" : "pl-0.5"}`}
      title={p.published ? "Publicado — toque para despublicar" : "Rascunho — toque para publicar"}
      onClick={(e) => e.stopPropagation()}
    >
      {withLabel && (
        <span
          className={`text-[9.5px] font-bold uppercase tracking-[0.12em] ${p.published ? "text-[#7fb79a]" : "text-[#d8b96a]"}`}
        >
          {p.published ? "Publicado" : "Rascunho"}
        </span>
      )}
      <Switch
        checked={!!p.published}
        disabled={toggling}
        onCheckedChange={onTogglePublished}
        className="scale-[0.65] origin-right data-[state=checked]:bg-[#7fb79a] data-[state=unchecked]:bg-[#d8b96a]"
        aria-label="Alternar publicação"
      />
    </span>
  );
  const photo = (cls: string, withLabel: boolean, bare = false) => (
    <div className={`relative shrink-0 overflow-hidden bg-secondary ${cls}`}>
      <CoverImage urls={[p.hero_image_url, ...(p.gallery_images ?? [])]} />
      {bare ? (
        <div
          className="absolute right-1.5 top-1.5"
          onClick={(e) => e.stopPropagation()}
          title={
            p.published ? "Publicado — toque para despublicar" : "Rascunho — toque para publicar"
          }
        >
          <Switch
            checked={!!p.published}
            disabled={toggling}
            onCheckedChange={onTogglePublished}
            className="scale-[0.7] origin-top-right data-[state=checked]:bg-[#7fb79a] data-[state=unchecked]:bg-[#d8b96a]"
            aria-label="Alternar publicação"
          />
        </div>
      ) : (
        <>
          <div className="absolute right-1 top-1">{pub(withLabel)}</div>
        </>
      )}
    </div>
  );
  const place = [p.city, p.country].filter(Boolean).join(", ");
  const info = (
    <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
      <div className="min-w-0">
        {p.ownerName && (
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate text-[10.5px] text-foreground" title={p.ownerName}>
              {ownerLabel(p.ownerName)}
            </span>
            <PhoneActionButton
              phone={p.ownerPhone}
              country={p.ownerPhoneCountry}
              size={12}
              alwaysShow
              className="shrink-0 p-0.5"
            />
          </div>
        )}
        <span className="ds-card-title block truncate" title={p.name}>
          {p.name}
        </span>
        {place && (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
            {place}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
          <div className={`h-full rounded-full ${barClass}`} style={{ width: `${score}%` }} />
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{score}%</span>
      </div>
    </div>
  );

  if (variant === "grid") {
    return (
      <div
        {...cardProps}
        aria-selected={selected || undefined}
        className={`${PANEL_SHELL} relative flex min-w-0 flex-col ${cardFx}`}
      >
        {photo("aspect-[16/9] w-full", true)}
        <div className="flex min-w-0 p-3">{info}</div>
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {actions}
        </div>
      </div>
    );
  }
  // LAYOUT DOS IMÓVEIS (mockup aprovado, 13/10/2026): foto colada à esquerda
  // com o status sobre ela, título → cidade → proprietário + ⋯ e a completude
  // como barra fina na base. PIN/Público vira selo no canto da foto; o
  // interruptor de publicação mora no menu ⋯.
  const tone = attention ? "text-[#c98c8c]" : p.published ? "text-[#7fb79a]" : "text-[#d8b96a]";
  const statusLabel = attention ? "Atenção" : p.published ? "Publicado" : "Rascunho";
  return (
    <div
      {...cardProps}
      aria-selected={selected || undefined}
      className={`${PANEL_SHELL} relative flex h-[112px] min-w-0 overflow-hidden ${cardFx}`}
    >
      <div className="relative w-24 shrink-0 overflow-hidden bg-secondary">
        <CoverImage urls={[p.hero_image_url, ...(p.gallery_images ?? [])]} />
        <span
          className={`absolute left-2 top-2 inline-flex h-[22px] items-center gap-1.5 rounded-full bg-background/70 px-2.5 text-[10.5px] font-extrabold shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] backdrop-blur-sm ${tone}`}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {statusLabel}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-3 pl-3.5 pr-2.5">
        <div className="grid min-w-0 gap-1.5">
          <span
            className="block truncate text-[14.5px] font-extrabold leading-tight"
            title={p.name}
          >
            {p.name}
          </span>
          {place && (
            <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{place}</span>
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {p.ownerName ? (
            <span className="flex min-w-0 items-center gap-1 text-xs">
              <span className="shrink-0 text-[11.5px] text-muted-foreground">Proprietário(a):</span>
              <span className="min-w-0 truncate font-semibold text-foreground" title={p.ownerName}>
                {p.ownerName}
              </span>
              <PhoneActionButton
                phone={p.ownerPhone}
                country={p.ownerPhoneCountry}
                size={13}
                alwaysShow
                className="shrink-0 p-0.5"
              />
            </span>
          ) : (
            <span />
          )}
                  </div>
      </div>
      {/* Âncora do menu de ações: cobre o card inteiro, sem capturar toques. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {actions}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-[3px] bg-foreground/10"
        title={`Guia ${score}% completo`}
        aria-label={`Guia ${score}% completo`}
      >
        <div className={`h-full ${barClass}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
