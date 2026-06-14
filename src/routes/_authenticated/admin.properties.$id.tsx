import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyProperty, upsertProperty } from "@/lib/properties.functions";
import { enrichFromMapsLink } from "@/lib/maps.functions";
import { importFromAirbnb } from "@/lib/airbnb.functions";
import { useSubscription } from "@/hooks/useSubscription";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Sparkles, Plus, Trash2, MapPin, ArrowLeft, FileText, KeyRound, Home, Compass, LifeBuoy, Check, Eye, Image as ImageIcon, MapPinned, Clock, DoorOpen, Wifi, UserRound, BookOpen, ClipboardCheck, Shield, Globe, Power, Phone, HelpCircle, Sun, Moon, Palette, Lock, MessageSquare } from "lucide-react";
import { ImageUpload } from "@/components/ImageUpload";
import { MediaUpload, type MediaItem } from "@/components/MediaUpload";
import { EtiquetaSelect, ETIQUETA_OPTIONS } from "@/components/EtiquetaSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin/properties/$id")({
  component: PropertyEditor,
});

type RecItem = {
  scope: "nearby" | "city";
  type: string;
  name: string;
  category?: string | null;
  rating?: number | null;
  user_ratings_total?: number | null;
  distance_text?: string | null;
  distance_meters?: number | null;
  drive_minutes?: number | null;
  walk_minutes?: number | null;
  opening_hours?: string[] | null;

  note?: string | null;
  image_url?: string | null;
  maps_url?: string | null;
  place_id?: string | null;
};


type FormState = {
  property: {
    name: string;
    slug: string;
    tagline: string;
    hero_image_url: string;
    gallery_images: string[];
    theme_images: { checkin: string; residencia: string; faq: string; explore: string };
    address: string;
    maps_url: string;
    lat: number | null;
    lng: number | null;
    city: string;
    country: string;
    checkin_time: string;
    checkin_time_max: string;
    checkout_time: string;
    checkout_time_min: string;
    lock_code: string;
    gate_code: string;
    address_note: string;
    checkin_instructions: string;
    checkout_instructions: string;
    checkin_media: MediaItem[];
    access_instructions: string;
    access_media: MediaItem[];
    access_video_url: string;
    wifi_ssid: string;
    wifi_password: string;
    host_name: string;
    host_phone: string;
    brand_name: string;
    brand_logo_url: string;
    access_mode: "public" | "pin";

    pin_code: string;
    pin_expires_at: string;
    default_language: "pt" | "en";
    guide_theme: "dark" | "light";
    published: boolean;
  };
  manual: { title: string; description: string; body: string }[];
  emergency: { label: string; number: string }[];
  faqs: { question: string; answer: string }[];
  checkout: { label: string }[];
  recommendations: RecItem[];
};

function emptyForm(): FormState {
  return {
    property: {
      name: "", slug: "", tagline: "", hero_image_url: "", gallery_images: [],
      theme_images: { checkin: "", residencia: "", faq: "", explore: "" },
      address: "", maps_url: "",
      lat: null, lng: null, city: "", country: "", checkin_time: "15:00", checkin_time_max: "", checkout_time: "11:00", checkout_time_min: "",
      lock_code: "", gate_code: "", address_note: "", checkin_instructions: "", checkout_instructions: "", checkin_media: [], access_instructions: "", access_media: [], access_video_url: "", wifi_ssid: "", wifi_password: "",
      host_name: "", host_phone: "", brand_name: "", brand_logo_url: "", access_mode: "public", pin_code: "", pin_expires_at: "",
      default_language: "pt", guide_theme: "dark", published: true,
    },
    manual: [],
    emergency: [{ label: "Polícia", number: "190" }, { label: "Bombeiros / SAMU", number: "192" }],
    faqs: [],
    checkout: [],
    recommendations: [],
  };
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function isEtiqueta(value: string) {
  return (ETIQUETA_OPTIONS as readonly string[]).includes(value);
}

function PropertyEditor() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const fetchProp = useServerFn(getMyProperty);
  const save = useServerFn(upsertProperty);
  const enrich = useServerFn(enrichFromMapsLink);
  const importAirbnb = useServerFn(importFromAirbnb);
  const { info: sub } = useSubscription();
  const canAirbnb = sub.features.autoImport;
  const canBrand = sub.features.customBrand;



  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [step, setStep] = useState<string>("basics");
  const [enriching, setEnriching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [airbnbUrl, setAirbnbUrl] = useState("");
  const [importingAirbnb, setImportingAirbnb] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop" | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["property", id],
    queryFn: () => fetchProp({ data: { id } }),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!data || isNew) return;
    const p = data.property as Record<string, unknown> | null;
    if (!p) return;
    setForm({
      property: {
        name: (p.name as string) ?? "",
        slug: (p.slug as string) ?? "",
        tagline: (p.tagline as string) ?? "",
        hero_image_url: (p.hero_image_url as string) ?? "",
        gallery_images: ((p.gallery_images as string[] | null) ?? []).slice(0, 4),
        theme_images: {
          checkin: ((p.theme_images as Record<string, string> | null)?.checkin) ?? "",
          residencia: ((p.theme_images as Record<string, string> | null)?.residencia) ?? "",
          faq: ((p.theme_images as Record<string, string> | null)?.faq) ?? "",
          explore: ((p.theme_images as Record<string, string> | null)?.explore) ?? "",
        },
        address: (p.address as string) ?? "",
        maps_url: (p.maps_url as string) ?? "",
        lat: (p.lat as number) ?? null,
        lng: (p.lng as number) ?? null,
        city: (p.city as string) ?? "",
        country: (p.country as string) ?? "",
        checkin_time: (p.checkin_time as string) ?? "15:00",
        checkin_time_max: (p.checkin_time_max as string) ?? "",
        checkout_time: (p.checkout_time as string) ?? "11:00",
        checkout_time_min: (p.checkout_time_min as string) ?? "",
        lock_code: (p.lock_code as string) ?? "",
        gate_code: (p.gate_code as string) ?? "",
        address_note: (p.address_note as string) ?? "",
        checkin_instructions: (p.checkin_instructions as string) ?? "",
        checkin_media: Array.isArray(p.checkin_media)
          ? (p.checkin_media as MediaItem[]).filter((m) => m && typeof m.url === "string").slice(0, 8)
          : [],
        access_instructions: (p.access_instructions as string) ?? "",
        access_media: Array.isArray(p.access_media)
          ? (p.access_media as MediaItem[]).filter((m) => m && typeof m.url === "string").slice(0, 8)
          : [],
        access_video_url: (p.access_video_url as string) ?? "",
        wifi_ssid: (p.wifi_ssid as string) ?? "",
        wifi_password: (p.wifi_password as string) ?? "",
        host_name: (p.host_name as string) ?? "",
        host_phone: (p.host_phone as string) ?? "",
        brand_name: (p.brand_name as string) ?? "",
        brand_logo_url: (p.brand_logo_url as string) ?? "",
        access_mode: ((p.access_mode as "public" | "pin") ?? "public"),

        pin_code: (p.pin_code as string) ?? "",
        pin_expires_at: p.pin_expires_at ? new Date(p.pin_expires_at as string).toISOString().slice(0, 16) : "",
        default_language: ((p.default_language as "pt" | "en") ?? "pt"),
        guide_theme: ((p.guide_theme as "dark" | "light") ?? "dark"),
        published: (p.published as boolean) ?? true,
      },
      manual: (data.manual ?? []).map((m: Record<string, unknown>) => ({
        title: (m.title as string) ?? "",
        description: (m.description as string) ?? "",
        body: (m.body as string) ?? "",
      })),
      emergency: (data.emergency ?? []).map((m: Record<string, unknown>) => ({
        label: (m.label as string) ?? "",
        number: (m.number as string) ?? "",
      })),
      faqs: (data.faqs ?? []).map((m: Record<string, unknown>) => ({
        question: (m.question as string) ?? "",
        answer: (m.answer as string) ?? "",
      })),
      checkout: (data.checkout ?? []).map((m: Record<string, unknown>) => ({
        label: (m.label as string) ?? "",
      })),
      recommendations: (data.recommendations ?? []).map((r: Record<string, unknown>) => ({
        scope: r.scope as "nearby" | "city",
        type: r.type as string,
        name: (r.name as string) ?? "",
        category: (r.category as string) ?? null,
        rating: (r.rating as number) ?? null,
        user_ratings_total: (r.user_ratings_total as number) ?? null,
        distance_text: (r.distance_text as string) ?? null,
        distance_meters: (r.distance_meters as number) ?? null,
        drive_minutes: (r.drive_minutes as number) ?? null,
        walk_minutes: (r.walk_minutes as number) ?? null,
        opening_hours: (r.opening_hours as string[]) ?? null,

        note: (r.note as string) ?? null,
        image_url: (r.image_url as string) ?? null,
        maps_url: (r.maps_url as string) ?? null,
        place_id: (r.place_id as string) ?? null,
      })),

    });
  }, [data, isNew]);

  function update<K extends keyof FormState["property"]>(key: K, value: FormState["property"][K]) {
    setForm((f) => ({ ...f, property: { ...f.property, [key]: value } }));
  }

  async function handleEnrich() {
    if (!form.property.maps_url) {
      toast.error("Cole o link do Google Maps primeiro");
      return;
    }
    setEnriching(true);
    try {
      const r = await enrich({ data: { mapsUrl: form.property.maps_url } });
      setForm((f) => ({
        ...f,
        property: {
          ...f.property,
          address: r.address || f.property.address,
          lat: r.lat,
          lng: r.lng,
          city: r.city || f.property.city,
          country: r.country || f.property.country,
          tagline: f.property.tagline || r.tagline || f.property.tagline,
          hero_image_url: f.property.hero_image_url || r.hero_image_url || f.property.hero_image_url,
          gallery_images: f.property.gallery_images.length ? f.property.gallery_images : (r.gallery_images ?? []).slice(0, 4),
        },
        recommendations: r.recommendations.map((rec) => ({
          scope: rec.scope,
          type: rec.type,
          name: rec.name,
          category: rec.category,
          rating: rec.rating,
          user_ratings_total: rec.user_ratings_total,
          distance_text: rec.distance_text,
          distance_meters: rec.distance_meters,
          drive_minutes: rec.drive_minutes,
          walk_minutes: rec.walk_minutes,
          opening_hours: rec.opening_hours,

          image_url: rec.image_url,
          maps_url: rec.maps_url,
          place_id: rec.place_id,
          note: rec.note,
        })),

      }));
      const nearby = r.recommendations.filter((x) => x.scope === "nearby").length;
      const city = r.recommendations.filter((x) => x.scope === "city").length;
      const extras: string[] = [];
      if (r.tagline) extras.push("descrição");
      if (r.hero_image_url) extras.push("foto de capa");
      const extraStr = extras.length ? ` · ${extras.join(" + ")}` : "";
      toast.success(`Preenchido! ${nearby} arredores · ${city} pela cidade${extraStr}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enriquecer");
    } finally {
      setEnriching(false);
    }
  }

  async function handleImportAirbnb() {
    if (!airbnbUrl.trim()) {
      toast.error("Cole o link público do anúncio do Airbnb");
      return;
    }
    setImportingAirbnb(true);
    try {
      const r = await importAirbnb({ data: { url: airbnbUrl.trim() } });
      const importedGallery = r.gallery_images.filter((url) => url.trim()).slice(0, 4);
      setForm((f) => ({
        ...f,
        property: {
          ...f.property,
          name: r.name ?? f.property.name,
          slug: r.name ? slugify(r.name) : f.property.slug,
          tagline: isEtiqueta(f.property.tagline) ? f.property.tagline : "",
          city: r.city ?? f.property.city,
          country: r.country ?? f.property.country,
          checkin_time: r.checkin_time ?? f.property.checkin_time,
          checkout_time: r.checkout_time ?? f.property.checkout_time,
          gallery_images: importedGallery.length ? importedGallery : f.property.gallery_images,
          hero_image_url: importedGallery[0] ?? r.hero_image_url ?? f.property.hero_image_url,
        },
      }));
      const bits: string[] = [];
      if (r.name) bits.push("nome");
      if (r.gallery_images.length) bits.push(`${r.gallery_images.length} fotos`);
      if (r.city) bits.push("localização");
      if (r.checkin_time || r.checkout_time) bits.push("horários");
      toast.success(bits.length ? `Importado: ${bits.join(" · ")}` : "Importado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar");
    } finally {
      setImportingAirbnb(false);
    }
  }


  async function handleSave() {
    setSaving(true);
    try {
      const galleryImages = form.property.gallery_images.filter((u) => u.trim()).slice(0, 4);
      const payload = {
        id: isNew ? null : id,
        property: {
          ...form.property,
          slug: form.property.slug || slugify(form.property.name),
          tagline: form.property.tagline || null,
          hero_image_url: galleryImages[0] || form.property.hero_image_url || null,
          gallery_images: galleryImages,
          theme_images: {
            checkin: form.property.theme_images.checkin || undefined,
            residencia: form.property.theme_images.residencia || undefined,
            faq: form.property.theme_images.faq || undefined,
            explore: form.property.theme_images.explore || undefined,
          },
          address: form.property.address || null,
          maps_url: form.property.maps_url || null,
          city: form.property.city || null,
          country: form.property.country || null,
          checkin_time: form.property.checkin_time || null,
          checkin_time_max: form.property.checkin_time_max || null,
          checkout_time: form.property.checkout_time || null,
          checkout_time_min: form.property.checkout_time_min || null,
          lock_code: form.property.lock_code || null,
          gate_code: form.property.gate_code || null,
          address_note: form.property.address_note || null,
          checkin_instructions: form.property.checkin_instructions || null,
          checkin_media: form.property.checkin_media,
          access_instructions: form.property.access_instructions || null,
          access_media: form.property.access_media,
          access_video_url: form.property.access_video_url || null,
          wifi_ssid: form.property.wifi_ssid || null,
          wifi_password: form.property.wifi_password || null,
          host_name: form.property.host_name || null,
          host_phone: form.property.host_phone || null,
          brand_name: canBrand ? (form.property.brand_name || null) : null,
          brand_logo_url: canBrand ? (form.property.brand_logo_url || null) : null,

          pin_code: form.property.access_mode === "pin" ? (form.property.pin_code || null) : null,
          pin_expires_at: form.property.access_mode === "pin" && form.property.pin_expires_at
            ? new Date(form.property.pin_expires_at).toISOString()
            : null,
        },
        recommendations: form.recommendations,
        manual: form.manual.filter((m) => m.title),
        emergency: form.emergency.filter((m) => m.label && m.number),
        faqs: form.faqs.filter((m) => m.question && m.answer),
        checkout: form.checkout.filter((m) => m.label),
      };
      const r = await save({ data: payload });
      toast.success("Guia salvo");
      if (isNew) navigate({ to: "/admin/properties/$id", params: { id: r.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && isLoading) {
    return <div className="max-w-4xl mx-auto px-6 py-10 text-sm text-muted-foreground">Carregando…</div>;
  }

  const nearbyRecs = form.recommendations.filter((r) => r.scope === "nearby");
  const cityRecs = form.recommendations.filter((r) => r.scope === "city");
  const savedSlug = !isNew ? ((data?.property as Record<string, unknown> | undefined)?.slug as string | undefined) : undefined;
  const previewSlug = savedSlug || form.property.slug;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-40 sm:pb-32">
      <Link to="/admin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors">
        <ArrowLeft className="size-3.5" /> Voltar
      </Link>
      <div className="mb-7 sm:mb-9 pb-6 border-b border-border/60 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">
            {isNew ? "Novo guia" : "Editar guia"}
          </p>
          <h1 className="font-serif text-2xl sm:text-4xl break-words leading-tight">{form.property.name || "Sem título"}</h1>
          {form.property.tagline && (
            <p className="text-sm text-muted-foreground mt-2">{form.property.tagline}</p>
          )}
        </div>
        {!isNew && (
          <Link
            to="/admin/properties/$id/conversas"
            params={{ id }}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface text-xs hover:bg-secondary transition-colors"
          >
            <MessageSquare className="size-3.5" /> Conversas
          </Link>
        )}
      </div>

      <Tabs value={step} onValueChange={setStep}>
        <Stepper
          current={step}
          onChange={setStep}
          steps={[
            { value: "basics", label: "Básico", icon: FileText },
            { value: "access", label: "Acesso", icon: KeyRound },
            { value: "house", label: "A casa", icon: Home },
            { value: "recs", label: "Recomendações", icon: Compass },
            { value: "extras", label: "Extras", icon: LifeBuoy },
          ]}
        />


        <TabsContent value="basics" className="space-y-5 mt-6">
          <Section
            icon={Sparkles}
            tone="accent"
            title="Importar do Airbnb"
            desc="Cole o link público do anúncio e preencha nome, fotos, localização e horários automaticamente. Tudo continua editável depois."
          >
            {!canAirbnb && (
              <div className="mb-3 rounded-xl border border-border bg-secondary/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <Lock className="size-3.5 shrink-0 mt-0.5" />
                <span>
                  Importação automática não está incluída no seu plano. Faça upgrade em{" "}
                  <Link to="/precos" className="underline font-medium">Planos</Link> para usar este recurso.
                </span>
              </div>
            )}
            <Field label="Link do anúncio">
              <div className="flex gap-2">
                <Input
                  value={airbnbUrl}
                  onChange={(e) => setAirbnbUrl(e.target.value)}
                  placeholder="https://airbnb.com.br/h/seu-anuncio"
                  disabled={!canAirbnb}
                />
                <Button onClick={handleImportAirbnb} disabled={importingAirbnb || !canAirbnb} variant="secondary" className="shrink-0">
                  {importingAirbnb ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  <span className="ml-1.5 hidden sm:inline">{importingAirbnb ? "Importando…" : "Importar"}</span>
                </Button>
              </div>
            </Field>
          </Section>


          <Section icon={FileText} title="Identidade do guia" desc="Como o guia se apresenta aos hóspedes.">
            <Field label="Nome do imóvel" required>
              <Input value={form.property.name} maxLength={120}
                onChange={(e) => { update("name", e.target.value); if (isNew && !form.property.slug) update("slug", slugify(e.target.value)); }} />
            </Field>
            <Field label="URL pública (slug)" hint="Aparece em /g/seu-slug">
              <Input value={form.property.slug} maxLength={60} onChange={(e) => update("slug", slugify(e.target.value))} />
            </Field>
            <Field label="Tipo do guia" hint="Aparece abaixo do título no guia público.">
              <EtiquetaSelect value={form.property.tagline} onChange={(v) => update("tagline", v)} />
            </Field>
          </Section>

          <Section icon={ImageIcon} title="Fotos da residência" desc="Até 4 fotos. A primeira será usada como capa.">
            <GalleryEditor
              value={form.property.gallery_images}
              onChange={(next) => {
                setForm((f) => ({
                  ...f,
                  property: {
                    ...f.property,
                    gallery_images: next,
                    hero_image_url: next[0] ?? "",
                  },
                }));
              }}
            />
          </Section>

          <Section
            icon={MapPinned}
            title="Endereço e localização"
            desc="Cole o link do Google Maps e use Auto-preencher para obter endereço, coordenadas e pontos de interesse."
          >
            <Field label="Link do Google Maps" required>
              <div className="flex gap-2">
                <Input value={form.property.maps_url} onChange={(e) => update("maps_url", e.target.value)} placeholder="https://maps.app.goo.gl/..." />
                <Button onClick={handleEnrich} disabled={enriching} variant="secondary" className="shrink-0">
                  {enriching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  <span className="ml-1.5 hidden sm:inline">{enriching ? "Buscando…" : "Auto-preencher"}</span>
                </Button>
              </div>
            </Field>
            <Field label="Endereço">
              <Input value={form.property.address} onChange={(e) => update("address", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cidade"><Input value={form.property.city} onChange={(e) => update("city", e.target.value)} /></Field>
              <Field label="País"><Input value={form.property.country} onChange={(e) => update("country", e.target.value)} /></Field>
            </div>
            <Field label="Observação sobre o endereço" hint="Ponto de referência, instruções para o motorista, etc.">
              <Textarea value={form.property.address_note} maxLength={1000} onChange={(e) => update("address_note", e.target.value)} />
            </Field>
          </Section>

          <Section
            icon={DoorOpen}
            title="Instruções de check-in"
            desc="Passo a passo da chegada, com fotos ou vídeos do trajeto, entrada, fechadura, etc."
          >
            <Field label="Passo a passo (opcional)" hint="Descreva como o hóspede deve chegar e entrar.">
              <Textarea
                value={form.property.checkin_instructions}
                maxLength={3000}
                rows={6}
                onChange={(e) => update("checkin_instructions", e.target.value)}
                placeholder={"Ex.: 1) Estacione na vaga 12.\n2) Aponte para o portão lateral.\n3) Use o código de portão e fechadura ao lado."}
              />
            </Field>
            <Field label="Fotos e vídeos do check-in" hint="Até 8 itens. Imagens (máx 10MB) ou vídeos (máx 60MB).">
              <MediaUpload
                value={form.property.checkin_media}
                onChange={(next) => update("checkin_media", next)}
                folder="checkin"
                max={8}
              />
            </Field>
          </Section>
        </TabsContent>

        <TabsContent value="access" className="space-y-5 mt-6">
          <Section icon={Shield} title="Modo de acesso" desc="Quem pode visualizar este guia.">
            <Field label="Modo de acesso do Guia">
              <Select value={form.property.access_mode} onValueChange={(v) => update("access_mode", v as "public" | "pin")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">URL pública (qualquer um com o link vê)</SelectItem>
                  <SelectItem value="pin">Protegido por código (PIN)</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {form.property.access_mode === "pin" && (
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3 border border-border/60">
                <Field label="Código de acesso" required>
                  <Input value={form.property.pin_code} maxLength={20} onChange={(e) => update("pin_code", e.target.value)} placeholder="ex: 4729" />
                </Field>
                <Field label="Expira em" hint="Deixe em branco para nunca expirar">
                  <Input type="datetime-local" value={form.property.pin_expires_at} onChange={(e) => update("pin_expires_at", e.target.value)} />
                </Field>
              </div>
            )}
          </Section>

          <Section icon={Globe} title="Idioma">
            <Field label="Idioma padrão">
              <Select value={form.property.default_language} onValueChange={(v) => update("default_language", v as "pt" | "en")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt">Português</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </Section>



          <div className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3.5 border border-border/60">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`inline-block size-2.5 rounded-full shrink-0 ${form.property.published ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">Status do Guia</p>
                <p className="text-xs text-muted-foreground mt-0.5">{form.property.published ? "Ativo — acessível pelo link" : "Inativo — link público desabilitado"}</p>
              </div>
            </div>
            <Switch checked={form.property.published} onCheckedChange={(v) => update("published", v)} />
          </div>
        </TabsContent>

        <TabsContent value="house" className="space-y-5 mt-6">
          <Section icon={Clock} title="Horários" desc="Janelas de check-in e check-out.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Check-in a partir de"><Input value={form.property.checkin_time} maxLength={5} onChange={(e) => update("checkin_time", e.target.value)} placeholder="15:00" /></Field>
              <Field label="Check-in até" hint="opcional"><Input value={form.property.checkin_time_max} maxLength={5} onChange={(e) => update("checkin_time_max", e.target.value)} placeholder="22:00" /></Field>
              <Field label="Check-out a partir de" hint="opcional"><Input value={form.property.checkout_time_min} maxLength={5} onChange={(e) => update("checkout_time_min", e.target.value)} placeholder="08:00" /></Field>
              <Field label="Check-out até"><Input value={form.property.checkout_time} maxLength={5} onChange={(e) => update("checkout_time", e.target.value)} placeholder="11:00" /></Field>
            </div>
          </Section>

          <Section icon={DoorOpen} title="Entrada" desc="Códigos de acesso, instruções e mídia para ajudar o hóspede a entrar.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Código do portão"><Input value={form.property.gate_code} maxLength={40} onChange={(e) => update("gate_code", e.target.value)} /></Field>
              <Field label="Código da fechadura"><Input value={form.property.lock_code} maxLength={40} onChange={(e) => update("lock_code", e.target.value)} /></Field>
            </div>
            <Field label="Instruções de acesso (opcional)" hint="Explique como usar o portão, fechadura, ordem dos passos, dicas.">
              <Textarea
                value={form.property.access_instructions}
                maxLength={3000}
                rows={5}
                onChange={(e) => update("access_instructions", e.target.value)}
                placeholder={"Ex.: 1) Digite o código no teclado do portão e aperte #.\n2) Empurre a porta principal e digite o código da fechadura.\n3) Se travar, gire a maçaneta enquanto digita."}
              />
            </Field>
            <Field label="Link de vídeo tutorial (opcional)" hint="YouTube, Vimeo ou MP4 (https). Aparece como botão para o hóspede assistir.">
              <Input
                value={form.property.access_video_url}
                maxLength={2048}
                onChange={(e) => update("access_video_url", e.target.value)}
                placeholder="https://youtu.be/…"
              />
            </Field>
            <Field label="Fotos e vídeos do acesso (opcional)" hint="Até 8 itens. Mostre o portão, a fechadura, o caminho.">
              <MediaUpload
                value={form.property.access_media}
                onChange={(next) => update("access_media", next)}
                folder="access"
                max={8}
              />
            </Field>
          </Section>

          <Section icon={Wifi} title="Wi-Fi">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rede (SSID)"><Input value={form.property.wifi_ssid} maxLength={64} onChange={(e) => update("wifi_ssid", e.target.value)} /></Field>
              <Field label="Senha"><Input value={form.property.wifi_password} maxLength={64} onChange={(e) => update("wifi_password", e.target.value)} /></Field>
            </div>
          </Section>

          <Section icon={UserRound} title="Contato do anfitrião">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome"><Input value={form.property.host_name} maxLength={120} onChange={(e) => update("host_name", e.target.value)} /></Field>
              <Field label="Telefone (WhatsApp)"><Input value={form.property.host_phone} maxLength={40} onChange={(e) => update("host_phone", e.target.value)} /></Field>
            </div>
          </Section>

          <Section
            icon={Palette}
            title="Marca personalizada"
            desc={canBrand
              ? "Substitua a marca exibida no rodapé do guia público pela sua. Logomarca e nome aparecerão para os hóspedes."
              : "Disponível no plano Business. Faça upgrade para exibir sua própria marca no rodapé do guia."}
          >
            {!canBrand && (
              <div className="mb-3 rounded-xl border border-border bg-secondary/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <Lock className="size-3.5 shrink-0 mt-0.5" />
                <span>
                  Exclusivo Business.{" "}
                  <Link to="/precos" className="underline font-medium">Ver planos</Link>.
                </span>
              </div>
            )}
            <Field label="Nome da marca">
              <Input
                value={form.property.brand_name}
                maxLength={120}
                placeholder="Ex: Casa Maré Hospitality"
                onChange={(e) => update("brand_name", e.target.value)}
                disabled={!canBrand}
              />
            </Field>
            <Field label="Logomarca (URL https)">
              <Input
                value={form.property.brand_logo_url}
                maxLength={2048}
                placeholder="https://..."
                onChange={(e) => update("brand_logo_url", e.target.value)}
                disabled={!canBrand}
              />
            </Field>
            {canBrand && form.property.brand_logo_url && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2">
                <img src={form.property.brand_logo_url} alt="Preview" className="h-8 w-auto object-contain" />
                <span className="text-xs text-muted-foreground">Pré-visualização</span>
              </div>
            )}
          </Section>



          <Section
            icon={BookOpen}
            title="Manual da casa"
            desc="Instruções de equipamentos e funcionamento."
            action={<AddBtn onClick={() => setForm((f) => ({ ...f, manual: [...f.manual, { title: "", description: "", body: "" }] }))} />}
          >
            {form.manual.length === 0 ? (
              <EmptyHint text="Nenhum item ainda. Adicione instruções para ar-condicionado, TV, fechadura, etc." />
            ) : form.manual.map((m, i) => (
              <ItemCard key={i} onRemove={() => setForm((f) => ({ ...f, manual: f.manual.filter((_, j) => j !== i) }))}>
                <Input placeholder="Título (ex: Ar-condicionado)" value={m.title} maxLength={120}
                  onChange={(e) => setForm((f) => ({ ...f, manual: f.manual.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))} />
                <Input placeholder="Descrição curta" value={m.description} maxLength={300}
                  onChange={(e) => setForm((f) => ({ ...f, manual: f.manual.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))} />
                <Textarea placeholder="Instruções detalhadas" value={m.body} maxLength={4000}
                  onChange={(e) => setForm((f) => ({ ...f, manual: f.manual.map((x, j) => j === i ? { ...x, body: e.target.value } : x) }))} />
              </ItemCard>
            ))}
          </Section>

          <Section
            icon={ClipboardCheck}
            title="Checklist de check-out"
            desc="O que o hóspede deve fazer antes de sair."
            action={<AddBtn onClick={() => setForm((f) => ({ ...f, checkout: [...f.checkout, { label: "" }] }))} />}
          >
            {form.checkout.length === 0 ? (
              <EmptyHint text="Ex: trancar a porta, deixar a chave na mesa, fechar janelas." />
            ) : form.checkout.map((c, i) => (
              <ItemCard key={i} onRemove={() => setForm((f) => ({ ...f, checkout: f.checkout.filter((_, j) => j !== i) }))}>
                <Input placeholder="ex: Trancar a porta" value={c.label} maxLength={200}
                  onChange={(e) => setForm((f) => ({ ...f, checkout: f.checkout.map((x, j) => j === i ? { label: e.target.value } : x) }))} />
              </ItemCard>
            ))}
          </Section>
        </TabsContent>

        <TabsContent value="recs" className="space-y-5 mt-6">
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
            Recomendações vêm do auto-preenchimento do Google Maps. Você pode editar, remover ou adicionar manualmente.
          </div>
          <RecGroup
            title="Aqui pertinho"
            desc="Arredores do imóvel — a poucos minutos a pé."
            items={nearbyRecs}
            onChange={(items) => setForm((f) => ({ ...f, recommendations: [...items, ...cityRecs] }))}
            scope="nearby"
          />
          <RecGroup
            title="Pela cidade"
            desc="Vale a visita — alguns minutos de carro."
            items={cityRecs}
            onChange={(items) => setForm((f) => ({ ...f, recommendations: [...nearbyRecs, ...items] }))}
            scope="city"
          />
        </TabsContent>

        <TabsContent value="extras" className="space-y-5 mt-6">
          <Section
            icon={Phone}
            title="Emergências"
            desc="Telefones úteis em caso de urgência."
            action={<AddBtn onClick={() => setForm((f) => ({ ...f, emergency: [...f.emergency, { label: "", number: "" }] }))} />}
          >
            {form.emergency.length === 0 ? (
              <EmptyHint text="Adicione contatos como polícia, bombeiros, médico de plantão." />
            ) : form.emergency.map((m, i) => (
              <ItemCard key={i} onRemove={() => setForm((f) => ({ ...f, emergency: f.emergency.filter((_, j) => j !== i) }))}>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Rótulo" value={m.label} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, emergency: f.emergency.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                  <Input placeholder="Número" value={m.number} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, emergency: f.emergency.map((x, j) => j === i ? { ...x, number: e.target.value } : x) }))} />
                </div>
              </ItemCard>
            ))}
          </Section>

          <Section
            icon={HelpCircle}
            title="Perguntas frequentes"
            desc="Antecipe dúvidas comuns dos hóspedes."
            action={<AddBtn onClick={() => setForm((f) => ({ ...f, faqs: [...f.faqs, { question: "", answer: "" }] }))} />}
          >
            {form.faqs.length === 0 ? (
              <EmptyHint text="Ex: posso fumar? tem estacionamento? aceita pets?" />
            ) : form.faqs.map((m, i) => (
              <ItemCard key={i} onRemove={() => setForm((f) => ({ ...f, faqs: f.faqs.filter((_, j) => j !== i) }))}>
                <Input placeholder="Pergunta" value={m.question} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, faqs: f.faqs.map((x, j) => j === i ? { ...x, question: e.target.value } : x) }))} />
                <Textarea placeholder="Resposta" value={m.answer} maxLength={2000} onChange={(e) => setForm((f) => ({ ...f, faqs: f.faqs.map((x, j) => j === i ? { ...x, answer: e.target.value } : x) }))} />
              </ItemCard>
            ))}
          </Section>
        </TabsContent>
      </Tabs>

      {previewSlug && (
        <>
          <button
            type="button"
            onClick={() => { setPreviewMode(null); setPreviewOpen(true); }}
            title="Pré-visualizar guia"
            aria-label="Pré-visualizar guia"
            className="fixed right-4 bottom-24 z-40 inline-flex items-center justify-center size-11 rounded-full bg-foreground text-background shadow-md hover:shadow-lg hover:scale-105 transition-all"
          >
            <Eye className="size-[18px]" />
          </button>
          <Dialog open={previewOpen} onOpenChange={(o) => { setPreviewOpen(o); if (!o) setPreviewMode(null); }}>
            <DialogContent
              className={
                previewMode === "desktop"
                  ? "p-0 gap-0 overflow-hidden border-0 bg-transparent shadow-none sm:max-w-[1100px] w-[min(95vw,1100px)] [&>button]:hidden"
                  : previewMode === "mobile"
                  ? "p-0 gap-0 overflow-hidden border-0 bg-transparent shadow-none sm:max-w-[400px] w-[min(92vw,400px)] [&>button]:hidden"
                  : "p-0 gap-0 overflow-hidden sm:max-w-[420px] w-[min(92vw,420px)] [&>button]:hidden"
              }
            >
              <DialogTitle className="sr-only">Pré-visualização do guia</DialogTitle>
              {previewMode === null ? (
                <div className="p-6 bg-background">
                  <div className="text-center mb-5">
                    <h3 className="font-serif text-xl">Como deseja visualizar?</h3>
                    <p className="text-xs text-muted-foreground mt-1">Escolha o modo de pré-visualização do guia.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPreviewMode("mobile")}
                      className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card hover:border-foreground/40 hover:bg-secondary/40 transition-colors p-5"
                    >
                      <div className="w-10 h-14 rounded-md border-2 border-foreground/70 group-hover:border-foreground transition-colors" />
                      <span className="text-sm font-medium">Mobile</span>
                      <span className="text-[11px] text-muted-foreground">Tela do celular</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode("desktop")}
                      className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card hover:border-foreground/40 hover:bg-secondary/40 transition-colors p-5"
                    >
                      <div className="w-14 h-10 rounded-md border-2 border-foreground/70 group-hover:border-foreground transition-colors" />
                      <span className="text-sm font-medium">Navegador</span>
                      <span className="text-[11px] text-muted-foreground">Tela ampla</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    className="mt-5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className={`flex flex-col ${previewMode === "desktop" ? "h-[85vh] max-h-[820px] rounded-2xl" : "h-[85vh] max-h-[820px] rounded-[2rem]"} overflow-hidden bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] ring-1 ring-black/10`}>
                  <div className="flex items-center justify-between gap-3 px-4 h-9 bg-background/95 backdrop-blur border-b border-border/40 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex size-1.5 rounded-full bg-emerald-500/80" />
                      <p className="text-[11px] font-medium text-muted-foreground/80 truncate">
                        /g/{previewSlug}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPreviewMode(null)}
                        aria-label="Trocar modo"
                        className="h-6 px-2 inline-flex items-center rounded-full text-[10px] uppercase tracking-wider font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                      >
                        {previewMode === "mobile" ? "Mobile" : "Navegador"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewOpen(false)}
                        aria-label="Fechar"
                        className="size-6 grid place-items-center rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <span className="text-sm leading-none">×</span>
                      </button>
                    </div>
                  </div>
                  <iframe
                    src={`/g/${previewSlug}`}
                    title="Pré-visualização do guia"
                    className="w-full flex-1 border-0 bg-background"
                  />
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}



      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur p-3 sm:p-4 z-50">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => {
              const order = ["basics", "access", "house", "recs", "extras"];
              const i = order.indexOf(step);
              if (i > 0) setStep(order[i - 1]);
            }}
            disabled={step === "basics"}
          >
            <ArrowLeft className="size-3.5" />
            <span className="ml-1 hidden sm:inline">Anterior</span>
            <span className="ml-1 sm:hidden">Anterior</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => {
              const order = ["basics", "access", "house", "recs", "extras"];
              const i = order.indexOf(step);
              if (i < order.length - 1) setStep(order[i + 1]);
            }}
            disabled={step === "extras"}
          >
            <span className="mr-1">Próximo</span>
            <ArrowLeft className="size-3.5 rotate-180" />
          </Button>
          <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
            <Button variant="ghost" size="sm" className="flex-1 sm:flex-none" onClick={() => navigate({ to: "/admin" })}>Cancelar</Button>
            <Button size="sm" className="flex-1 sm:flex-none" onClick={handleSave} disabled={saving || !form.property.name}>
              {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
              Salvar
            </Button>
          </div>
        </div>
      </div>

    </div>
  );
}

type IconType = React.ComponentType<{ className?: string; strokeWidth?: number }>;

function Section({
  icon: Icon,
  title,
  desc,
  action,
  tone = "default",
  children,
}: {
  icon?: IconType;
  title?: string;
  desc?: string;
  action?: React.ReactNode;
  tone?: "default" | "accent";
  children: React.ReactNode;
}) {
  const accent = tone === "accent";
  return (
    <section
      className={[
        "rounded-2xl border shadow-sm",
        accent
          ? "border-primary/25 bg-gradient-to-br from-primary/[0.06] to-primary/[0.02]"
          : "border-border/60 bg-card",
      ].join(" ")}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-3.5">
          <div className="flex items-start gap-3 min-w-0">
            {Icon && (
              <span
                className={[
                  "grid place-items-center size-8 rounded-lg shrink-0 mt-0.5",
                  accent ? "bg-primary/15 text-primary" : "bg-muted text-foreground/70",
                ].join(" ")}
              >
                <Icon className="size-4" strokeWidth={2} />
              </span>
            )}
            <div className="min-w-0">
              {title && <h3 className="text-sm font-semibold leading-tight text-foreground">{title}</h3>}
              {desc && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      <div className={`${title || action ? "border-t border-border/50" : ""} px-4 sm:px-5 py-4 sm:py-5 space-y-3.5`}>
        {children}
      </div>
    </section>
  );
}


function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
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

function AddBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} className="shrink-0 h-8 rounded-full text-xs">
      <Plus className="size-3.5" /> Adicionar
    </Button>
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

function RecGroup({ title, desc, items, onChange, scope }: { title: string; desc: string; items: RecItem[]; onChange: (i: RecItem[]) => void; scope: "nearby" | "city" }) {
  return (
    <Section
      icon={scope === "nearby" ? MapPin : Compass}
      title={title}
      desc={desc}
      action={<AddBtn onClick={() => onChange([...items, { scope, type: "restaurant", name: "" }])} />}
    >
      {items.length === 0 ? (
        <EmptyHint text="Nenhuma recomendação. Use o auto-preenchimento ou adicione manualmente." />
      ) : items.map((r, i) => (
        <ItemCard key={i} onRemove={() => onChange(items.filter((_, j) => j !== i))}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <Input placeholder="Nome" value={r.name} maxLength={200}
              onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <Select value={r.type} onValueChange={(v) => onChange(items.map((x, j) => j === i ? { ...x, type: v } : x))}>
              <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["restaurant","bar","cafe","beach","attraction","market","pharmacy","park","nightlife","shopping","other"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Distância (texto)" value={r.distance_text ?? ""} maxLength={80}
              onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, distance_text: e.target.value } : x))} />
            <Input placeholder="Link Maps" value={r.maps_url ?? ""} maxLength={2048}
              onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, maps_url: e.target.value } : x))} />
          </div>
          <Textarea placeholder="Nota pessoal (opcional)" value={r.note ?? ""} maxLength={1000}
            onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
          {r.image_url && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="size-3" /> {r.category} {r.rating ? `· ★ ${r.rating}` : ""}
            </div>
          )}
        </ItemCard>
      ))}
    </Section>
  );
}

function Stepper({
  steps,
  current,
  onChange,
}: {
  steps: { value: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[];
  current: string;
  onChange: (v: string) => void;
}) {
  const currentIdx = steps.findIndex((s) => s.value === current);
  return (
    <div className="mb-6">
      {/* Mobile: compact dot stepper */}
      <div className="sm:hidden">
        <div className="flex items-center gap-1.5">
          {steps.map((s, i) => {
            const done = i < currentIdx;
            const active = i === currentIdx;
            const Icon = s.icon;
            return (
              <div key={s.value} className="flex items-center gap-1.5 flex-1 last:flex-none">
                <button
                  type="button"
                  onClick={() => onChange(s.value)}
                  aria-label={s.label}
                  className={[
                    "grid place-items-center size-9 rounded-full shrink-0 transition-all border",
                    active
                      ? "bg-primary text-primary-foreground border-primary shadow-soft scale-110"
                      : done
                      ? "bg-accent text-accent-foreground border-accent"
                      : "bg-background text-muted-foreground border-border",
                  ].join(" ")}
                >
                  {done ? <Check className="size-4" strokeWidth={2.5} /> : <Icon className="size-4" strokeWidth={2} />}
                </button>
                {i < steps.length - 1 && (
                  <span className={["h-px flex-1 min-w-3 transition-colors", i < currentIdx ? "bg-accent/50" : "bg-border"].join(" ")} />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] font-medium text-foreground mt-3">
          <span className="text-muted-foreground/70 tracking-[0.18em] uppercase mr-2">Passo {currentIdx + 1}/{steps.length}</span>
          {steps[currentIdx]?.label}
        </p>
      </div>

      {/* Desktop: full pill stepper */}
      <div className="hidden sm:block">
        <div
          className="overflow-x-auto no-scrollbar -mx-2 px-2"
          onWheel={(e) => {
            if (e.deltaY !== 0 && e.deltaX === 0) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          <div className="flex items-center gap-1.5 min-w-max pr-2">
            {steps.map((s, i) => {
              const done = i < currentIdx;
              const active = i === currentIdx;
              const Icon = s.icon;
              return (
                <div key={s.value} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onChange(s.value)}
                    className={[
                      "group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all border shrink-0",
                      active
                        ? "bg-primary text-primary-foreground border-primary shadow-soft"
                        : done
                        ? "bg-accent/10 text-foreground border-accent/30 hover:bg-accent/15"
                        : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "grid place-items-center size-5 rounded-full shrink-0",
                        active ? "bg-primary-foreground/15" : done ? "bg-accent text-accent-foreground" : "bg-secondary",
                      ].join(" ")}
                    >
                      {done ? <Check className="size-3" strokeWidth={2.5} /> : <Icon className="size-3" strokeWidth={2} />}
                    </span>
                    {s.label}
                  </button>
                  {i < steps.length - 1 && (
                    <span className={["h-px w-4 lg:w-6 shrink-0 transition-colors", i < currentIdx ? "bg-accent/40" : "bg-border"].join(" ")} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-semibold mt-3">
          Passo {currentIdx + 1} de {steps.length}
        </p>
      </div>
    </div>
  );
}

function GalleryEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const slots: string[] = [0, 1, 2, 3].map((i) => value[i] ?? "");
  function setAt(i: number, v: string) {
    const next = [...slots];
    next[i] = v;
    onChange(next.filter((x) => x.trim()));
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {slots.map((url, i) => (
        <div key={i} className="relative">
          <ImageUpload
            value={url}
            folder="gallery"
            aspect="square"
            placeholder={i === 0 ? "Capa" : `Foto ${i + 1}`}
            onChange={(v) => setAt(i, v)}
          />
          {i === 0 && url && (
            <span className="absolute top-1 left-1 rounded bg-background/85 text-[8px] uppercase tracking-widest px-1.5 py-0.5 font-bold z-10 pointer-events-none">Capa</span>
          )}
        </div>
      ))}
    </div>
  );
}
