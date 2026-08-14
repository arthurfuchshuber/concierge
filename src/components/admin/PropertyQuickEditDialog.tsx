import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  RefreshCw,
  Trash2,
  Home,
  MapPinned,
  ClipboardCheck,
  BookOpen,
  NotebookPen,
  UserRound,
  Plus,
  ChevronDown,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Section, SectionGroup } from "@/components/editor/Section";
import { getPropertyForQuickEdit, upsertProperty } from "@/lib/properties.functions";
import { syncPropertyAirbnbIcal, listPropertyReservations } from "@/lib/airbnb-ical.functions";
import { enrichFromMapsLink } from "@/lib/maps.functions";
import { PropertyTypeSelect } from "@/components/admin/PropertyTypeSelect";
import { PropertyDetailsEditor } from "@/components/admin/PropertyDetailsEditor";

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

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-5 text-center text-xs text-muted-foreground leading-relaxed">
      {text}
    </div>
  );
}

function ItemCard({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="group bg-background border border-border/60 rounded-xl p-3.5 pr-10 space-y-2.5 relative hover:border-border transition-colors">
      {children}
      <button
        onClick={onRemove}
        aria-label="Remover"
        className="absolute top-2.5 right-2.5 p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors opacity-60 group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

type ManualItem = { title: string; description: string; body: string };

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
  house_rules: string;
  airbnb_ical_url: string | null;
  airbnb_ical_url_2: string | null;
  host_name: string;
  host_phone: string;
};

/**
 * Edição do imóvel em popup — espelho EXATO da aba "A casa" do editor
 * completo: mesmas seções, mesma ordem, mesmos campos (tipo, endereço,
 * calendário Airbnb, regras do espaço, manual da casa, detalhamento do
 * imóvel e contato do anfitrião).
 *
 * Carrega via getPropertyForQuickEdit (SEM assinar imagens) e reenvia o
 * restante do imóvel (fotos, checkin, checkout, FAQ, recomendações) intacto.
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
  const reservationsFn = useServerFn(listPropertyReservations);

  const { data, isLoading } = useQuery({
    queryKey: ["property-quick-edit", propertyId],
    queryFn: () => fetchFn({ data: { id: propertyId } }),
    enabled: open,
  });

  const reservationsQuery = useQuery({
    queryKey: ["property-reservations", propertyId],
    queryFn: () => reservationsFn({ data: { propertyId } }),
    enabled: open,
  });

  const [edited, setEdited] = useState<Edited | null>(null);
  const [manual, setManual] = useState<ManualItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [showIcal2, setShowIcal2] = useState(false);

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
      house_rules: (p.house_rules as string) ?? "",
      airbnb_ical_url: (p.airbnb_ical_url as string | null) ?? null,
      airbnb_ical_url_2: (p.airbnb_ical_url_2 as string | null) ?? null,
      host_name: (p.host_name as string) ?? "",
      host_phone: (p.host_phone as string) ?? "",
    });
    setManual(
      ((data.manual ?? []) as Array<Record<string, unknown>>).map((m) => ({
        title: (m.title as string) ?? "",
        description: (m.description as string) ?? "",
        body: (m.body as string) ?? "",
      })),
    );
  }, [data]);

  function upd<K extends keyof Edited>(key: K, value: Edited[K]) {
    setEdited((e) => (e ? { ...e, [key]: value } : e));
  }

  const lastSyncAt = (data?.property as Record<string, unknown> | undefined)?.airbnb_ical_last_sync_at as string | null | undefined;
  const lastSyncError = (data?.property as Record<string, unknown> | undefined)?.airbnb_ical_last_error as string | null | undefined;

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
      qc.invalidateQueries({ queryKey: ["property-reservations", propertyId] });
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
          // acesso, marca, idioma etc.) — só sobrescreve o que foi editado aqui.
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
          house_rules: edited.house_rules || null,
          airbnb_ical_url: edited.airbnb_ical_url || null,
          airbnb_ical_url_2: edited.airbnb_ical_url_2 || null,
          host_name: edited.host_name || null,
          host_phone: edited.host_phone || null,
        },
        manual: manual
          .filter((m) => m.title.trim())
          .map((m) => ({ title: m.title.trim(), description: m.description || null, body: m.body || null })),
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
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar imóvel</DialogTitle>
          <DialogDescription>
            Mesma tela da aba "A casa" do editor completo. Para checkin, checkout, FAQ e recomendações, abra o guia.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !edited ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <>
            <SectionGroup>
              <Section id="qe-name" icon={Home} title="Nome do imóvel" desc="Como você identifica essa residência internamente." collapsible={false}>
                <Field label="Nome" required>
                  <Input value={edited.name} maxLength={80} onChange={(e) => upd("name", e.target.value)} />
                </Field>
              </Section>

              <Section id="property-type" icon={Home} title="Tipo do imóvel" desc="Ajuda a organizar seus imóveis — as opções são totalmente editáveis." collapsible={false}>
                <PropertyTypeSelect value={edited.property_type_id} onChange={(v) => upd("property_type_id", v)} />
              </Section>

              <Section id="address" icon={MapPinned} title="Endereço e localização" desc="Cole o link do Google Maps e use Auto-preencher." collapsible>
                <Field label="Link do Google Maps — Entrada principal" required>
                  <div className="flex gap-2">
                    <Input value={edited.maps_url} onChange={(e) => upd("maps_url", e.target.value)} placeholder="https://maps.app.goo.gl/..." />
                    <Button onClick={handleEnrich} disabled={enriching} variant="secondary" className="shrink-0">
                      {enriching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                      <span className="ml-1.5 hidden sm:inline">{enriching ? "Buscando…" : "Auto-preencher"}</span>
                    </Button>
                  </div>
                </Field>
                <Field label="Link do Google Maps — Garagem (opcional)" hint="Aparece como um segundo botão de localização no guia.">
                  <Input value={edited.garage_maps_url} onChange={(e) => upd("garage_maps_url", e.target.value)} placeholder="https://maps.app.goo.gl/..." />
                </Field>
                <Field label="Endereço">
                  <Input value={edited.address} onChange={(e) => upd("address", e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cidade"><Input value={edited.city} onChange={(e) => upd("city", e.target.value)} /></Field>
                  <Field label="País"><Input value={edited.country} onChange={(e) => upd("country", e.target.value)} /></Field>
                </div>
                <Field label="Observação sobre o endereço" hint="Ponto de referência, instruções para o motorista, etc.">
                  <Textarea value={edited.address_note} maxLength={1000} onChange={(e) => upd("address_note", e.target.value)} />
                </Field>
              </Section>

              <Section id="airbnb-calendar" icon={RefreshCw} title="Calendário e reservas (Airbnb)" desc="Sincronize para habilitar dashboard, calendário e kanban — funciona mesmo sem publicar um guia." collapsible>
                <Field label="URL do calendário Airbnb" hint="No Airbnb: Anúncio → Calendário → Disponibilidade → Exportar calendário. Sincroniza a cada 30 minutos.">
                  <div className="flex gap-2">
                    <Input
                      value={edited.airbnb_ical_url ?? ""}
                      onChange={(e) => upd("airbnb_ical_url", e.target.value.trim() || null)}
                      placeholder="https://www.airbnb.com/calendar/ical/12345.ics?s=..."
                    />
                    <Button onClick={handleSync} disabled={syncing || !edited.airbnb_ical_url?.trim()} variant="secondary" className="shrink-0">
                      {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      <span className="ml-1.5 hidden sm:inline">{syncing ? "Sincronizando…" : "Sincronizar"}</span>
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

                {showIcal2 || (edited.airbnb_ical_url_2 ?? "").trim() ? (
                  <Field label="2º calendário (outro anúncio do mesmo imóvel)" hint="Use quando o imóvel tem mais de um anúncio no Airbnb. As reservas dos dois calendários são unificadas.">
                    <div className="flex gap-2">
                      <Input
                        value={edited.airbnb_ical_url_2 ?? ""}
                        onChange={(e) => upd("airbnb_ical_url_2", e.target.value.trim() || null)}
                        placeholder="https://www.airbnb.com/calendar/ical/67890.ics?s=..."
                      />
                      <Button onClick={handleSync} disabled={syncing || !(edited.airbnb_ical_url_2 ?? "").trim()} variant="secondary" className="shrink-0">
                        {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        <span className="ml-1.5 hidden sm:inline">{syncing ? "Sincronizando…" : "Sincronizar"}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => { upd("airbnb_ical_url_2", null); setShowIcal2(false); }}
                        title="Remover 2º calendário"
                        aria-label="Remover 2º calendário"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </Field>
                ) : (
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setShowIcal2(true)}>
                      + Adicionar 2º calendário
                    </Button>
                  </div>
                )}

                {(lastSyncAt || lastSyncError) && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                    {lastSyncAt && <span>Última sincronização: {new Date(lastSyncAt).toLocaleString("pt-BR")}</span>}
                    {lastSyncError && <span className="text-destructive">Erro: {lastSyncError}</span>}
                  </div>
                )}

                {reservationsQuery.data?.reservations && reservationsQuery.data.reservations.length > 0 && (
                  <details className="group rounded-xl border border-border bg-muted/30">
                    <summary className="list-none cursor-pointer select-none px-3 py-2.5 flex items-center justify-between text-xs font-semibold">
                      <span>Próximas reservas ({reservationsQuery.data.reservations.length})</span>
                      <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <ul className="px-3 pb-3 space-y-1.5 max-h-56 overflow-y-auto">
                      {reservationsQuery.data.reservations.map((r) => (
                        <li key={r.id} className="text-xs flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
                          <span className="font-medium">
                            {new Date(`${r.checkin_date}T12:00:00`).toLocaleDateString("pt-BR")} → {new Date(`${r.checkout_date}T12:00:00`).toLocaleDateString("pt-BR")}
                          </span>
                          {r.guest_hint && <span className="text-muted-foreground font-mono text-[10px]">{r.guest_hint}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Section>

              <Section id="house-rules" icon={ClipboardCheck} title="Regras do espaço" desc="Uma regra por linha — cada linha vira um item numerado no guia." collapsible>
                <Field label="Regras (opcional)" hint="Uma regra por linha. Linhas em branco são ignoradas.">
                  <Textarea
                    value={edited.house_rules}
                    maxLength={3000}
                    rows={6}
                    onChange={(e) => upd("house_rules", e.target.value)}
                    placeholder={"Não é permitido fumar dentro do imóvel.\nFestas e eventos não são permitidos.\nRespeite o silêncio das 22h às 8h."}
                  />
                </Field>
              </Section>

              <Section
                id="manual"
                icon={BookOpen}
                title="Manual da casa"
                desc="Instruções de equipamentos e funcionamento."
                collapsible
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-8 rounded-full text-xs"
                    onClick={() => setManual((m) => [...m, { title: "", description: "", body: "" }])}
                  >
                    <Plus className="size-3.5" /> Adicionar
                  </Button>
                }
              >
                {manual.length === 0 ? (
                  <EmptyHint text="Nenhum item ainda. Adicione instruções para ar-condicionado, TV, fechadura, etc." />
                ) : (
                  manual.map((m, i) => (
                    <ItemCard key={i} onRemove={() => setManual((prev) => prev.filter((_, j) => j !== i))}>
                      <Input
                        placeholder="Título (ex: Ar-condicionado)"
                        value={m.title}
                        maxLength={120}
                        onChange={(e) => setManual((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                      />
                      <Input
                        placeholder="Descrição curta"
                        value={m.description}
                        maxLength={300}
                        onChange={(e) => setManual((prev) => prev.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                      />
                      <Textarea
                        placeholder="Instruções detalhadas"
                        value={m.body}
                        maxLength={4000}
                        onChange={(e) => setManual((prev) => prev.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
                      />
                    </ItemCard>
                  ))
                )}
              </Section>

              <Section id="property-details" icon={NotebookPen} title="Detalhamento do Imóvel" desc="Base de conhecimento livre: micro detalhes que a IA usa e que não aparecem no guia." collapsible>
                <PropertyDetailsEditor propertyId={propertyId} />
              </Section>

              <Section id="host-house" icon={UserRound} title="Contato do anfitrião" desc="Nome e WhatsApp para o hóspede te encontrar." collapsible>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome"><Input value={edited.host_name} maxLength={120} onChange={(e) => upd("host_name", e.target.value)} /></Field>
                  <Field label="Telefone (WhatsApp)"><Input value={edited.host_phone} maxLength={40} onChange={(e) => upd("host_phone", e.target.value)} /></Field>
                </div>
              </Section>
            </SectionGroup>

            <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-border/60">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
