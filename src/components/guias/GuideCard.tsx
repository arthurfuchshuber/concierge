import type { ReactNode } from "react";
import { Globe, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { ownerLabel } from "@/components/dashboard/card-colors";

export type GuideCardVariant = "list" | "split";

export type GuideCardData = {
  id: string;
  name: string;
  city?: string | null;
  country?: string | null;
  tagline?: string | null;
  hero_image_url?: string | null;
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
}) {
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
  const photo = (cls: string, withLabel: boolean) => (
    <div className={`relative shrink-0 overflow-hidden bg-secondary ${cls}`}>
      {p.hero_image_url ? (
        <img src={p.hero_image_url} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-[10px] text-muted-foreground">Sem foto</div>
      )}
      {withLabel && <div className="absolute left-1.5 top-1.5">{access}</div>}
      <div className="absolute right-1 top-1">{pub(withLabel)}</div>
    </div>
  );
  const place = [p.city, p.country].filter(Boolean).join(", ");
  const info = (
    <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
      <div className="relative min-w-0 pr-6">
        {onSelectChange && (
          <Checkbox className="absolute right-0 top-0" checked={!!selected} onCheckedChange={(v) => onSelectChange(!!v)} aria-label="Selecionar guia" />
        )}
        {p.ownerName && (
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate text-[10.5px] text-muted-foreground" title={p.ownerName}>
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
      <div className="flex min-w-0 items-center gap-2">
        <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
          <div className={`h-full rounded-full ${barClass}`} style={{ width: `${score}%` }} />
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{score}%</span>
        <div className="flex shrink-0 items-center">{actions}</div>
      </div>
    </div>
  );

  if (variant === "split") {
    return (
      <div className={`${PANEL_SHELL} flex min-h-[132px] min-w-0`}>
        {photo("w-[40%]", true)}
        <div className="flex min-w-0 flex-1 p-3">{info}</div>
      </div>
    );
  }
  return (
    <div className={`${PANEL_SHELL} flex min-w-0 items-stretch gap-3 p-2.5`}>
      {photo("w-[76px] min-h-[76px] rounded-[10px]", false)}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-1">{access}</div>
        {info}
      </div>
    </div>
  );
}
