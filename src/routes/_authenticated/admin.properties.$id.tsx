import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyProperty, upsertProperty, listMyProperties } from "@/lib/properties.functions";
import { listHostFaqs } from "@/lib/host-library.functions";
import { buildDefaultFaqs, mergeDefaultFaqs } from "@/lib/default-faqs";
import { enrichFromMapsLink, searchPlacesForRec, refreshRecommendationsFromGoogle, type PlaceSearchResult } from "@/lib/maps.functions";
import { generateCityReferences, listCityReferences, addManualCityReference, updateCityReference, bulkDeleteCityReferences } from "@/lib/city-references.functions";
import { importFromAirbnb } from "@/lib/airbnb.functions";
import { useSubscription } from "@/hooks/useSubscription";
import { useCityReferencesRealtime } from "@/hooks/useCityReferencesRealtime";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Sparkles, Plus, Trash2, MapPin, ArrowLeft, FileText, KeyRound, Home, Compass, LifeBuoy, Check, Eye, Image as ImageIcon, MapPinned, Clock, DoorOpen, Wifi, UserRound, BookOpen, ClipboardCheck, Shield, Globe, Power, Phone, HelpCircle, Sun, Moon, Palette, Lock, MessageSquare, LogOut, ChevronDown, Ticket, RefreshCw, Copy, Share2, X } from "lucide-react";
import { ImageUpload } from "@/components/ImageUpload";
import { MediaUpload, type MediaItem } from "@/components/MediaUpload";
import { EtiquetaSelect, ETIQUETA_OPTIONS } from "@/components/EtiquetaSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TimePicker } from "@/components/ui/time-picker";
import { DateTimePicker } from "@/components/ui/date-picker";
import { TagPicker, useTaxonomy } from "@/components/admin/TagPicker";

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
  // Server id, presente quando o item já existe em city_references.
  _dbId?: string;
};


type FormState = {
  property: {
    name: string;
    slug: string;
    tagline: string;
    hero_image_url: string;
    gallery_images: string[];
    theme_images: { checkin: string; residencia: string; faq: string; explore: string };
    marketplace_links: { label: string; url: string; description: string }[];
    address: string;
    maps_url: string;
    garage_maps_url: string;
    lat: number | null;
    lng: number | null;
    city: string;
    state: string;
    country: string;
    checkin_time: string;
    checkin_time_max: string;
    checkin_note: string;
    checkout_time: string;
    checkout_time_min: string;
    checkout_note: string;
    lock_code: string;
    lock_label: string;
    gate_code: string;
    gate_label: string;
    access_codes_pin: string;
    address_note: string;
    checkin_instructions: string;
    checkout_instructions: string;
    house_rules: string;
    checkin_media: MediaItem[];
    gate_instructions: string;
    gate_media: MediaItem[];
    gate_video_url: string;
    lock_instructions: string;
    lock_media: MediaItem[];
    lock_video_url: string;
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
    require_access_gate: boolean;
  };
  manual: { title: string; description: string; body: string }[];
  emergency: { label: string; number: string }[];
  faqs: { question: string; answer: string; tags: ("chegada" | "saida" | "residencia" | "explore")[] }[];
  checkout: { label: string }[];
  recommendations: RecItem[];
};

function emptyForm(): FormState {
  return {
    property: {
      name: "", slug: "", tagline: "", hero_image_url: "", gallery_images: [],
      theme_images: { checkin: "", residencia: "", faq: "", explore: "" },
      marketplace_links: [],
      address: "", maps_url: "", garage_maps_url: "",
      lat: null, lng: null, city: "", state: "", country: "", checkin_time: "15:00", checkin_time_max: "", checkin_note: "", checkout_time: "11:00", checkout_time_min: "", checkout_note: "",
      lock_code: "", lock_label: "Fechadura", gate_code: "", gate_label: "Portão", access_codes_pin: "", address_note: "", checkin_instructions: "", checkout_instructions: "", house_rules: "", checkin_media: [], gate_instructions: "", gate_media: [], gate_video_url: "", lock_instructions: "", lock_media: [], lock_video_url: "", wifi_ssid: "", wifi_password: "",
      host_name: "", host_phone: "", brand_name: "", brand_logo_url: "", access_mode: "public", pin_code: "", pin_expires_at: "",
      default_language: "pt", guide_theme: "dark", published: true, require_access_gate: false,
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
  const generateCityRefs = useServerFn(generateCityReferences);
  const listGeneratedCityRefs = useServerFn(listCityReferences);
  const addCityRefFn = useServerFn(addManualCityReference);
  const updateCityRefFn = useServerFn(updateCityReference);
  const bulkDeleteCityRefsFn = useServerFn(bulkDeleteCityReferences);
  const refreshGoogle = useServerFn(refreshRecommendationsFromGoogle);
  const queryClient = useQueryClient();
  const [refreshingGoogle, setRefreshingGoogle] = useState(false);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(null);


  const importAirbnb = useServerFn(importFromAirbnb);
  const { info: sub } = useSubscription();
  const canAirbnb = sub.features.autoImport;
  const canBrand = sub.features.customBrand;



  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [step, setStep] = useState<string>("basics");
  const [enriching, setEnriching] = useState(false);
  const [generatingCityRecs, setGeneratingCityRecs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [airbnbUrl, setAirbnbUrl] = useState("");
  const [importingAirbnb, setImportingAirbnb] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop" | null>(null);
  const [genCityModeOpen, setGenCityModeOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [faqLibOpen, setFaqLibOpen] = useState(false);
  const [faqLibSelected, setFaqLibSelected] = useState<Record<string, boolean>>({});
  const fetchHostFaqs = useServerFn(listHostFaqs);
  const { data: hostFaqsData } = useQuery({
    queryKey: ["host-faqs-library"],
    queryFn: () => fetchHostFaqs(),
    enabled: faqLibOpen,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["property", id],
    queryFn: () => fetchProp({ data: { id } }),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!data || isNew) return;
    const p = data.property as Record<string, unknown> | null;
    if (!p) return;
    setGateOpen(!!(p.gate_code as string));
    setLockOpen(!!(p.lock_code as string));
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
        marketplace_links: Array.isArray((p as Record<string, unknown>).marketplace_links)
          ? ((p as Record<string, unknown>).marketplace_links as Array<Record<string, unknown>>)
              .filter((m) => m && typeof m.label === "string" && typeof m.url === "string")
              .map((m) => ({
                label: String(m.label ?? ""),
                url: String(m.url ?? ""),
                description: typeof m.description === "string" ? m.description : "",
              }))
              .slice(0, 20)
          : [],
        address: (p.address as string) ?? "",
        maps_url: (p.maps_url as string) ?? "",
        garage_maps_url: ((p as Record<string, unknown>).garage_maps_url as string) ?? "",
        lat: (p.lat as number) ?? null,
        lng: (p.lng as number) ?? null,
        city: (p.city as string) ?? "",
        state: (p.state as string) ?? "",
        country: (p.country as string) ?? "",
        checkin_time: (p.checkin_time as string) ?? "15:00",
        checkin_time_max: (p.checkin_time_max as string) ?? "",
        checkin_note: (p.checkin_note as string) ?? "",
        checkout_time: (p.checkout_time as string) ?? "11:00",
        checkout_time_min: (p.checkout_time_min as string) ?? "",
        checkout_note: (p.checkout_note as string) ?? "",
        lock_code: (p.lock_code as string) ?? "",
        lock_label: (p.lock_label as string) ?? "Fechadura",
        gate_code: (p.gate_code as string) ?? "",
        gate_label: (p.gate_label as string) ?? "Portão",
        access_codes_pin: (p.access_codes_pin as string) ?? "",
        address_note: (p.address_note as string) ?? "",
        checkin_instructions: (p.checkin_instructions as string) ?? "",
        checkout_instructions: (p.checkout_instructions as string) ?? "",
        house_rules: ((p as Record<string, unknown>).house_rules as string) ?? "",
        checkin_media: Array.isArray(p.checkin_media)
          ? (p.checkin_media as MediaItem[]).filter((m) => m && typeof m.url === "string").slice(0, 8)
          : [],
        gate_instructions: (p.gate_instructions as string) ?? "",
        gate_media: Array.isArray(p.gate_media)
          ? (p.gate_media as MediaItem[]).filter((m) => m && typeof m.url === "string").slice(0, 8)
          : [],
        gate_video_url: (p.gate_video_url as string) ?? "",
        lock_instructions: (p.lock_instructions as string) ?? "",
        lock_media: Array.isArray(p.lock_media)
          ? (p.lock_media as MediaItem[]).filter((m) => m && typeof m.url === "string").slice(0, 8)
          : [],
        lock_video_url: (p.lock_video_url as string) ?? "",
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
        require_access_gate: (p.require_access_gate as boolean) ?? false,
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
        tags: (Array.isArray(m.tags) ? (m.tags as string[]).filter((t) => ["chegada", "saida", "residencia", "explore"].includes(t)) : []) as ("chegada" | "saida" | "residencia" | "explore")[],
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

  const normalizeRecName = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  void normalizeRecName; // mantém helper para uso futuro / debug

  // Chave estável da query de city_references desta cidade.
  const cityRefsKey = React.useMemo(
    () => [
      "cityRefs",
      (form.property.city || "").trim().toLowerCase(),
      (form.property.state || "").trim().toUpperCase(),
      (form.property.country || "BR").trim(),
    ] as const,
    [form.property.city, form.property.state, form.property.country],
  );

  function invalidateCityRefs() {
    queryClient.invalidateQueries({ queryKey: cityRefsKey });
  }

  useCityReferencesRealtime(form.property.city, invalidateCityRefs);

  async function handleEnrich() {
    if (!form.property.maps_url) {
      toast.error("Cole o link do Google Maps primeiro");
      return;
    }
    setEnriching(true);
    try {
      const r = await enrich({ data: { mapsUrl: form.property.maps_url } });
      // Geração das referências da cidade roda em paralelo e grava direto em
      // city_references — não precisamos mais misturar no form do imóvel.
      const cityForGeneration = (r.city || form.property.city).trim();
      let cityGenCount = 0;
      if (cityForGeneration) {
        try {
          const result = await generateCityRefs({
            data: {
              city_label: cityForGeneration,
              state: (r.state || form.property.state || "").trim() || null,
              country: (r.country || form.property.country || "BR").trim() || "BR",
            },
          });
          cityGenCount = (result.inserted ?? 0) + (result.updated ?? 0);
          invalidateCityRefs();
        } catch (cityError) {
          console.warn("[CityRefs] auto-fill city generation skipped", cityError);
        }
      }
      setForm((f) => ({
        ...f,
        property: {
          ...f.property,
          address: r.address || f.property.address,
          lat: r.lat,
          lng: r.lng,
          city: r.city || f.property.city,
          state: r.state || f.property.state,
          country: r.country || f.property.country,
          tagline: f.property.tagline || r.tagline || f.property.tagline,
          hero_image_url: f.property.hero_image_url || r.hero_image_url || f.property.hero_image_url,
          gallery_images: f.property.gallery_images.length ? f.property.gallery_images : (r.gallery_images ?? []).slice(0, 4),
        },
        // Mantém apenas "Aqui pertinho" no form; "Pela cidade" é compartilhado.
        recommendations: [
          ...f.recommendations.filter((x) => x.scope === "nearby"),
          ...r.recommendations.filter((rec) => rec.scope === "nearby").map((rec) => ({
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
        ],
      }));
      const nearby = r.recommendations.filter((x) => x.scope === "nearby").length;
      const extras: string[] = [];
      if (r.tagline) extras.push("descrição");
      if (r.hero_image_url) extras.push("foto de capa");
      const extraStr = extras.length ? ` · ${extras.join(" + ")}` : "";
      toast.success(`Preenchido! ${nearby} arredores · ${cityGenCount} pela cidade${extraStr}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enriquecer");
    } finally {
      setEnriching(false);
    }
  }

  async function handleGenerateCityRecommendations(mode: "replace" | "fill" = "fill") {
    const city = form.property.city.trim();
    if (!city) {
      toast.error("Preencha a cidade antes de gerar recomendações.");
      return;
    }
    setGeneratingCityRecs(true);
    try {
      const request = {
        city_label: city,
        state: form.property.state?.trim() || null,
        country: form.property.country?.trim() || "BR",
      };
      if (mode === "replace") {
        // Apaga as atuais (auto + manual) antes de regerar.
        try {
          const existing = await listGeneratedCityRefs({ data: { ...request, includeHidden: true } });
          const ids = ((existing.items ?? []) as Array<{ id: string }>).map((r) => r.id);
          if (ids.length) {
            // bulk delete suporta no máximo 500 ids por chamada.
            for (let i = 0; i < ids.length; i += 500) {
              await bulkDeleteCityRefsFn({ data: { ids: ids.slice(i, i + 500) } });
            }
          }
        } catch (e) {
          console.warn("[CityRefs] replace: bulk delete failed", e);
        }
      }
      const result = await generateCityRefs({ data: request });
      invalidateCityRefs();
      const added = (result.inserted ?? 0);
      const updated = (result.updated ?? 0);
      if (mode === "replace") {
        if (result.total === 0) {
          toast.error("Não encontrei pontos suficientes com qualidade para esta cidade.");
        } else {
          toast.success(`Recriado: ${result.total} referências da cidade`);
        }
      } else {
        if (added === 0 && updated === 0) {
          toast.info(
            "Não foram encontrados novos locais com qualidade suficiente. As referências atuais já representam a melhor seleção disponível para esta cidade.",
            { duration: 6500 },
          );
        } else {
          toast.success(`${added} novo(s) · ${updated} atualizado(s)`);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar recomendações da cidade");
    } finally {
      setGeneratingCityRecs(false);
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
          checkin_time_max: r.checkin_time_max ?? f.property.checkin_time_max,
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
          marketplace_links: form.property.marketplace_links
            .map((m) => ({
              label: m.label.trim(),
              url: m.url.trim(),
              description: m.description.trim() || null,
            }))
            .filter((m) => m.label && m.url),
          address: form.property.address || null,
          maps_url: form.property.maps_url || null,
          garage_maps_url: form.property.garage_maps_url || null,
          city: form.property.city || null,
          state: form.property.state || null,
          country: form.property.country || null,
          checkin_time: form.property.checkin_time || null,
          checkin_time_max: form.property.checkin_time_max || null,
          checkin_note: form.property.checkin_note || null,
          checkout_time: form.property.checkout_time || null,
          checkout_time_min: form.property.checkout_time_min || null,
          checkout_note: form.property.checkout_note || null,
          lock_code: form.property.lock_code || null,
          lock_label: form.property.lock_code ? (form.property.lock_label.trim() || "Fechadura") : null,
          gate_code: form.property.gate_code || null,
          gate_label: form.property.gate_code ? (form.property.gate_label.trim() || "Portão") : null,
          access_codes_pin: (form.property.gate_code || form.property.lock_code) ? (form.property.access_codes_pin.trim() || null) : null,
          address_note: form.property.address_note || null,
          checkin_instructions: form.property.checkin_instructions || null,
          checkout_instructions: form.property.checkout_instructions || null,
          house_rules: form.property.house_rules || null,
          checkin_media: form.property.checkin_media,
          gate_instructions: form.property.gate_code ? (form.property.gate_instructions || null) : null,
          gate_media: form.property.gate_code ? form.property.gate_media : [],
          gate_video_url: form.property.gate_code ? (form.property.gate_video_url || null) : null,
          lock_instructions: form.property.lock_code ? (form.property.lock_instructions || null) : null,
          lock_media: form.property.lock_code ? form.property.lock_media : [],
          lock_video_url: form.property.lock_code ? (form.property.lock_video_url || null) : null,
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
        // Apenas "Aqui pertinho" é por imóvel; "Pela cidade" mora em city_references.
        recommendations: form.recommendations.filter((r) => r.scope === "nearby" && r.name && r.name.trim().length > 0),
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
  const savedSlug = !isNew ? ((data?.property as Record<string, unknown> | undefined)?.slug as string | undefined) : undefined;
  const previewSlug = savedSlug || form.property.slug;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-40 sm:pb-32">
      <Link to="/admin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors">
        <ArrowLeft className="size-3.5" /> Voltar
      </Link>
      <div className="mb-4 sm:mb-5 pb-4 border-b border-border/60 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-4xl break-words leading-tight line-clamp-2">{form.property.name || "Sem título"}</h1>
        </div>
        {!isNew && (
          <div className="shrink-0 flex items-center gap-2">
            <Link
              to="/admin/properties/$id/acessos"
              params={{ id }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface text-xs hover:bg-secondary transition-colors"
            >
              <Shield className="size-3.5" /> Acessos
            </Link>
            <Link
              to="/admin/properties/$id/conversas"
              params={{ id }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface text-xs hover:bg-secondary transition-colors"
            >
              <MessageSquare className="size-3.5" /> Conversas
            </Link>
          </div>
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
          <SectionGroup>
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
                  Importação automática é exclusiva dos planos <strong>Pro</strong>,{" "}
                  <strong>Business</strong> e <strong>Enterprise</strong>. Faça upgrade em{" "}
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
            <Field label="Nome do imóvel" required hint={`Máx. 80 caracteres — ${form.property.name.length}/80. Curto e memorável funciona melhor no cabeçalho do guia.`}>
              <Input value={form.property.name} maxLength={80}
                onChange={(e) => {
                  const v = e.target.value.slice(0, 80);
                  if (e.target.value.length > 80) {
                    toast.info("O nome do guia tem limite de 80 caracteres — algo curto e marcante funciona melhor no topo do guia.", { id: "name-cap" });
                  }
                  update("name", v);
                  if (isNew && !form.property.slug) update("slug", slugify(v));
                }} />
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
            <Field label="Link do Google Maps — Entrada principal" required>
              <div className="flex gap-2">
                <Input value={form.property.maps_url} onChange={(e) => update("maps_url", e.target.value)} placeholder="https://maps.app.goo.gl/..." />
                <Button onClick={handleEnrich} disabled={enriching} variant="secondary" className="shrink-0">
                  {enriching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  <span className="ml-1.5 hidden sm:inline">{enriching ? "Buscando…" : "Auto-preencher"}</span>
                </Button>
              </div>
            </Field>
            <Field label="Link do Google Maps — Garagem (opcional)" hint="Aparece como um segundo botão de localização no guia.">
              <Input value={form.property.garage_maps_url} onChange={(e) => update("garage_maps_url", e.target.value)} placeholder="https://maps.app.goo.gl/..." />
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
            desc="Passo a passo da chegada. Escreva uma instrução por linha — cada linha vira uma etapa numerada no guia."
            collapsible
          >
            <Field label="Passo a passo (opcional)" hint="Uma etapa por linha. Linhas em branco são ignoradas.">
              <Textarea
                value={form.property.checkin_instructions}
                maxLength={3000}
                rows={6}
                onChange={(e) => update("checkin_instructions", e.target.value)}
                placeholder={"Estacione na vaga 12.\nAponte para o portão lateral.\nUse o código de portão e fechadura ao lado."}
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

          <Section
            icon={LogOut}
            title="Instruções de check-out"
            desc="Passo a passo da saída. Mesmo formato: uma instrução por linha."
            collapsible
          >
            <Field label="Passo a passo (opcional)" hint="Uma etapa por linha. Linhas em branco são ignoradas.">
              <Textarea
                value={form.property.checkout_instructions}
                maxLength={3000}
                rows={6}
                onChange={(e) => update("checkout_instructions", e.target.value)}
                placeholder={"Deixe as chaves sobre a mesa de jantar.\nFeche todas as janelas.\nTranque a porta principal ao sair."}
              />
            </Field>
          </Section>

          <Section
            icon={ClipboardCheck}
            title="Regras do espaço"
            desc="O que os hóspedes precisam respeitar durante a estadia. Uma regra por linha — cada linha vira um item numerado no guia."
            collapsible
          >
            <Field label="Regras (opcional)" hint="Uma regra por linha. Linhas em branco são ignoradas.">
              <Textarea
                value={form.property.house_rules}
                maxLength={3000}
                rows={6}
                onChange={(e) => update("house_rules", e.target.value)}
                placeholder={"Não é permitido fumar dentro do imóvel.\nFestas e eventos não são permitidos.\nRespeite o silêncio das 22h às 8h."}
              />
            </Field>
          </Section>

          </SectionGroup>
        </TabsContent>

        <TabsContent value="access" className="space-y-5 mt-6">
          <SectionGroup>
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
                  <DateTimePicker value={form.property.pin_expires_at} onChange={(v) => update("pin_expires_at", v)} />
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
          </SectionGroup>
        </TabsContent>

        <TabsContent value="house" className="space-y-5 mt-6">
          <SectionGroup>
          <Section icon={Clock} title="Horários" desc="Janelas de check-in e check-out." collapsible>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Check-in a partir de"><TimePicker value={form.property.checkin_time} onChange={(v) => update("checkin_time", v)} placeholder="15:00" /></Field>
              <Field label="Check-in até" hint="opcional"><TimePicker value={form.property.checkin_time_max} onChange={(v) => update("checkin_time_max", v)} placeholder="22:00" /></Field>
              <Field label="Check-out a partir de" hint="opcional"><TimePicker value={form.property.checkout_time_min} onChange={(v) => update("checkout_time_min", v)} placeholder="08:00" /></Field>
              <Field label="Check-out até"><TimePicker value={form.property.checkout_time} onChange={(v) => update("checkout_time", v)} placeholder="11:00" /></Field>
            </div>
            <div className="grid grid-cols-1 gap-3 mt-3">
              <Field label="Observação do check-in (opcional)" hint="Aparece abaixo dos horários no guia. Deixe em branco para ocultar.">
                <Textarea
                  value={form.property.checkin_note}
                  maxLength={1000}
                  rows={3}
                  onChange={(e) => update("checkin_note", e.target.value)}
                  placeholder="Ex.: Após às 22h, avise pelo WhatsApp com 1h de antecedência."
                />
              </Field>
              <Field label="Observação do check-out (opcional)" hint="Aparece abaixo dos horários no guia. Deixe em branco para ocultar.">
                <Textarea
                  value={form.property.checkout_note}
                  maxLength={1000}
                  rows={3}
                  onChange={(e) => update("checkout_note", e.target.value)}
                  placeholder="Ex.: Late check-out mediante disponibilidade — consulte o anfitrião."
                />
              </Field>
            </div>
          </Section>

          <Section icon={DoorOpen} title="Entrada" desc="Ative apenas os tipos de acesso que existem na propriedade." collapsible>
            <div className="space-y-3">
              {/* Portão */}
              <div className={`rounded-2xl border ${gateOpen ? "border-primary/40 bg-primary/[0.04]" : "border-border/60 bg-card/30"} transition-colors`}>
                <button
                  type="button"
                  onClick={() => {
                    const next = !gateOpen;
                    setGateOpen(next);
                    if (!next) {
                      setForm((f) => ({
                        ...f,
                        property: { ...f.property, gate_code: "", gate_instructions: "", gate_video_url: "", gate_media: [] },
                      }));
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                >
                  <div className={`size-9 rounded-lg grid place-items-center shrink-0 ${gateOpen ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"}`}>
                    <KeyRound className="size-[18px]" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold leading-tight">Portão com código</p>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5">
                      {gateOpen ? "Configure abaixo o código e as instruções." : "Ative se a entrada tem portão com senha."}
                    </p>
                  </div>
                  <Switch
                    checked={gateOpen}
                    onCheckedChange={(v) => {
                      setGateOpen(v);
                      if (!v) {
                        setForm((f) => ({
                          ...f,
                          property: { ...f.property, gate_code: "", gate_instructions: "", gate_video_url: "", gate_media: [] },
                        }));
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <ChevronDown className={`size-4 text-muted-foreground transition-transform ${gateOpen ? "rotate-180" : ""}`} />
                </button>
                {gateOpen ? (
                  <div className="px-4 pb-4 pt-1 space-y-4 border-t border-border/40">
                    <Field label="Código do portão" hint="Digite a senha que o hóspede vai usar.">
                      <Input value={form.property.gate_code} maxLength={40} onChange={(e) => update("gate_code", e.target.value)} placeholder="Ex.: 1212" />
                    </Field>
                    <Field label="Defina um nome" hint="Como esse acesso aparece no guia. Ex.: Portão, Garagem, Cancela.">
                      <Input value={form.property.gate_label} maxLength={40} onChange={(e) => update("gate_label", e.target.value)} placeholder="Portão" />
                    </Field>
                    <Field label="Passo a passo (opcional)" hint="Cada linha vira uma etapa numerada no guia.">
                      <Textarea
                        value={form.property.gate_instructions}
                        maxLength={3000}
                        rows={5}
                        onChange={(e) => update("gate_instructions", e.target.value)}
                        placeholder={"Ex.: 1) Digite o código no teclado do portão e aperte #.\n2) Aguarde o clique e empurre.\n3) Se travar, gire a maçaneta enquanto digita."}
                      />
                    </Field>
                    <Field label="Link de vídeo tutorial (opcional)" hint="YouTube, Vimeo ou MP4 (https).">
                      <Input
                        value={form.property.gate_video_url}
                        maxLength={2048}
                        onChange={(e) => update("gate_video_url", e.target.value)}
                        placeholder="https://youtu.be/…"
                      />
                    </Field>
                    <Field label="Fotos e vídeos do portão (opcional)" hint="Até 8 itens. Mostre o teclado, o caminho.">
                      <MediaUpload
                        value={form.property.gate_media}
                        onChange={(next) => update("gate_media", next)}
                        folder="access"
                        max={8}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>

              {/* Fechadura */}
              <div className={`rounded-2xl border ${lockOpen ? "border-primary/40 bg-primary/[0.04]" : "border-border/60 bg-card/30"} transition-colors`}>
                <button
                  type="button"
                  onClick={() => {
                    const next = !lockOpen;
                    setLockOpen(next);
                    if (!next) {
                      setForm((f) => ({
                        ...f,
                        property: { ...f.property, lock_code: "", lock_instructions: "", lock_video_url: "", lock_media: [] },
                      }));
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                >
                  <div className={`size-9 rounded-lg grid place-items-center shrink-0 ${lockOpen ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"}`}>
                    <Lock className="size-[18px]" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold leading-tight">Fechadura com código</p>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5">
                      {lockOpen ? "Configure abaixo o código e as instruções." : "Ative se a porta tem fechadura eletrônica."}
                    </p>
                  </div>
                  <Switch
                    checked={lockOpen}
                    onCheckedChange={(v) => {
                      setLockOpen(v);
                      if (!v) {
                        setForm((f) => ({
                          ...f,
                          property: { ...f.property, lock_code: "", lock_instructions: "", lock_video_url: "", lock_media: [] },
                        }));
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <ChevronDown className={`size-4 text-muted-foreground transition-transform ${lockOpen ? "rotate-180" : ""}`} />
                </button>
                {lockOpen ? (
                  <div className="px-4 pb-4 pt-1 space-y-4 border-t border-border/40">
                    <Field label="Código da fechadura" hint="Digite a senha que o hóspede vai usar.">
                      <Input value={form.property.lock_code} maxLength={40} onChange={(e) => update("lock_code", e.target.value)} placeholder="Ex.: 3333" />
                    </Field>
                    <Field label="Defina um nome" hint="Como esse acesso aparece no guia. Ex.: Fechadura, Porta principal, Smart lock.">
                      <Input value={form.property.lock_label} maxLength={40} onChange={(e) => update("lock_label", e.target.value)} placeholder="Fechadura" />
                    </Field>
                    <Field label="Passo a passo (opcional)" hint="Cada linha vira uma etapa numerada no guia.">
                      <Textarea
                        value={form.property.lock_instructions}
                        maxLength={3000}
                        rows={5}
                        onChange={(e) => update("lock_instructions", e.target.value)}
                        placeholder={"Ex.: 1) Digite o código na fechadura e pressione #.\n2) Empurre a porta enquanto o motor gira.\n3) Tranque novamente apertando o botão de cadeado."}
                      />
                    </Field>
                    <Field label="Link de vídeo tutorial (opcional)" hint="YouTube, Vimeo ou MP4 (https).">
                      <Input
                        value={form.property.lock_video_url}
                        maxLength={2048}
                        onChange={(e) => update("lock_video_url", e.target.value)}
                        placeholder="https://youtu.be/…"
                      />
                    </Field>
                    <Field label="Fotos e vídeos da fechadura (opcional)" hint="Até 8 itens. Mostre a porta, a fechadura por dentro e por fora.">
                      <MediaUpload
                        value={form.property.lock_media}
                        onChange={(next) => update("lock_media", next)}
                        folder="access"
                        max={8}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>

              {(gateOpen || lockOpen) && (
                <div className="rounded-2xl border border-border/60 bg-card/30 px-4 py-3.5 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="size-9 rounded-lg grid place-items-center shrink-0 bg-muted/40 text-muted-foreground">
                      <Lock className="size-[18px]" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold leading-tight">Senha para liberar os códigos na home</p>
                      <p className="text-[11.5px] text-muted-foreground mt-0.5">
                        Opcional. Quando preenchida, o hóspede precisa digitá-la para visualizar os códigos no atalho da página inicial. Mesmo com a senha correta, a visualização só funciona dentro da janela do check-in (24h antes até 12h depois). Deixe em branco para liberar apenas pela janela de horário.
                      </p>
                    </div>
                  </div>
                  <Input
                    value={form.property.access_codes_pin}
                    maxLength={20}
                    onChange={(e) => update("access_codes_pin", e.target.value)}
                    placeholder="Ex.: 8421"
                  />
                </div>
              )}


              {!gateOpen && !lockOpen ? (
                <p className="text-[12px] text-muted-foreground rounded-xl border border-dashed border-border/60 bg-background/30 px-4 py-3">
                  Ative ao menos um tipo de acesso acima para cadastrar código e instruções.
                </p>
              ) : null}
            </div>
          </Section>

          <Section icon={Wifi} title="Wi-Fi" desc="Rede e senha exibidas no card de Wi-Fi do guia público." collapsible>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rede (SSID)"><Input value={form.property.wifi_ssid} maxLength={64} onChange={(e) => update("wifi_ssid", e.target.value)} /></Field>
              <Field label="Senha"><Input value={form.property.wifi_password} maxLength={64} onChange={(e) => update("wifi_password", e.target.value)} /></Field>
            </div>
          </Section>

          <Section icon={UserRound} title="Contato do anfitrião" desc="Nome e WhatsApp para que o hóspede possa falar com você." collapsible>
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
              : "Disponível exclusivamente no plano Enterprise. Faça upgrade para exibir sua própria marca no rodapé do guia."}
            collapsible
          >

            {!canBrand && (
              <div className="mb-3 rounded-xl border border-border bg-secondary/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <Lock className="size-3.5 shrink-0 mt-0.5" />
                <span>
                  Exclusivo do plano <strong>Enterprise</strong>.{" "}
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
            <Field label="Logomarca">
              {canBrand ? (
                <ImageUpload
                  value={form.property.brand_logo_url}
                  folder="brand"
                  aspect="square"
                  placeholder="Enviar logomarca"
                  onChange={(v) => update("brand_logo_url", v)}
                />
              ) : (
                <Input value="" placeholder="Disponível em planos com marca própria" disabled />
              )}
            </Field>
          </Section>



          <Section
            icon={BookOpen}
            title="Manual da casa"
            desc="Instruções de equipamentos e funcionamento."
            collapsible
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
            collapsible
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
          </SectionGroup>
        </TabsContent>

        <TabsContent value="recs" className="space-y-5 mt-6">
          <SectionGroup>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/30 px-3.5 py-2.5">
            <p className="flex-1 text-[11px] text-muted-foreground leading-snug">
              Recomendações vêm do Google Maps. <span className="text-foreground/80">Sincronizamos 1×/dia.</span>
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 rounded-full text-xs shrink-0"
              disabled={refreshingGoogle || isNew}
              onClick={async () => {
                if (isNew) return;
                setRefreshingGoogle(true);
                try {
                  const r = await refreshGoogle({ data: { propertyId: id } });
                  toast.success(`Atualizado ${r.updated}/${r.total} do Google${r.failed ? ` · ${r.failed} sem retorno` : ""}`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Falha ao sincronizar");
                } finally {
                  setRefreshingGoogle(false);
                }
              }}
            >
              {refreshingGoogle ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              <span className="ml-1.5 hidden sm:inline">{refreshingGoogle ? "Sincronizando…" : "Atualizar"}</span>
              <span className="ml-1.5 sm:hidden">Sync</span>
            </Button>
          </div>



          {/* "Aqui pertinho" é por imóvel; "Pela cidade" mora em city_references
              (compartilhado entre todos os guias da mesma cidade). */}

          <RecGroup
            title="Aqui pertinho"
            desc="Arredores do imóvel — a poucos minutos a pé."
            items={nearbyRecs}
            onChange={(items) => setForm((f) => ({ ...f, recommendations: items }))}
            scope="nearby"
            lat={form.property.lat}
            lng={form.property.lng}
          />

          <CityRefsGroup
            cityLabel={form.property.city}
            state={form.property.state || null}
            country={form.property.country || "BR"}
            propertyLat={form.property.lat}
            propertyLng={form.property.lng}
            queryKey={cityRefsKey}
            onGenerate={() => setGenCityModeOpen(true)}
            generating={generatingCityRecs}
            listFn={listGeneratedCityRefs}
            addFn={addCityRefFn}
            updateFn={updateCityRefFn}
            bulkDeleteFn={bulkDeleteCityRefsFn}
            invalidate={invalidateCityRefs}
          />

          {genCityModeOpen && (
            <GenerateModeDialog
              hasExisting={true}
              onClose={() => setGenCityModeOpen(false)}
              onPick={(mode) => {
                setGenCityModeOpen(false);
                void handleGenerateCityRecommendations(mode);
              }}
            />
          )}





          <Section
            icon={Ticket}
            title="Reservas & marketplace"
            desc="Links para venda de ingressos, passeios, transfers, produtos ou qualquer experiência que você queira oferecer ao hóspede."
            action={<AddBtn onClick={() => setForm((f) => ({ ...f, property: { ...f.property, marketplace_links: [...f.property.marketplace_links, { label: "", url: "", description: "" }] } }))} />}
          >
            {form.property.marketplace_links.length === 0 ? (
              <EmptyHint text="Ex: tour de barco, transfer do aeroporto, kit de boas-vindas." />
            ) : form.property.marketplace_links.map((m, i) => (
              <ItemCard
                key={i}
                onRemove={() => setForm((f) => ({ ...f, property: { ...f.property, marketplace_links: f.property.marketplace_links.filter((_, j) => j !== i) } }))}
              >
                <Input
                  placeholder="Título (ex: Tour de barco)"
                  value={m.label}
                  maxLength={120}
                  onChange={(e) => setForm((f) => ({ ...f, property: { ...f.property, marketplace_links: f.property.marketplace_links.map((x, j) => j === i ? { ...x, label: e.target.value } : x) } }))}
                />
                <Input
                  placeholder="https://link-de-venda.com"
                  value={m.url}
                  maxLength={2048}
                  onChange={(e) => setForm((f) => ({ ...f, property: { ...f.property, marketplace_links: f.property.marketplace_links.map((x, j) => j === i ? { ...x, url: e.target.value } : x) } }))}
                />
                <Textarea
                  placeholder="Descrição curta (opcional)"
                  value={m.description}
                  maxLength={280}
                  onChange={(e) => setForm((f) => ({ ...f, property: { ...f.property, marketplace_links: f.property.marketplace_links.map((x, j) => j === i ? { ...x, description: e.target.value } : x) } }))}
                />
              </ItemCard>
            ))}
          </Section>
          </SectionGroup>
        </TabsContent>

        <TabsContent value="extras" className="space-y-5 mt-6">
          <SectionGroup>
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
            action={
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const defaults = buildDefaultFaqs(form.property);
                    if (defaults.length === 0) {
                      toast.info("Preencha campos como horários, endereço, Wi-Fi ou contato para gerar perguntas.");
                      return;
                    }
                    setForm((f) => {
                      const { merged, added } = mergeDefaultFaqs(f.faqs, defaults);
                      if (added === 0) {
                        toast.info("Todas as perguntas padrão já estão na sua FAQ.");
                        return f;
                      }
                      toast.success(`${added} pergunta${added > 1 ? "s" : ""} gerada${added > 1 ? "s" : ""} a partir dos campos.`);
                      return { ...f, faqs: merged };
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs text-muted-foreground hover:text-foreground hover:border-accent/50 transition-colors"
                >
                  <Sparkles className="size-3.5" /> Gerar dos campos
                </button>
                <button
                  type="button"
                  onClick={() => { setFaqLibSelected({}); setFaqLibOpen(true); }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs text-muted-foreground hover:text-foreground hover:border-accent/50 transition-colors"
                >
                  <BookOpen className="size-3.5" /> Importar da biblioteca
                </button>
                <AddBtn onClick={() => setForm((f) => ({ ...f, faqs: [...f.faqs, { question: "", answer: "", tags: [] }] }))} />
              </div>
            }
          >
            {form.faqs.length === 0 ? (
              <EmptyHint text="Ex: posso fumar? tem estacionamento? aceita pets?" />
            ) : form.faqs.map((m, i) => {
              const FAQ_TAGS: { value: "chegada" | "saida" | "residencia" | "explore"; label: string }[] = [
                { value: "chegada", label: "Chegada" },
                { value: "saida", label: "Saída" },
                { value: "residencia", label: "Residência" },
                { value: "explore", label: "Explore" },
              ];
              const toggleTag = (tag: "chegada" | "saida" | "residencia" | "explore") => {
                setForm((f) => ({
                  ...f,
                  faqs: f.faqs.map((x, j) => j === i ? { ...x, tags: x.tags.includes(tag) ? x.tags.filter((t) => t !== tag) : [...x.tags, tag] } : x),
                }));
              };
              const isOpen = openFaqIdx === i;
              return (
                <div key={i} className="group bg-background border border-border/60 rounded-xl overflow-hidden hover:border-border transition-colors">
                  <div className="flex items-center gap-2 px-3.5 py-3">
                    <button
                      type="button"
                      onClick={() => setOpenFaqIdx(isOpen ? null : i)}
                      className="flex-1 flex items-center gap-2 min-w-0 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="text-sm font-medium truncate flex-1">
                        {m.question || <span className="text-muted-foreground italic">Sem pergunta</span>}
                      </span>
                      <ChevronDown className={`size-4 text-muted-foreground transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    <button
                      onClick={() => {
                        setForm((f) => ({ ...f, faqs: f.faqs.filter((_, j) => j !== i) }));
                        if (openFaqIdx === i) setOpenFaqIdx(null);
                      }}
                      aria-label="Remover"
                      className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors opacity-60 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="px-3.5 pb-3.5 pt-1 space-y-2.5 border-t border-border/40">
                      <Input placeholder="Pergunta" value={m.question} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, faqs: f.faqs.map((x, j) => j === i ? { ...x, question: e.target.value } : x) }))} />
                      <Textarea placeholder="Resposta" value={m.answer} maxLength={2000} onChange={(e) => setForm((f) => ({ ...f, faqs: f.faqs.map((x, j) => j === i ? { ...x, answer: e.target.value } : x) }))} />
                      <div className="space-y-1.5">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Exibir também em</p>
                        <div className="flex flex-wrap gap-1.5">
                          {FAQ_TAGS.map((t) => {
                            const active = m.tags.includes(t.value);
                            return (
                              <button
                                key={t.value}
                                type="button"
                                onClick={() => toggleTag(t.value)}
                                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? "bg-accent text-accent-foreground border-accent" : "bg-background border-border text-muted-foreground hover:border-accent/50"}`}
                              >
                                {t.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
          </SectionGroup>
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
                  ? "p-0 gap-0 overflow-visible border-0 bg-transparent shadow-none sm:max-w-[340px] w-[min(82vw,340px)] [&>button]:hidden"
                  : "p-0 gap-0 overflow-hidden sm:max-w-[420px] w-[min(92vw,420px)] [&>button]:hidden"
              }
            >
              <DialogTitle className="sr-only">Pré-visualização do guia</DialogTitle>
              {previewMode === null ? (
                <div className="p-6 bg-background rounded-2xl border border-border shadow-xl">
                  <div className="text-center mb-5">
                    <h3 className="font-display text-xl">Como deseja visualizar?</h3>
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
              ) : previewMode === "mobile" ? (
                <div className="relative mx-auto" style={{ width: "100%" }}>
                  {/* Phone bezel */}
                  <div className="relative rounded-[2.4rem] bg-neutral-900 p-2.5 shadow-[0_40px_90px_-25px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
                    {/* Notch */}
                    <div className="absolute top-1 left-1/2 -translate-x-1/2 z-10 h-5 w-24 rounded-b-2xl bg-neutral-900" />
                    <div className="flex flex-col h-[78vh] max-h-[720px] overflow-hidden rounded-[1.7rem] bg-background">
                      <div className="flex items-center justify-between gap-2 px-3 h-7 bg-background/95 backdrop-blur border-b border-border/40 shrink-0">
                        <span className="inline-flex size-1.5 rounded-full bg-emerald-500/80" />
                        <p className="text-[10px] font-medium text-muted-foreground/80 truncate flex-1">/g/{previewSlug}</p>
                        <button
                          type="button"
                          onClick={() => setPreviewMode(null)}
                          aria-label="Trocar modo"
                          className="h-5 px-1.5 inline-flex items-center rounded-full text-[9px] uppercase tracking-wider font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                        >
                          Mobile
                        </button>
                      </div>
                      <iframe
                        src={`/g/${previewSlug}`}
                        title="Pré-visualização do guia"
                        className="w-full flex-1 border-0 bg-background"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    aria-label="Fechar"
                    className="absolute -top-2 -right-2 size-8 grid place-items-center rounded-full bg-background border border-border text-foreground/80 hover:text-foreground hover:bg-secondary shadow-lg transition-colors"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col h-[85vh] max-h-[820px] rounded-2xl overflow-hidden bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] ring-1 ring-black/10">
                  <div className="flex items-center justify-between gap-3 px-4 h-9 bg-background/95 backdrop-blur border-b border-border/40 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex size-1.5 rounded-full bg-emerald-500/80" />
                      <p className="text-[11px] font-medium text-muted-foreground/80 truncate">/g/{previewSlug}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPreviewMode(null)}
                        aria-label="Trocar modo"
                        className="h-6 px-2 inline-flex items-center rounded-full text-[10px] uppercase tracking-wider font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                      >
                        Navegador
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

      <Dialog open={faqLibOpen} onOpenChange={setFaqLibOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar da biblioteca</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-2">
            {!hostFaqsData ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
            ) : hostFaqsData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhuma pergunta na sua biblioteca ainda. Crie-as em <strong>Biblioteca</strong>.
              </p>
            ) : (
              hostFaqsData.map((f) => {
                const checked = !!faqLibSelected[f.id];
                return (
                  <label
                    key={f.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${checked ? "border-accent bg-accent/5" : "border-border hover:bg-secondary/50"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setFaqLibSelected((s) => ({ ...s, [f.id]: e.target.checked }))}
                      className="mt-1 size-4 accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{f.question}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{f.answer}</p>
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" size="sm" onClick={() => setFaqLibOpen(false)}>Cancelar</Button>
            <Button
              size="sm"
              disabled={!hostFaqsData || Object.values(faqLibSelected).every((v) => !v)}
              onClick={() => {
                const toImport = (hostFaqsData ?? []).filter((f) => faqLibSelected[f.id]);
                if (!toImport.length) return;
                setForm((prev) => ({
                  ...prev,
                  faqs: [
                    ...prev.faqs,
                    ...toImport.map((f) => ({
                      question: f.question,
                      answer: f.answer,
                      tags: (Array.isArray(f.tags) ? f.tags.filter((t: string) => ["chegada", "saida", "residencia", "explore"].includes(t)) : []) as ("chegada" | "saida" | "residencia" | "explore")[],
                    })),
                  ],
                }));
                setFaqLibOpen(false);
                setFaqLibSelected({});
                toast.success(`${toImport.length} pergunta${toImport.length === 1 ? "" : "s"} importada${toImport.length === 1 ? "" : "s"}`);
              }}
            >
              Importar selecionadas
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

type IconType = React.ComponentType<{ className?: string; strokeWidth?: number }>;

const SectionGroupContext = React.createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
} | null>(null);

function SectionGroup({ children, defaultOpenId = null }: { children: React.ReactNode; defaultOpenId?: string | null }) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);
  return (
    <SectionGroupContext.Provider value={{ openId, setOpenId }}>{children}</SectionGroupContext.Provider>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  desc,
  action,
  tone = "default",
  collapsible = false,
  defaultOpen = false,
  children,
}: {
  id?: string;
  icon?: IconType;
  title?: string;
  desc?: string;
  action?: React.ReactNode;
  tone?: "default" | "accent";
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const accent = tone === "accent";
  const group = React.useContext(SectionGroupContext);
  const autoId = React.useId();
  const sid = id ?? autoId;
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const inGroup = collapsible && !!group;
  const groupOpen = inGroup && group!.openId === sid;
  const isOpen = collapsible ? (inGroup ? groupOpen : localOpen) : true;
  const toggle = () => {
    if (!collapsible) return;
    if (inGroup) group!.setOpenId(groupOpen ? null : sid);
    else setLocalOpen((v) => !v);
  };
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
        <header className="flex flex-wrap items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-3.5">
          <button
            type="button"
            onClick={toggle}
            className={`flex items-start gap-3 min-w-0 flex-1 text-left ${collapsible ? "cursor-pointer" : "cursor-default"}`}
            aria-expanded={collapsible ? isOpen : undefined}
            disabled={!collapsible}
          >
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
            <div className="min-w-0 flex-1">
              {title && <h3 className="text-sm font-semibold leading-tight text-foreground">{title}</h3>}
              {desc && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>}
            </div>
            {collapsible && (
              <ChevronDown className={`size-4 text-muted-foreground transition-transform shrink-0 mt-1.5 ${isOpen ? "rotate-180" : ""}`} />
            )}
          </button>
          {action && <div className="flex flex-wrap items-center gap-1.5 ml-auto">{action}</div>}
        </header>
      )}
      {isOpen && (
        <div className={`${title || action ? "border-t border-border/50" : ""} px-4 sm:px-5 py-4 sm:py-5 space-y-3.5`}>
          {children}
        </div>
      )}
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

function PlaceAutocomplete({
  scope,
  lat,
  lng,
  existingPlaceIds,
  onSelect,
}: {
  scope: "nearby" | "city";
  lat: number | null;
  lng: number | null;
  existingPlaceIds: Set<string>;
  onSelect: (rec: RecItem) => void;
}) {
  const searchFn = useServerFn(searchPlacesForRec);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      searchFn({ data: { query: q, lat, lng } })
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [query, lat, lng, searchFn]);

  function pick(p: PlaceSearchResult) {
    if (p.place_id && existingPlaceIds.has(p.place_id)) {
      toast.info("Esse lugar já está na lista.");
      return;
    }
    const rec: RecItem = {
      scope,
      type: p.type,
      name: p.name,
      category: p.category,
      rating: p.rating,
      user_ratings_total: p.user_ratings_total,
      distance_text: p.distance_text || null,
      distance_meters: p.distance_meters || null,
      drive_minutes: p.drive_minutes,
      walk_minutes: p.walk_minutes,
      opening_hours: p.opening_hours,
      note: p.note,
      image_url: p.image_url,
      maps_url: p.maps_url,
      place_id: p.place_id,
    };
    onSelect(rec);
    setQuery("");
    setResults([]);
    setOpen(false);
    toast.success(`Adicionado: ${p.name}`);
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Buscar lugar no Google (ex: Rafain Churrascaria, Macuco Safari, FlyFoz)..."
          maxLength={120}
          className="pl-9"
        />
        <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1.5 w-full rounded-xl border border-border bg-popover shadow-lg overflow-hidden max-h-80 overflow-y-auto">
          {results.map((p) => {
            const dup = p.place_id ? existingPlaceIds.has(p.place_id) : false;
            return (
              <button
                key={p.place_id}
                type="button"
                onClick={() => pick(p)}
                disabled={dup}
                className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed border-b border-border/40 last:border-b-0"
              >
                {p.image_url ? (
                  <img src={p.image_url} alt="" className="size-10 rounded-md object-cover shrink-0" />
                ) : (
                  <span className="grid place-items-center size-10 rounded-md bg-muted shrink-0">
                    <MapPin className="size-4 text-muted-foreground" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {p.category}
                    {p.rating ? ` · ★ ${p.rating}` : ""}
                    {p.user_ratings_total ? ` (${p.user_ratings_total.toLocaleString("pt-BR")})` : ""}
                    {p.distance_text ? ` · ${p.distance_text}` : ""}
                  </p>
                  {p.formatted_address && (
                    <p className="text-[11px] text-muted-foreground/70 truncate">{p.formatted_address}</p>
                  )}
                </div>
                {dup && <span className="text-[10px] text-muted-foreground self-center">já adicionado</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===== CityRefsGroup =====================================================
// Wrapper que conecta a UI do RecGroup à tabela compartilhada city_references.
// Lê via React Query, escreve via server fns (add/update/delete). Edições no
// nome/nota são debouncadas para não chamar o servidor a cada tecla.
type CityRefRow = {
  id: string;
  type: string;
  name: string;
  category: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  opening_hours: string[] | null;
  note: string | null;
  image_url: string | null;
  maps_url: string | null;
  place_id: string | null;
  is_hidden?: boolean;
};

function rowToRec(r: CityRefRow): RecItem {
  return {
    scope: "city",
    type: r.type || "other",
    name: r.name || "",
    category: r.category ?? null,
    rating: r.rating ?? null,
    user_ratings_total: r.user_ratings_total ?? null,
    distance_text: null,
    distance_meters: null,
    drive_minutes: null,
    walk_minutes: null,
    opening_hours: r.opening_hours ?? null,
    note: r.note ?? null,
    image_url: r.image_url ?? null,
    maps_url: r.maps_url ?? null,
    place_id: r.place_id ?? null,
    _dbId: r.id,
  };
}

function CityRefsGroup({
  cityLabel,
  state,
  country,
  propertyLat,
  propertyLng,
  queryKey,
  onGenerate,
  generating,
  listFn,
  addFn,
  updateFn,
  bulkDeleteFn,
  invalidate,
}: {
  cityLabel: string;
  state: string | null;
  country: string;
  propertyLat: number | null;
  propertyLng: number | null;
  queryKey: readonly unknown[];
  onGenerate: () => void;
  generating: boolean;
  listFn: (args: { data: { city_label: string; state: string | null; country: string; includeHidden?: boolean } }) => Promise<{ items: unknown[] }>;
  addFn: (args: { data: Record<string, unknown> }) => Promise<{ id: string | null; duplicate?: boolean }>;
  updateFn: (args: { data: { id: string; patch: Record<string, unknown> } }) => Promise<{ ok: boolean }>;
  bulkDeleteFn: (args: { data: { ids: string[] } }) => Promise<{ ok: boolean; deleted?: number }>;
  invalidate: () => void;
}) {
  const city = (cityLabel || "").trim();
  const q = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { city_label: city, state, country, includeHidden: false } }),
    enabled: !!city,
  });

  const serverItems: RecItem[] = React.useMemo(() => {
    const rows = (q.data?.items ?? []) as CityRefRow[];
    return rows.filter((r) => !r.is_hidden).map(rowToRec);
  }, [q.data]);

  // Estado local para edições otimistas (nome/nota/maps_url). Reconciliamos
  // com o servidor sempre que a query atualiza.
  const [localItems, setLocalItems] = React.useState<RecItem[]>(serverItems);
  React.useEffect(() => { setLocalItems(serverItems); }, [serverItems]);

  // Debounce de updates por id (chave -> timeout).
  const pendingUpdates = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingAdds = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inflightAdds = React.useRef<Set<string>>(new Set());
  function scheduleUpdate(id: string, patch: Record<string, unknown>) {
    const map = pendingUpdates.current;
    const existing = map.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      map.delete(id);
      updateFn({ data: { id, patch } })
        .then(() => invalidate())
        .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar alteração"));
    }, 700);
    map.set(id, t);
  }

  function handleChange(next: RecItem[]) {
    const prev = localItems;
    setLocalItems(next);

    if (!city) {
      toast.error("Defina a cidade do imóvel antes de gerenciar referências.");
      return;
    }

    // Exclusões: ids presentes em prev e ausentes em next.
    const prevIds = new Set(prev.map((p) => p._dbId).filter(Boolean) as string[]);
    const nextIds = new Set(next.map((p) => p._dbId).filter(Boolean) as string[]);
    const deletedIds = [...prevIds].filter((id) => !nextIds.has(id));
    if (deletedIds.length) {
      bulkDeleteFn({ data: { ids: deletedIds } })
        .then(() => invalidate())
        .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir"));
    }

    // Adições: itens em next sem _dbId E com nome preenchido.
    // - Autocomplete (tem place_id): grava imediatamente, dedup por place_id.
    // - Manual (sem place_id): debounce 900ms para não chamar a cada tecla.
    // Só permite adicionar pontos vindos do Google (com place_id).
    const additions = next.filter((n) => !n._dbId && n.place_id && n.name && n.name.trim().length > 0);
    const inflight = inflightAdds.current;
    const fire = (rec: RecItem, key: string) => {
      addFn({
        data: {
          city_label: city,
          state,
          country,
          type: rec.type || "other",
          category: rec.category || rec.type || "Outros",
          name: rec.name.trim(),
          place_id: rec.place_id!,
          note: rec.note ?? null,
          rating: rec.rating ?? null,
          user_ratings_total: rec.user_ratings_total ?? null,
          image_url: rec.image_url ?? null,
          maps_url: rec.maps_url ?? null,
          opening_hours: rec.opening_hours ?? null,
        },
      })
        .then(() => invalidate())
        .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao adicionar"))
        .finally(() => inflight.delete(key));
    };
    for (const rec of additions) {
      const key = `id:${rec.place_id}`;
      if (inflight.has(key)) continue;
      inflight.add(key);
      fire(rec, key);
    }



    // Updates: mesmo _dbId, campos editáveis diferentes (nome/tipo/nota/maps_url).
    for (const n of next) {
      if (!n._dbId) continue;
      const before = prev.find((p) => p._dbId === n._dbId);
      if (!before) continue;
      const patch: Record<string, unknown> = {};
      if ((n.name ?? "") !== (before.name ?? "")) patch.name = n.name;
      if ((n.type ?? "") !== (before.type ?? "")) patch.type = n.type;
      if ((n.note ?? null) !== (before.note ?? null)) patch.note = n.note ?? null;
      if ((n.maps_url ?? null) !== (before.maps_url ?? null)) patch.maps_url = n.maps_url ?? null;
      if (Object.keys(patch).length) scheduleUpdate(n._dbId, patch);
    }
  }

  return (
    <RecGroup
      title="Pela cidade"
      desc="Vale a visita — alguns minutos de carro. Compartilhado entre todos os guias desta cidade."
      items={localItems}
      onChange={handleChange}
      scope="city"
      lat={propertyLat}
      lng={propertyLng}
      onGenerate={onGenerate}
      generating={generating || q.isFetching}
    />
  );
}


function RecGroup({
  title,
  desc,
  items,
  onChange,
  scope,
  lat,
  lng,
  onReplicate,
  onGenerate,
  generating,
}: {
  title: string;
  desc: string;
  items: RecItem[];
  onChange: (i: RecItem[]) => void;
  scope: "nearby" | "city";
  lat: number | null;
  lng: number | null;
  onReplicate?: () => void;
  onGenerate?: () => void;
  generating?: boolean;
}) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { data: taxonomy } = useTaxonomy();

  // Sem limite por subcategoria — usuário pode adicionar quantos pontos quiser.
  const CAP_PER_SUBCATEGORY = Number.POSITIVE_INFINITY;
  const CAP_MSG = "";

  const groups = new Map<string, { items: RecItem[]; indices: number[] }>();
  items.forEach((it, idx) => {
    const key = it.category || it.type || "Outros";
    const g = groups.get(key) ?? { items: [], indices: [] };
    g.items.push(it);
    g.indices.push(idx);
    groups.set(key, g);
  });
  const groupEntries = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const hasFullGroup = groupEntries.some(([, g]) => g.items.length >= CAP_PER_SUBCATEGORY);

  const existingPlaceIds = new Set(
    items.map((i) => i.place_id).filter((x): x is string => !!x),
  );

  function countFor(cat: string) {
    return groups.get(cat)?.items.length ?? 0;
  }
  function canAdd(cat: string) {
    return countFor(cat) < CAP_PER_SUBCATEGORY;
  }

  function updateAt(idx: number, patch: Partial<RecItem>) {
    onChange(items.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
  }
  function removeAt(idx: number) {
    onChange(items.filter((_, j) => j !== idx));
  }
  function handlePlaceSelect(rec: RecItem) {
    onChange([...items, rec]);
  }

  function toggleSelect(idx: number) {
    setSelectedIdx((s) => {
      const n = new Set(s);
      if (n.has(idx)) n.delete(idx); else n.add(idx);
      return n;
    });
  }
  function toggleSelectAll() {
    setSelectedIdx((s) => (s.size === items.length ? new Set() : new Set(items.map((_, i) => i))));
  }
  function deleteSelected() {
    if (selectedIdx.size === 0) return;
    onChange(items.filter((_, j) => !selectedIdx.has(j)));
    setSelectedIdx(new Set());
    setConfirmDeleteOpen(false);
  }


  return (
    <Section
      icon={scope === "nearby" ? MapPin : Compass}
      title={title}
      desc={desc}
    >
      <div className="flex flex-wrap items-center gap-1.5 -mt-1">
        {items.length > 0 && (
          <button
            type="button"
            onClick={toggleSelectAll}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 h-8 inline-flex items-center"
          >
            {selectedIdx.size === items.length ? "Limpar" : "Selecionar todos"}
          </button>
        )}
        {selectedIdx.size > 0 && (
          <Button size="sm" variant="destructive" onClick={() => setConfirmDeleteOpen(true)} className="h-8 rounded-full text-xs">
            <Trash2 className="size-3.5" /> Excluir ({selectedIdx.size})
          </Button>
        )}
        <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {selectedIdx.size} item(ns)?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação remove <strong>{selectedIdx.size}</strong> recomendaç{selectedIdx.size === 1 ? "ão" : "ões"} selecionada{selectedIdx.size === 1 ? "" : "s"} da lista. Você poderá adicioná-las novamente depois, manualmente ou via "Gerar com IA".
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={deleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <div className="ml-auto flex items-center gap-1.5">
          {onReplicate && (
            <Button size="sm" variant="ghost" onClick={onReplicate} className="shrink-0 h-8 rounded-full text-xs text-muted-foreground hover:text-foreground">
              <Share2 className="size-3.5" /> Replicar
            </Button>
          )}
          {onGenerate && (
            <Button size="sm" variant="secondary" onClick={onGenerate} disabled={generating} className="shrink-0 h-8 rounded-full text-xs">
              {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Gerar com IA
            </Button>
          )}
        </div>
      </div>

      <PlaceAutocomplete
        scope={scope}
        lat={lat}
        lng={lng}
        existingPlaceIds={existingPlaceIds}
        onSelect={handlePlaceSelect}
      />






      {items.length === 0 ? (
        <EmptyHint text="Nenhuma recomendação. Busque um lugar acima ou use o auto-preenchimento." />
      ) : (
        <div className="space-y-2">
          {groupEntries.map(([cat, g]) => {
            const open = openCat === cat;
            const groupSelected = g.indices.filter((i) => selectedIdx.has(i)).length;
            const allInGroup = groupSelected === g.indices.length && g.indices.length > 0;
            return (
              <div key={cat} className="rounded-xl border border-border/60 bg-background/40 overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-muted/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={allInGroup}
                    onChange={() =>
                      setSelectedIdx((s) => {
                        const n = new Set(s);
                        if (allInGroup) g.indices.forEach((i) => n.delete(i));
                        else g.indices.forEach((i) => n.add(i));
                        return n;
                      })
                    }
                    className="size-4 accent-current"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onClick={() => setOpenCat(open ? null : cat)}
                    className="flex-1 flex items-center justify-between gap-3 text-left"
                    aria-expanded={open}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">{cat}</span>
                      <span className={`text-[11px] ${g.items.length >= CAP_PER_SUBCATEGORY ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                        ({g.items.length}/{CAP_PER_SUBCATEGORY}{groupSelected > 0 ? ` · ${groupSelected} sel.` : ""})
                      </span>

                    </div>
                    <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                </div>
                {open && (
                  <div className="border-t border-border/50 px-3.5 py-3 space-y-2.5">
                    {g.items.map((r, k) => {
                      const idx = g.indices[k];
                      const checked = selectedIdx.has(idx);
                      return (
                        <div key={idx} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(idx)}
                            className="mt-3 size-4 accent-current shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <ItemCard onRemove={() => removeAt(idx)}>
                              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                                <Input placeholder="Nome" value={r.name} maxLength={200}
                                  onChange={(e) => updateAt(idx, { name: e.target.value })} />
                                <TagPicker
                                  value={r.type}
                                  onChange={(v) => {
                                    // sincroniza category com base na nova tag
                                    const tags = taxonomy?.tags ?? [];
                                    const tag = tags.find((t) => t.slug === v);
                                    updateAt(idx, { type: v, category: tag?.category_label ?? r.category ?? null });
                                  }}
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <Input placeholder="Distância (texto)" value={r.distance_text ?? ""} maxLength={80}
                                  onChange={(e) => updateAt(idx, { distance_text: e.target.value })} />
                                <Input placeholder="Link Maps" value={r.maps_url ?? ""} maxLength={2048}
                                  onChange={(e) => updateAt(idx, { maps_url: e.target.value })} />
                              </div>
                              <Textarea placeholder="Nota pessoal (opcional)" value={r.note ?? ""} maxLength={1000}
                                onChange={(e) => updateAt(idx, { note: e.target.value })} />
                              {(r.category || r.rating) && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <MapPin className="size-3" /> {r.category} {r.rating ? `· ★ ${r.rating}` : ""}
                                  {r.user_ratings_total ? ` (${r.user_ratings_total.toLocaleString("pt-BR")})` : ""}
                                </div>
                              )}
                            </ItemCard>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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

// ---- GenerateModeDialog ----------------------------------------------
// Popup para escolher entre recriar tudo ou apenas completar os excedentes.
function GenerateModeDialog({
  hasExisting,
  onClose,
  onPick,
}: {
  hasExisting: boolean;
  onClose: () => void;
  onPick: (mode: "replace" | "fill") => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-4 text-center border-b border-border/40">
          <div className="mx-auto mb-3 grid place-items-center size-11 rounded-full bg-primary/10 ring-1 ring-primary/20 text-primary">
            <Sparkles className="size-5" strokeWidth={1.75} />
          </div>
          <DialogTitle className="font-display text-xl tracking-tight">Como gerar as recomendações?</DialogTitle>
          <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed max-w-sm mx-auto">
            Escolha o modo de geração com IA.
          </p>
        </div>
        <div className="px-6 pb-6 pt-4">
          <div className="grid gap-2.5">
            <button
              type="button"
              onClick={() => onPick("fill")}
              className="group text-left rounded-2xl border border-border bg-card hover:border-primary/40 hover:bg-primary/[0.03] hover:shadow-sm transition-all p-4"
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className="grid place-items-center size-8 rounded-full bg-primary/10 text-primary shrink-0">
                  <Sparkles className="size-4" strokeWidth={1.75} />
                </span>
                <p className="text-sm font-semibold">Gerar apenas os excedentes</p>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-primary/80 font-medium">Recomendado</span>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed pl-[42px]">
                Mantém todas as referências atuais e adiciona apenas pontos novos de alta qualidade, respeitando o limite máximo por categoria.
              </p>
            </button>
            <button
              type="button"
              onClick={() => onPick("replace")}
              className="group text-left rounded-2xl border border-border bg-card hover:border-destructive/40 hover:bg-destructive/[0.03] hover:shadow-sm transition-all p-4"
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className="grid place-items-center size-8 rounded-full bg-destructive/10 text-destructive shrink-0">
                  <RefreshCw className="size-4" strokeWidth={1.75} />
                </span>
                <p className="text-sm font-semibold">Recriar tudo do zero</p>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed pl-[42px]">
                {hasExisting
                  ? "Remove todas as referências atuais da cidade e gera uma nova seleção completa."
                  : "Gera uma seleção completa de referências para a cidade."}
              </p>
            </button>
          </div>
          <div className="flex justify-end mt-3">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground hover:text-foreground">Cancelar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

