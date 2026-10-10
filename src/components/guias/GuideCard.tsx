import { CoverImage } from "@/components/ui/cover-image";
import type { ReactNode } from "react";
import { Globe, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { ownerLabel } from "@/components/dashboard/card-colors";

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
  selected,
  onSelectChange,
  actions,
  onOpenMenu,
}: {
  p: GuideCardData;
  variant: GuideCardVariant;
  score: number;
  barClass: string;
  toggling?: boolean;
  onTogglePublished: (next: boolean) => void;
  selected?: boolean;
  onSelectChange?: (v: boolean) => void;
  /** Menu "..." + lixeira. */
  actions: ReactNode;
  /**
   * Toque em qualquer ponto do card (10/10/2026, pedido explícito) abre o menu
   * "⋯" que já existe. Mesmo guarda dos cards do Kanban: cliques nascidos em
   * algo interativo (checkbox, chat, interruptor, o próprio ⋯) são ignorados,
   * então todo controle novo já nasce protegido.
   */
  onOpenMenu?: () => void;
}) {
  const openMenuOnClick = onOpenMenu
    ? (e: React.MouseEvent<HTMLElement>) => {
        const el = e.target as HTMLElement | null;
        const interactive = el?.closest(
          "button, a, input, select, textarea, label, [role='button'], [role='checkbox'], [role='switch'], [data-radix-popper-content-wrapper]",
        );
        if (interactive && interactive !== e.currentTarget) return;
        onOpenMenu();
      }
    : undefined;
  const access = (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-background/75 px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.12em] text-foreground/80 backdrop-blur">
      {p.access_mode === "pin" ? <Lock className="size-2.5" /> : <Globe className="size-2.5" />}
      {p.access_mode === "pin" ? "PIN" : "Público"}
    </span>
  );
  const pub = (withLabel: boolean) => (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-background/75 py-[2px] pr-0.5 backdrop-blur ${withLabel ? "pl-2" : "pl-0.5"}`}
      title={p.published ? "Publicado — toque para despublicar" : "Rascunho — toque para publicar"}
      onClick={(e) => e.stopPropagation()}
    >
      {withLabel && (
        <span className={`text-[9.5px] font-bold uppercase tracking-[0.12em] ${p.published ? "text-[#7fb79a]" : "text-[#d8b96a]"}`}>
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
        <div className="absolute right-1.5 top-1.5" onClick={(e) => e.stopPropagation()} title={p.published ? "Publicado — toque para despublicar" : "Rascunho — toque para publicar"}>
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
          <div className="absolute bottom-1.5 left-1.5">{access}</div>
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
            <PhoneActionButton phone={p.ownerPhone} country={p.ownerPhoneCountry} size={12} alwaysShow className="shrink-0" />
          </div>
        )}
        <span className="ds-card-title block truncate" title={p.name}>
          {p.name}
        </span>
        {place && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">{place}</span>}
      </div>
      <div className={`flex min-w-0 items-center gap-2 ${variant === "split" && onSelectChange ? "-mr-[18px]" : ""}`}>
        <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
          <div className={`h-full rounded-full ${barClass}`} style={{ width: `${score}%` }} />
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{score}%</span>
        <div className={`flex shrink-0 items-center ${variant === "split" && onSelectChange ? "w-3 justify-center overflow-visible" : ""}`}>{actions}</div>
      </div>
    </div>
  );

  const check = onSelectChange ? (
    <span className="absolute left-2 top-2 z-10 grid place-items-center rounded-[4px] bg-background/75 p-[3px] backdrop-blur" onClick={(e) => e.stopPropagation()}>
      <Checkbox className="!size-3 !rounded-[3px]" checked={!!selected} onCheckedChange={(v) => onSelectChange(!!v)} aria-label="Selecionar guia" />
    </span>
  ) : null;
  if (variant === "grid") {
    return (
      <div onClick={openMenuOnClick} className={`${PANEL_SHELL} relative flex min-w-0 flex-col ${onOpenMenu ? "cursor-pointer" : ""}`}>
        {check}
        {photo("aspect-[16/9] w-full", true)}
        <div className="flex min-w-0 p-3">{info}</div>
      </div>
    );
  }
  return (
    <div onClick={openMenuOnClick} className={`${PANEL_SHELL} relative flex min-h-[132px] min-w-0 ${onOpenMenu ? "cursor-pointer" : ""}`}>
      {onSelectChange && (
        <Checkbox
          className="absolute right-2.5 top-2.5 z-10 !size-3 !rounded-[3px] opacity-50"
          checked={!!selected}
          onCheckedChange={(v) => onSelectChange(!!v)}
          aria-label="Selecionar guia"
        />
      )}
      {/* FOTO QUASE QUADRADA NO COMPUTADOR (mockup aprovado, 02/10/2026: "as
          imagens dos imóveis fiquem no mesmo formato que o print 2, mais
          voltadas para quadrados"). No celular os 40% da largura já dão essa
          proporção; no desktop, com o cartão largo, 40% virava uma faixa
          comprida. A partir de `lg` a foto tem 141px — com os 132px de altura
          do cartão, a mesma proporção do celular (1,07:1). */}
      {photo("w-[40%] lg:w-[141px]", false, true)}
      <div className="flex min-w-0 flex-1 p-3 pr-7">{info}</div>
    </div>
  );
}
