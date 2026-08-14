import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Sparkles, RefreshCw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { getPropertyForQuickEdit, upsertProperty } from "@/lib/properties.functions";
import { syncPropertyAirbnbIcal } from "@/lib/airbnb-ical.functions";
import { enrichFromMapsLink } from "@/lib/maps.functions";
import { PropertyTypeSelect } from "@/components/admin/PropertyTypeSelect";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs font-medium text-foreground/80">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  );
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

type Edited = {
  name: string;
  property_type_id: string | null;
  maps_url: string;
  garage_maps_url: string;
  address: string;
  city: string;
  state: string;
  country: string;
  address_note: string;
  airbnb_ical_url: string | null;
  airbnb_ical_url_2: string | null;
  host_name: string;
  host_phone: string;
};

/**
 * Edição rápida do imóvel, em popup — sem sair da ficha do proprietário.
 * Só edita o subconjunto "core" (mesmos campos da tela "Informações do
 * imóvel"). Para o guia completo (checkin, checkout, FAQ, recomendações),
 * continua sendo preciso abrir o editor completo.
 *
 * Importante: carrega os dados via getPropertyForQuickEdit (SEM assinar
 * imagens) e reenvia o restante do imóvel (manual, FAQs, checkout,
 * recomendações, fotos etc.) exatamente como veio — nada aqui é
 * sobrescrito ou perdido, só o subconjunto editável nesta tela muda.
 */
export function PropertyQuickEditDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getPropertyForQuickEdit);
  const saveFn = useServerFn(upsertProperty);
  const syncFn = useServerFn(syncPropertyAirbnbIcal);
  const enrichFn = useServerFn(enrichFromMapsLink);

  const { data, isLoading } = useQuery({
    queryKey: ["property-quick-edit", propertyId],
    queryFn: () => fetchFn({ data: { id: propertyId } }),
    enabled: open,
  });

  const [edited, setEdited] = useState<Edited | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);

  useEffect(() => {
    if (!data?.property) return;
    const p = data.property as Record<string, unknown>;
    setEdited({
      name: (p.name as string) ?? "",
      property_type_id: (p.property_type_id as string | null) ?? null,
      maps_url: (p.maps_url as string) ?? "",
      garage_maps_url: (p.garage_maps_url as string) ?? "",
      address: (p.address as string) ?? "",
      city: (p.city as string) ?? "",
      state: (p.state as string) ?? "",
      country: (p.country as string) ?? "",
      address_note: (p.address_note as string) ?? "",
      airbnb_ical_url: (p.airbnb_ical_url as string | null) ?? null,
      airbnb_ical_url_2: (p.airbnb_ical_url_2 as string | null) ?? null,
      host_name: (p.host_name as string) ?? "",
      host_phone: (p.host_phone as string) ?? "",
    });
  }, [data]);

  function upd<K extends keyof Edited>(key: K, value: Edited[K]) {
    setEdited((e) => (e ? { ...e, [key]: value } : e));
  }

  async function handleEnrich() {
    if (!edited?.maps_url.trim()) {
      toast.error("Cole o link do Google Maps primeiro");
      return;
    }
    setEnriching(true);
    try {
      const r = await enrichFn({ data: { mapsUrl: edited.maps_url, propertyId } });
      setEdited((e) =>
        e
          ? {
              ...e,
              address: r.address || e.address,
              city: r.city || e.city,
              state: r.state || e.state,
              country: r.country || e.country,
            }
          : e,
      );
      toast.success("Endereço preenchido");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível buscar o endereço");
    } finally {
      setEnriching(false);
    }
  }

  async function handleSync() {
    if (!edited?.airbnb_ical_url?.trim()) {
      toast.error("Cole a URL do calendário Airbnb antes.");
      return;
    }
    setSyncing(true);
    try {
      await syncFn({
        data: {
          propertyId,
          icalUrl: edited.airbnb_ical_url.trim(),
          icalUrl2: edited.airbnb_ical_url_2?.trim() || null,
        },
      });
      toast.success("Calendário sincronizado");
      qc.invalidateQueries({ queryKey: ["property-quick-edit", propertyId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSave() {
    if (!edited || !data) return;
    if (!edited.name.trim()) {
      toast.error("Informe o nome do imóvel.");
      return;
    }
    setSaving(true);
    try {
      const raw = data.property as Record<string, unknown>;
      const payload = {
        id: propertyId,
        ownerId: null as string | null,
        property: {
          // Passa o resto do imóvel adiante intocado (fotos, wifi, senhas de
          // acesso, marca, idioma etc.) — só sobrescreve o que foi editado
          // aqui em cima da base crua (sem URLs assinadas).
          ...(raw as Record<string, unknown>),
          name: edited.name.trim(),
          slug: (raw.slug as string) || slugify(edited.name),
          property_type_id: edited.property_type_id,
          maps_url: edited.maps_url || null,
          garage_maps_url: edited.garage_maps_url || null,
          address: edited.address || null,
          city: edited.city || null,
          state: edited.state || null,
          country: edited.country || null,
          address_note: edited.address_note || null,
          airbnb_ical_url: edited.airbnb_ical_url || null,
          airbnb_ical_url_2: edited.airbnb_ical_url_2 || null,
          host_name: edited.host_name || null,
          host_phone: edited.host_phone || null,
        },
        manual: (data.manual ?? []) as Array<Record<string, unknown>>,
        emergency: (data.emergency ?? []) as Array<Record<string, unknown>>,
        faqs: (data.faqs ?? []) as Array<Record<string, unknown>>,
        checkout: (data.checkout ?? []) as Array<Record<string, unknown>>,
        recommendations: ((data.recommendations ?? []) as Array<Record<string, unknown>>).filter(
          (r) => r.scope === "nearby" && r.place_id && r.name,
        ),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveFn({ data: payload as any });
      toast.success("Imóvel atualizado");
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["my-properties"] });
      qc.invalidateQueries({ queryKey: ["property-quick-edit", propertyId] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "stakeholder-detail" });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar imóvel</DialogTitle>
          <DialogDescription>
            Edição rápida — nome, tipo, endereço, calendário e contato. Para o guia completo (checkin, checkout, FAQ), abra o imóvel.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !edited ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Nome do imóvel" required>
              <Input value={edited.name} maxLength={80} onChange={(e) => upd("name", e.target.value)} />
            </Field>

            <PropertyTypeSelect value={edited.property_type_id} onChange={(v) => upd("property_type_id", v)} />

            <Field label="Link do Google Maps — Entrada principal">
              <div className="flex gap-2">
                <Input value={edited.maps_url} onChange={(e) => upd("maps_url", e.target.value)} placeholder="https://maps.app.goo.gl/..." />
                <Button onClick={handleEnrich} disabled={enriching} variant="secondary" className="shrink-0">
                  {enriching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                </Button>
              </div>
            </Field>
            <Field label="Endereço">
              <Input value={edited.address} onChange={(e) => upd("address", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cidade"><Input value={edited.city} onChange={(e) => upd("city", e.target.value)} /></Field>
              <Field label="País"><Input value={edited.country} onChange={(e) => upd("country", e.target.value)} /></Field>
            </div>
            <Field label="Observação sobre o endereço">
              <Textarea value={edited.address_note} maxLength={1000} onChange={(e) => upd("address_note", e.target.value)} />
            </Field>

            <Field label="URL do calendário Airbnb (iCal)">
              <div className="flex gap-2">
                <Input
                  value={edited.airbnb_ical_url ?? ""}
                  onChange={(e) => upd("airbnb_ical_url", e.target.value.trim() || null)}
                  placeholder="https://www.airbnb.com/calendar/ical/12345.ics?s=..."
                />
                <Button onClick={handleSync} disabled={syncing || !edited.airbnb_ical_url?.trim()} variant="secondary" className="shrink-0">
                  {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  disabled={!edited.airbnb_ical_url?.trim()}
                  onClick={() => upd("airbnb_ical_url", null)}
                  title="Remover calendário"
                  aria-label="Remover calendário"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome do anfitrião"><Input value={edited.host_name} maxLength={120} onChange={(e) => upd("host_name", e.target.value)} /></Field>
              <Field label="Telefone (WhatsApp)"><Input value={edited.host_phone} maxLength={40} onChange={(e) => upd("host_phone", e.target.value)} /></Field>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
