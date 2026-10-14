import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BookOpen, Copy, ExternalLink, Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CoverImage } from "@/components/ui/cover-image";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import type { PropertyListItem } from "./property-actions";
import {
  accessItemsOf,
  airbnbUrlOf,
  fullAddressOf,
  hasActiveGuide,
  openPublicGuide,
} from "./property-actions";

/**
 * JANELA "VER INFORMAÇÕES" DO IMÓVEL (mockup G1, 13/10/2026). Só leitura:
 *   · "Acesso" (porta, Wi-Fi) — dados do próprio sistema, só com copiar;
 *   · "Do Airbnb" — tudo o que chega automaticamente pela conexão com o
 *     Airbnb. Esses campos são SEMPRE bloqueados aqui (cadeado): para mudar,
 *     o usuário edita direto no anúncio, pelo botão "Abrir no Airbnb".
 * Rodapé: Abrir no Airbnb + Guia (sem "Editar", pois o dado de origem só se
 * edita no anúncio). Mesma casca/linhas da janela "Detalhes da limpeza".
 */
function copy(value: string, label: string) {
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`${label} copiado`))
    .catch(() => toast.error("Não foi possível copiar"));
}

function InfoRow({
  label,
  children,
  aside,
}: {
  label: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="grid min-h-[36px] grid-cols-[112px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1">
      <span className="text-[9.5px] font-extrabold uppercase leading-tight tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-[13px] font-bold">{children}</span>
      {aside ?? <span />}
    </div>
  );
}

function CopyBtn({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => copy(value, label)}
      title={`Copiar ${label.toLowerCase()}`}
      aria-label={`Copiar ${label.toLowerCase()}`}
      className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
    >
      <Copy className="size-[13px]" />
    </button>
  );
}

function Locked() {
  return (
    <span
      title="Vem do Airbnb. Para alterar, edite no anúncio."
      className="grid size-6 place-items-center text-muted-foreground/60"
    >
      <Lock className="size-[13px]" />
    </span>
  );
}

function SectionTitle({ children, extra }: { children: ReactNode; extra?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
      {extra && <em className="not-italic tracking-[0.04em] text-muted-foreground/60">{extra}</em>}
      <i className="h-px flex-1 bg-foreground/[0.08]" />
    </div>
  );
}

export function PropertyInfoDialog({
  property,
  active,
  ownerName,
  ownerPhone,
  ownerPhoneCountry,
  onOpenChange,
}: {
  property: PropertyListItem | null;
  active: boolean;
  ownerName: string;
  ownerPhone?: string | null;
  ownerPhoneCountry?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const p = property;
  const airbnb = p ? airbnbUrlOf(p) : null;
  const address = p ? fullAddressOf(p) : "";
  const guide = p ? hasActiveGuide(p) : false;
  const capacity = p
    ? [
        p.airbnb_guest_count ? `${p.airbnb_guest_count} hóspedes` : null,
        p.airbnb_bedroom_count ? `${p.airbnb_bedroom_count} quartos` : null,
        p.airbnb_bed_count ? `${p.airbnb_bed_count} camas` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const access = p ? accessItemsOf(p) : [];
  const checkin = p?.checkin_time?.slice(0, 5) || "";
  const checkout = p?.checkout_time?.slice(0, 5) || "";
  const hasAirbnbData = !!(address || checkin || checkout || capacity);
  return (
    <Dialog open={!!p} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[75dvh] w-[min(420px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        {p && (
          <>
            <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4 pr-14">
              <span className="relative size-12 shrink-0 overflow-hidden rounded-[10px] bg-secondary">
                <CoverImage urls={[p.hero_image_url, ...(p.gallery_images ?? [])]} empty={false} />
              </span>
              <div className="min-w-0">
                <DialogTitle
                  className="block truncate text-[14px] font-bold leading-tight"
                  title={p.name}
                >
                  {p.name}
                </DialogTitle>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-[11.5px]">
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 font-bold ${active ? "ds-ok" : "ds-atencao"}`}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-current" />
                    {active ? "Ativo" : "Inativo"}
                  </span>
                </div>
                {ownerName ? (
                  <div className="mt-0.5 flex min-w-0 items-center text-[11.5px]">
                    <span className="shrink-0 text-muted-foreground">Proprietário(a):</span>
                    <span className="ml-1.5 min-w-0 truncate font-semibold">{ownerName}</span>
                    <PhoneActionButton
                      phone={ownerPhone}
                      country={ownerPhoneCountry}
                      size={13}
                      alwaysShow
                      className="shrink-0"
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <DialogDescription className="sr-only">
              Informações do imóvel: acesso e dados sincronizados do Airbnb.
            </DialogDescription>
            <div className="sg-elegant-scroll grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto px-4 pb-3">
              {access.length > 0 && (
                <>
                  <SectionTitle>Acesso</SectionTitle>
                  <div className="divide-y divide-foreground/[0.08] overflow-hidden rounded-[var(--win-radius)] bg-foreground/[0.04]">
                    {access.map((it) => (
                      <InfoRow
                        key={it.key}
                        label={it.label}
                        aside={<CopyBtn value={it.value} label={it.label} />}
                      >
                        <span className="tracking-[0.14em]">{it.value}</span>
                      </InfoRow>
                    ))}
                    {p.wifi_ssid && (
                      <InfoRow
                        label="Wi-Fi"
                        aside={<CopyBtn value={p.wifi_ssid} label="Nome do Wi-Fi" />}
                      >
                        {p.wifi_ssid}
                      </InfoRow>
                    )}
                    {p.wifi_password && (
                      <InfoRow
                        label="Senha do Wi-Fi"
                        aside={<CopyBtn value={p.wifi_password} label="Senha do Wi-Fi" />}
                      >
                        {p.wifi_password}
                      </InfoRow>
                    )}
                  </div>
                </>
              )}
              {hasAirbnbData && (
                <>
                  <SectionTitle extra="bloqueado">
                    <Lock className="size-[11px]" />
                    Do Airbnb
                  </SectionTitle>
                  <div className="divide-y divide-foreground/[0.08] overflow-hidden rounded-[var(--win-radius)] bg-foreground/[0.04]">
                    {address && (
                      <InfoRow
                        label="Endereço"
                        aside={<CopyBtn value={address} label="Endereço" />}
                      >
                        {address}
                      </InfoRow>
                    )}
                    {checkin && (
                      <InfoRow label="Entrada" aside={<Locked />}>
                        {checkin}
                      </InfoRow>
                    )}
                    {checkout && (
                      <InfoRow label="Saída" aside={<Locked />}>
                        {checkout}
                      </InfoRow>
                    )}
                    {capacity && (
                      <InfoRow label="Capacidade" aside={<Locked />}>
                        {capacity}
                      </InfoRow>
                    )}
                  </div>
                </>
              )}
              {access.length === 0 && !p.wifi_ssid && !p.wifi_password && !hasAirbnbData && (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                  Nenhuma informação cadastrada para este imóvel.
                </p>
              )}
            </div>
            <div className="grid shrink-0 grid-cols-[1.4fr_1fr] gap-2 px-4 pb-4 pt-1">
              <Button asChild={!!airbnb} disabled={!airbnb} className="gap-2">
                {airbnb ? (
                  <a href={airbnb} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-3.5" /> Abrir no Airbnb
                  </a>
                ) : (
                  <span>
                    <ExternalLink className="size-3.5" /> Abrir no Airbnb
                  </span>
                )}
              </Button>
              {guide ? (
                <Button variant="outline" className="gap-2" onClick={() => openPublicGuide(p.slug)}>
                  <BookOpen className="size-3.5" /> Guia
                </Button>
              ) : (
                <Button variant="outline" asChild className="gap-2">
                  <Link to="/admin/properties/$id" params={{ id: p.id }}>
                    <Plus className="size-3.5" /> Guia
                  </Link>
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
