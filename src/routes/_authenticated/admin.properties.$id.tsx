import { createFileRoute, useNavigate, Link, redirect } from "@tanstack/react-router";
import { PageDateRow, PAGE_BACK_CLASS } from "@/components/ds/PageDateRow";
import { useGuidePreviewUrl } from "@/hooks/useGuidePreviewUrl";
import { useServerFn } from "@tanstack/react-start";
import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyProperty, upsertProperty, transferPropertyOwner } from "@/lib/properties.functions";
import {
  enrichFromMapsLink,
  searchPlacesForRec,
  type PlaceSearchResult,
} from "@/lib/maps.functions";
import {
  generateCityReferences,
  listCityReferences,
  addManualCityReference,
  updateCityReference,
  bulkDeleteCityReferences,
  renameCityReferenceCategory,
} from "@/lib/city-references.functions";
import {
  listActivePropertyOwnersForSelect,
  listProvidersForProperty,
} from "@/lib/stakeholders.functions";

import { type AirbnbAmenity, type AirbnbRoomBeds } from "@/lib/airbnb.functions";
import { useSubscription } from "@/hooks/useSubscription";
import { useCityReferencesRealtime } from "@/hooks/useCityReferencesRealtime";
import { LinkGuidesButton } from "@/components/admin/LinkGuidesDialog";
import { POIMetricsBadge } from "@/components/POIMetricsBadge";
import { getPropertyPoiCounts, getMarketplaceClicks } from "@/lib/poi-engagement.functions";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Section, SectionGroup, DenseSections } from "@/components/editor/Section";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  MapPin,
  ArrowLeft,
  FileText,
  Compass,
  Eye,
  Image as ImageIcon,
  Lock,
  ChevronDown,
  Ticket,
  RefreshCw,
  Share2,
  X,
  MoveRight,
  AlertTriangle,

} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { type MediaItem } from "@/components/MediaUpload";
import { ETIQUETA_CHECKIN_CHECKOUT } from "@/lib/publish-requirements";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useManualOverlayLayer } from "@/lib/global-overlay-store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  TagPicker,
  useTaxonomy,
  TAXONOMY_QUERY_KEY,
} from "@/components/admin/TagPicker";
import { reorderPoiCategories } from "@/lib/poi-taxonomy.functions";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  usePrefetchPropertyDetails,
} from "@/components/admin/PropertyDetailsEditor";
import { usePresence, useLiveState } from "@/hooks/usePresence";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";
import { PresenceAvatars } from "@/components/presence/PresenceAvatars";
import { Pencil, Check as CheckIcon, X as XIcon, Search, Settings2 } from "lucide-react";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { SigmaImportButton, SigmaActiveBanner, SaveAsSigmaPackButton } from "@/components/admin/SigmaImportButton";
import { getMyPropertySigmaState } from "@/lib/sigma-recommendations.functions";
import { supabase } from "@/integrations/supabase/client";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useAccess } from "@/lib/permissions/useAccess";
import {
  PANEL_SHELL,
  PanelHeading,
  CountPill,
  ACTION_BAR,
  ACTION_SEGMENT,
  ACTION_BUTTON_TONE,
  ACTION_ICON,
} from "@/components/dashboard/panel-chrome";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import { PropertyMapsButton } from "@/components/dashboard/PropertyMapsButton";
import { normalizeParkingSpots } from "@/lib/property-location";
import { SectionTopLineBar, type SectionTopLine } from "@/components/editor/Section";
import { Smartphone, Monitor } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/properties/$id")({
  // Imóveis só nascem pela importação da conta conectada (19/10/2026):
  // a criação manual ("new") foi desativada e volta para Proprietários.
  beforeLoad: ({ params }) => {
    if (params.id === "new") throw redirect({ to: "/admin/proprietarios", replace: true });
  },
  // `returnTo`: para onde volta o link "Voltar" — sem ele, cai no padrão
  // (/admin/guias). Esta rota é SÓ a Curadoria & Dicas locais; os dados do
  // imóvel moram no Playbook (/admin/playbook/:id).
  validateSearch: (s: Record<string, unknown>): { returnTo?: string; ownerId?: string } => ({
    ...(typeof s.returnTo === "string" && s.returnTo ? { returnTo: s.returnTo } : {}),
    // Quando "Novo imóvel" é aberto de dentro de um proprietário específico
    // (Stakeholders → Proprietário → "Criar nova residência"), o campo
    // Proprietário já chega preenchido e travado — ver renderOwnerFields().
    ...(typeof s.ownerId === "string" && s.ownerId ? { ownerId: s.ownerId } : {}),
  }),
  component: PropertyEditor,
});

export type RecItem = {
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
  lat?: number | null;
  lng?: number | null;
  // Server id, presente quando o item já existe em city_references.
  _dbId?: string;
};

type FormState = {
  property: {
    name: string;
    slug: string;
    tagline: string;
    /** Descrição curta em texto livre — separada de `tagline` (que é o
     * seletor fixo "Tipo do guia"). Só a importação do Airbnb escreve
     * aqui automaticamente; editável à mão também. */
    short_description: string | null;
    hero_image_url: string;
    gallery_images: string[];
    theme_images: { checkin: string; residencia: string; faq: string; explore: string };
    marketplace_links: { label: string; url: string; description: string }[];
    address: string;
    maps_url: string;
    garage_maps_url: string;
    // Local dentro do prédio (01/10/2026) — só valem com `in_condominium` ligado.
    in_condominium: boolean;
    apartment_number: string;
    apartment_floor: string;
    parking_spots: string[];
    has_elevator: boolean | null;
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
    collect_arrival_time: "off" | "optional" | "required";
    collect_vehicles: "off" | "optional" | "required";
    vehicles_max: number;
    collect_document: "off" | "optional" | "required";
    document_scope: "main" | "all";
    airbnb_ical_url: string | null;
    airbnb_ical_url_2: string | null;
    airbnb_ical_last_sync_at: string | null;
    airbnb_ical_last_error: string | null;
    airbnb_listing_url: string | null;
    /** Sincronização automática diária (Firecrawl, via pg_cron) — só leitura
     * na tela, nunca editada pelo usuário. */
    airbnb_listing_last_synced_at: string | null;
    airbnb_listing_last_error: string | null;
    airbnb_listing_last_sync_note: string | null;
    /** Campos "ampliados" da sincronização diária — só leitura na tela,
     * nunca editados pelo usuário (ver aba Airbnb). */
    airbnb_rating: number | null;
    airbnb_guest_count: number | null;
    airbnb_bedroom_count: number | null;
    airbnb_bed_count: number | null;
    airbnb_bathroom_count: number | null;
    airbnb_description_full: string | null;
    airbnb_rooms_beds: AirbnbRoomBeds[];
    airbnb_amenities: AirbnbAmenity[];
    airbnb_house_rules: string | null;
    airbnb_cancellation_policy: string | null;
    airbnb_safety_info: string | null;
    property_type_id: string | null;
    guide_created: boolean;
    /** Proprietário (property_owners) — regra: sem imóvel vinculado a um
     * proprietário cadastrado, sem guia. */
    owner_contact_id: string | null;
    /** Valores fixos de limpeza (centavos) — quadrante "Identificação e
     * Custos de Limpeza", junto com Proprietário e Tipo do imóvel. */
    cleaning_price_normal_cents: number | null;
    cleaning_price_full_cents: number | null;
    /** Período estimado de cada tipo de limpeza (minutos, múltiplos de 30) —
     * cada tipo tem seu próprio prazo, já que uma limpeza completa costuma
     * levar mais tempo que uma normal. */
    cleaning_duration_normal_minutes: number | null;
    cleaning_duration_full_minutes: number | null;
  };
  manual: { title: string; description: string; body: string; images: string[] }[];
  emergency: { label: string; number: string }[];
  faqs: { question: string; answer: string; tags: string[] }[];
  checkout: { label: string }[];
  recommendations: RecItem[];
};

function emptyForm(): FormState {
  return {
    property: {
      name: "",
      slug: "",
      tagline: ETIQUETA_CHECKIN_CHECKOUT,
      short_description: null,
      hero_image_url: "",
      gallery_images: [],
      theme_images: { checkin: "", residencia: "", faq: "", explore: "" },
      marketplace_links: [],
      address: "",
      maps_url: "",
      garage_maps_url: "",
      in_condominium: false,
      apartment_number: "",
      apartment_floor: "",
      parking_spots: [],
      has_elevator: null,
      lat: null,
      lng: null,
      city: "",
      state: "",
      country: "BR",
      checkin_time: "15:00",
      checkin_time_max: "",
      checkin_note: "",
      checkout_time: "11:00",
      checkout_time_min: "",
      checkout_note: "",
      lock_code: "",
      lock_label: "Fechadura",
      gate_code: "",
      gate_label: "Portão",
      access_codes_pin: "",
      address_note: "",
      checkin_instructions: "",
      checkout_instructions: "",
      house_rules: "",
      checkin_media: [],
      gate_instructions: "",
      gate_media: [],
      gate_video_url: "",
      lock_instructions: "",
      lock_media: [],
      lock_video_url: "",
      wifi_ssid: "",
      wifi_password: "",
      host_name: "",
      host_phone: "",
      brand_name: "",
      brand_logo_url: "",
      access_mode: "public",
      pin_code: "",
      pin_expires_at: "",
      default_language: "pt",
      guide_theme: "dark",
      published: true,
      require_access_gate: false,
      collect_arrival_time: "off",
      collect_vehicles: "off",
      vehicles_max: 2,
      collect_document: "off",
      document_scope: "main",
      airbnb_ical_url: null,
      airbnb_ical_url_2: null,
      airbnb_ical_last_sync_at: null,
      airbnb_ical_last_error: null,
      airbnb_listing_url: null,
      airbnb_listing_last_synced_at: null,
      airbnb_listing_last_error: null,
      airbnb_listing_last_sync_note: null,
      airbnb_rating: null,
      airbnb_guest_count: null,
      airbnb_bedroom_count: null,
      airbnb_bed_count: null,
      airbnb_bathroom_count: null,
      airbnb_description_full: null,
      airbnb_rooms_beds: [],
      airbnb_amenities: [],
      airbnb_house_rules: null,
      airbnb_cancellation_policy: null,
      airbnb_safety_info: null,
      property_type_id: null,
      guide_created: false,
      owner_contact_id: null,
      cleaning_price_normal_cents: null,
      cleaning_price_full_cents: null,
      cleaning_duration_normal_minutes: null,
      cleaning_duration_full_minutes: null,
    },
    manual: [],
    emergency: [
      { label: "Polícia", number: "190" },
      { label: "Bombeiros / SAMU", number: "192" },
    ],
    faqs: [],
    checkout: [],
    recommendations: [],
  };
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function PropertyEditor() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const search = Route.useSearch();
  const backTo = search.returnTo || "/admin/guias";
  // Detalhamento do imóvel já vem carregado em segundo plano: abrir a seção
  // é instantâneo, sem "Carregando…".
  usePrefetchPropertyDetails(isNew ? null : id);
  // Presença em tempo real: quem mais está nesta mesma tela agora, e o que
  // está digitando (piloto — ver usePresence.ts para estender a outras telas).
  const presence = usePresence(!isNew ? `property:${id}` : null);
  // Instantâneo de verdade pra QUALQUER escrita neste imóvel — não só a de
  // quem está com a tela aberta. Antes, um "Salvar" só refletia na mesma
  // aba/sessão que salvou; outro usuário com este mesmo imóvel aberto em
  // outro navegador só via a mudança se desse refresh manual.
  useRealtimeInvalidate(
    `property-live:${id}`,
    !isNew
      ? [
          { table: "properties", filter: `id=eq.${id}` },
          { table: "property_manual_items", filter: `property_id=eq.${id}` },
          { table: "property_faqs", filter: `property_id=eq.${id}` },
          { table: "property_checkout_items", filter: `property_id=eq.${id}` },
          { table: "property_emergency_contacts", filter: `property_id=eq.${id}` },
          { table: "property_recommendations", filter: `property_id=eq.${id}` },
        ]
      : [],
    [["property", id]],
    {
      enabled: !isNew,
      // Se você tem edição local não salva, recarregar agora apagaria o que
      // está digitando — nesse caso só avisamos, sem sobrescrever sozinho.
      shouldRefetch: () => !dirtyRef.current,
    },
  );
  // Permissão do editor: com "Visualizar" o conteúdo aparece, mas travado.
  const editorWrite = useAccess("tenant.guias.editor", "write");
  const readOnly = !editorWrite.loading && !editorWrite.allowed;

  const fetchProp = useServerFn(getMyProperty);
  const save = useServerFn(upsertProperty);
  const { impersonation } = useImpersonation();
  const enrich = useServerFn(enrichFromMapsLink);
  const generateCityRefs = useServerFn(generateCityReferences);
  const listGeneratedCityRefs = useServerFn(listCityReferences);
  const addCityRefFn = useServerFn(addManualCityReference);
  const updateCityRefFn = useServerFn(updateCityReference);
  const bulkDeleteCityRefsFn = useServerFn(bulkDeleteCityReferences);
  const fetchPoiCounts = useServerFn(getPropertyPoiCounts);
  const fetchMarketplaceClicks = useServerFn(getMarketplaceClicks);
  const { data: poiCountsData } = useQuery({
    queryKey: ["admin", "poi-counts", id],
    queryFn: () => fetchPoiCounts({ data: { property_id: id } }),
    enabled: !isNew,
    staleTime: 30_000,
  });
  const poiCounts = poiCountsData?.counts;
  const { data: marketplaceClicksData } = useQuery({
    queryKey: ["admin", "marketplace-clicks", id],
    queryFn: () => fetchMarketplaceClicks({ data: { property_id: id } }),
    enabled: !isNew,
    staleTime: 30_000,
  });
  const marketplaceClicks = marketplaceClicksData?.counts ?? {};
  const queryClient = useQueryClient();
  const { info: sub } = useSubscription();
  const canBrand = sub.features.customBrand;

  // Estado do pack ConciergeIA aplicado a este imóvel.
  // Quando ativo, "Pela cidade", "Reservas & marketplace" e FAQs vindas do
  // Sigma ficam bloqueadas para edição.
  const sigmaStateFn = useServerFn(getMyPropertySigmaState);
  const { data: sigmaState } = useQuery({
    queryKey: ["sigma-pack-state", id],
    queryFn: () => sigmaStateFn({ data: { property_id: id } }),
    enabled: !isNew,
  });
  const sigmaLocked = !!sigmaState?.active_city_key;

  // Proprietários ativos da conta — para o seletor obrigatório de vínculo
  // do imóvel (regra: sem imóvel vinculado a um proprietário, sem guia).
  const listOwnersFn = useServerFn(listActivePropertyOwnersForSelect);
  const { data: ownersData, isLoading: ownersLoading } = useQuery({
    queryKey: ["property-owners-select"],
    queryFn: () => listOwnersFn(),
    staleTime: 30_000,
  });
  const propertyOwnerOptions = ownersData?.owners ?? [];

  // Prestadores da conta + quais atendem este imóvel (vínculo N:N).
  const listProvidersFn = useServerFn(listProvidersForProperty);
  const { data: providersData } = useQuery({
    queryKey: ["property-providers", id],
    queryFn: () => listProvidersFn({ data: { propertyId: id } }),
    enabled: !isNew,
    staleTime: 30_000,
  });

  const [form, setForm] = useState<FormState>(() => {
    const base = emptyForm();
    if (isNew && search.ownerId) base.property.owner_contact_id = search.ownerId;
    return base;
  });
  const formRef = useRef(form);
  formRef.current = form;

  const editVersionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hydratedRef = useRef(false);
  const suppressHydrationAutosaveRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRecsRef = useRef<string>("");
  // Gravação cirúrgica: último conteúdo gravado de cada seção. O autosave só
  // envia ao servidor as seções que realmente mudaram desde então.
  const savedSectionsRef = useRef<Record<string, string> | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  // Antes, um erro no autosave silencioso só ia pro console.warn — a pessoa
  // via "Alterações salvas automaticamente" mesmo quando a alteração NÃO
  // tinha sido salva, sem nenhum jeito de saber (ou de eu diagnosticar,
  // pedindo pra ela olhar o console). Agora qualquer falha aparece no
  // rodapé, com a mensagem real do erro ao passar o mouse.
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  // Snapshot (JSON) do último `property` confirmado como salvo — usado só
  // pela tela enxuta "editar propriedade" (!isNew) pra decidir se a barra de
  // Cancelar/Salvar alterações aparece: precisa ser estado (não ref, como o
  // `dirtyRef` acima) porque um ref não dispara re-render — ficaria
  // "grudado" mostrando a barra até algum outro campo mudar por acaso.
  const [savedPropertyKey, setSavedPropertyKey] = useState("");
  const [enriching, setEnriching] = useState(false);
  const enrichedUrlRef = useRef<string | null>(null);
  const [generatingCityRecs, setGeneratingCityRecs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [airbnbUrl, setAirbnbUrl] = useState("");
  // Rehidrata o campo do anúncio a partir do que ficou salvo no imóvel.
  useEffect(() => {
    const saved = form.property.airbnb_listing_url;
    if (saved && !airbnbUrl) setAirbnbUrl(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.property.airbnb_listing_url]);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop" | null>(null);
  const [genCityModeOpen, setGenCityModeOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["property", id],
    queryFn: () => fetchProp({ data: { id } }),
    enabled: !isNew,
  });

  // Realtime: quando outro guia vinculado altera o "Aqui pertinho", o trigger
  // no banco espelha as mudanças aqui. Escutamos e atualizamos SOMENTE o slice
  // `recommendations` do form — jamais reidratamos o form inteiro, para não
  // sobrescrever edições não salvas em outras abas (nome, wifi, host, faqs...).
  useEffect(() => {
    if (isNew || !id) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    async function refreshRecsOnly() {
      const { data: recs, error } = await supabase
        .from("property_recommendations")
        .select(
          "scope, type, name, category, rating, user_ratings_total, distance_text, distance_meters, drive_minutes, walk_minutes, opening_hours, note, image_url, maps_url, place_id, position",
        )
        .eq("property_id", id)
        .order("position", { ascending: true });
      if (cancelled || error || !recs) return;
      const mapped = (recs as Array<Record<string, unknown>>).map((r) => ({
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
      }));
      // Atualiza apenas as "nearby" (as únicas espelhadas pelo trigger);
      // mantém "city" locais intactas para não perder edições em progresso.
      setForm((f) => ({
        ...f,
        recommendations: [
          ...mapped.filter((r) => r.scope === "nearby"),
          ...f.recommendations.filter((r) => r.scope !== "nearby"),
        ],
      }));
      lastSavedRecsRef.current = JSON.stringify(mapped.filter((r) => r.scope === "nearby"));
    }
    const channel = supabase
      .channel(`prop-recs:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "property_recommendations", filter: `property_id=eq.${id}` },
        () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            void refreshRecsOnly();
          }, 1500);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [id, isNew]);

  useEffect(() => {
    if (!data || isNew) return;
    const p = data.property as Record<string, unknown> | null;
    if (!p) return;
    // O link do Maps que já veio salvo do banco NUNCA re-dispara enriquecimento:
    // abrir a aba "A casa" não pode refazer a busca nem regerar recomendações.
    enrichedUrlRef.current = ((p.maps_url as string | null) ?? "").trim() || null;
    setGateOpen(!!(p.gate_code as string));
    setLockOpen(!!(p.lock_code as string));
    suppressHydrationAutosaveRef.current = true;
    const propertyForForm = {
      name: (p.name as string) ?? "",
      slug: (p.slug as string) ?? "",
      tagline: (p.tagline as string) ?? "",
      short_description: ((p as Record<string, unknown>).short_description as string | null) ?? null,
      hero_image_url: (p.hero_image_url as string) ?? "",
      gallery_images: ((p.gallery_images as string[] | null) ?? []).slice(0, 4),
      theme_images: {
        checkin: (p.theme_images as Record<string, string> | null)?.checkin ?? "",
        residencia: (p.theme_images as Record<string, string> | null)?.residencia ?? "",
        faq: (p.theme_images as Record<string, string> | null)?.faq ?? "",
        explore: (p.theme_images as Record<string, string> | null)?.explore ?? "",
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
      in_condominium: ((p as Record<string, unknown>).in_condominium as boolean | null) === true,
      apartment_number: ((p as Record<string, unknown>).apartment_number as string | null) ?? "",
      apartment_floor: ((p as Record<string, unknown>).apartment_floor as string | null) ?? "",
      parking_spots: Array.isArray((p as Record<string, unknown>).parking_spots)
        ? ((p as Record<string, unknown>).parking_spots as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
      has_elevator: ((p as Record<string, unknown>).has_elevator as boolean | null) ?? null,
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
      access_mode: (p.access_mode as "public" | "pin") ?? "public",

      pin_code: (p.pin_code as string) ?? "",
      pin_expires_at: p.pin_expires_at ? new Date(p.pin_expires_at as string).toISOString().slice(0, 16) : "",
      default_language: (p.default_language as "pt" | "en") ?? "pt",
      guide_theme: (p.guide_theme as "dark" | "light") ?? "dark",
      published: (p.published as boolean) ?? true,
      require_access_gate: (p.require_access_gate as boolean) ?? false,
      collect_arrival_time: (p.collect_arrival_time as "off" | "optional" | "required") ?? "off",
      collect_vehicles: (p.collect_vehicles as "off" | "optional" | "required") ?? "off",
      vehicles_max: (p.vehicles_max as number) ?? 2,
      collect_document: (p.collect_document as "off" | "optional" | "required") ?? "off",
      document_scope: (p.document_scope as "main" | "all") ?? "main",
      airbnb_ical_url: (p.airbnb_ical_url as string | null) ?? null,
      airbnb_ical_url_2: ((p as Record<string, unknown>).airbnb_ical_url_2 as string | null) ?? null,
      airbnb_ical_last_sync_at: (p.airbnb_ical_last_sync_at as string | null) ?? null,
      airbnb_ical_last_error: (p.airbnb_ical_last_error as string | null) ?? null,
      airbnb_listing_url: ((p as Record<string, unknown>).airbnb_listing_url as string | null) ?? null,
      airbnb_listing_last_synced_at:
        ((p as Record<string, unknown>).airbnb_listing_last_synced_at as string | null) ?? null,
      airbnb_listing_last_error: ((p as Record<string, unknown>).airbnb_listing_last_error as string | null) ?? null,
      airbnb_listing_last_sync_note:
        ((p as Record<string, unknown>).airbnb_listing_last_sync_note as string | null) ?? null,
      airbnb_rating: ((p as Record<string, unknown>).airbnb_rating as number | null) ?? null,
      airbnb_guest_count: ((p as Record<string, unknown>).airbnb_guest_count as number | null) ?? null,
      airbnb_bedroom_count: ((p as Record<string, unknown>).airbnb_bedroom_count as number | null) ?? null,
      airbnb_bed_count: ((p as Record<string, unknown>).airbnb_bed_count as number | null) ?? null,
      airbnb_bathroom_count: ((p as Record<string, unknown>).airbnb_bathroom_count as number | null) ?? null,
      airbnb_description_full: ((p as Record<string, unknown>).airbnb_description_full as string | null) ?? null,
      airbnb_rooms_beds: (((p as Record<string, unknown>).airbnb_rooms_beds as AirbnbRoomBeds[] | null) ?? []),
      airbnb_amenities: (((p as Record<string, unknown>).airbnb_amenities as AirbnbAmenity[] | null) ?? []),
      airbnb_house_rules: ((p as Record<string, unknown>).airbnb_house_rules as string | null) ?? null,
      airbnb_cancellation_policy:
        ((p as Record<string, unknown>).airbnb_cancellation_policy as string | null) ?? null,
      airbnb_safety_info: ((p as Record<string, unknown>).airbnb_safety_info as string | null) ?? null,
      property_type_id: ((p as Record<string, unknown>).property_type_id as string | null) ?? null,
      guide_created: ((p as Record<string, unknown>).guide_created as boolean) ?? false,
      owner_contact_id: ((p as Record<string, unknown>).owner_contact_id as string | null) ?? null,
      cleaning_price_normal_cents:
        ((p as Record<string, unknown>).cleaning_price_normal_cents as number | null) ?? null,
      cleaning_price_full_cents: ((p as Record<string, unknown>).cleaning_price_full_cents as number | null) ?? null,
      cleaning_duration_normal_minutes:
        ((p as Record<string, unknown>).cleaning_duration_normal_minutes as number | null) ?? null,
      cleaning_duration_full_minutes:
        ((p as Record<string, unknown>).cleaning_duration_full_minutes as number | null) ?? null,
    };
    setSavedPropertyKey(JSON.stringify(propertyForForm));
    setForm({
      property: propertyForForm,
      manual: (data.manual ?? []).map((m: Record<string, unknown>) => ({
        title: (m.title as string) ?? "",
        description: (m.description as string) ?? "",
        body: (m.body as string) ?? "",
        images: Array.isArray(m.images) ? (m.images as string[]) : [],
      })),
      emergency: (data.emergency ?? []).map((m: Record<string, unknown>) => ({
        label: (m.label as string) ?? "",
        number: (m.number as string) ?? "",
      })),
      faqs: (data.faqs ?? []).map((m: Record<string, unknown>) => ({
        question: (m.question as string) ?? "",
        answer: (m.answer as string) ?? "",
        tags: Array.isArray(m.tags) ? (m.tags as string[]).filter((t) => typeof t === "string") : [],
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
    // marca hidratação no próximo tick para evitar disparo do autosave
    // imediatamente após carregar do servidor.
    setTimeout(() => {
      hydratedRef.current = true;
      dirtyRef.current = false;
      savedSectionsRef.current = sectionSnapshots(formRef.current);
      lastSavedRecsRef.current = JSON.stringify(
        (data.recommendations ?? []).filter((r: Record<string, unknown>) => r.scope === "nearby"),
      );
    }, 0);
  }, [data, isNew]);

  // Marca se há edição local ainda não salva — usado pra decidir se uma
  // atualização em tempo real vinda de outra pessoa pode recarregar a tela
  // com segurança, ou se isso apagaria o que você está digitando agora.
  const dirtyRef = useRef(false);

  const normalizeRecName = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  void normalizeRecName; // mantém helper para uso futuro / debug

  // Chave estável da query de city_references desta cidade.
  const cityRefsKey = React.useMemo(
    () =>
      [
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

  useCityReferencesRealtime({ propertyId: id }, invalidateCityRefs);

  // Mirror city refs query (shared cache with CityRefsGroup) so we can use the
  // place_ids in unified search to visually block duplicates across quadrants.
  const cityRefsQuery = useQuery({
    queryKey: cityRefsKey,
    queryFn: () =>
      listGeneratedCityRefs({
        data: {
          city_label: (form.property.city || "").trim(),
          state: form.property.state || null,
          country: form.property.country || "BR",
          includeHidden: false,
          propertyId: id,
        },
      }),
    enabled: !!(form.property.city || "").trim() && !!id,
  });

  const allExistingPlaceIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of form.recommendations) {
      if (r.place_id) set.add(r.place_id);
    }
    const rows = (cityRefsQuery.data?.items ?? []) as Array<{ place_id?: string | null; is_hidden?: boolean }>;
    for (const r of rows) {
      if (r.place_id && !r.is_hidden) set.add(r.place_id);
    }
    return set;
  }, [form.recommendations, cityRefsQuery.data]);

  async function handleEnrich() {
    if (!form.property.maps_url) {
      toast.error("Cole o link do Google Maps primeiro");
      return;
    }
    setEnriching(true);
    try {
      const r = await enrich({ data: { mapsUrl: form.property.maps_url, propertyId: id !== "new" ? id : undefined } });
      // O endereço aparece na hora: aplicamos o resultado imediatamente e só
      // depois disparamos a geração das referências da cidade em segundo plano.
      setForm((f) => ({
        ...f,
        property: {
          ...f.property,
          address: r.address || f.property.address,
          lat: r.lat,
          lng: r.lng,
          // Cidade/País vêm do endereço (01/10/2026) — ver handlePickAddress.
          city: r.city || f.property.city,
          state: r.state || f.property.state,
          country: r.country || f.property.country,
          tagline: f.property.tagline || r.tagline || f.property.tagline,
          hero_image_url: f.property.hero_image_url || r.hero_image_url || f.property.hero_image_url,
          gallery_images: f.property.gallery_images.length
            ? f.property.gallery_images
            : (r.gallery_images ?? []).slice(0, 4),
        },
        // Mantém apenas "Aqui pertinho" no form; "Pela cidade" é compartilhado.
        // Se houver vínculo (Sigma/outro guia), nada novo é inserido.
        recommendations: r.recommendations_skipped
          ? f.recommendations
          : [
              ...f.recommendations.filter((x) => x.scope === "nearby"),
              // Só lugares que o guia ainda não tem (mesmo place_id): trocar o
              // link do Maps somava tudo de novo e duplicava pontos
              // (auditoria das recomendações, 24/09/2026).
              ...r.recommendations
                .filter((rec) => rec.scope === "nearby" && (rec.distance_meters ?? 0) <= 2000)
                .filter(
                  (rec) =>
                    !rec.place_id ||
                    !f.recommendations.some((x) => x.scope === "nearby" && x.place_id === rec.place_id),
                )
                .map((rec) => ({
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
      if (r.recommendations_skipped) {
        toast.info(r.skip_reason ?? "Recomendações vinculadas: mantivemos as atuais e não inserimos novas.");
      } else {
        toast.success(`Preenchido! ${nearby} arredores${extraStr}`);
      }

      const cityForGeneration = (r.city || form.property.city).trim();
      // Só bloqueamos a regeração automática quando alguma recomendação da
      // cidade está "plugada": agrupada com a de outro guia (group_id) ou
      // curada/criada pelo Sigma (sem property_id, ou origem manual/sigma).
      const cityRefItems = (cityRefsQuery.data?.items ?? []) as Array<{
        group_id?: string | null;
        property_id?: string | null;
        source?: string | null;
      }>;
      const hasLinkedCityRefs = cityRefItems.some(
        (item) =>
          !!item.group_id ||
          !item.property_id ||
          ["manual", "sigma", "admin", "curated"].includes((item.source ?? "").toLowerCase()),
      );
      if (cityForGeneration && !hasLinkedCityRefs && !r.recommendations_skipped) {
        void (async () => {
          try {
            const result = await generateCityRefs({
              data: {
                city_label: cityForGeneration,
                state: (r.state || form.property.state || "").trim() || null,
                country: (r.country || form.property.country || "BR").trim() || "BR",
                propertyId: id,
                // Centro do raio de 30 km = o imóvel do link recém-lido.
                lat: r.lat,
                lng: r.lng,
              },
            });
            const count = (result.inserted ?? 0) + (result.updated ?? 0);
            invalidateCityRefs();
            if (count > 0) toast.success(`${count} recomendações da cidade atualizadas.`);
          } catch (cityError) {
            console.warn("[CityRefs] auto-fill city generation skipped", cityError);
          }
        })();
      }
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Erro ao enriquecer"));
    } finally {
      setEnriching(false);
    }
  }

  // Auto-preenchimento: dispara sozinho assim que um link válido do Maps é colado/digitado.
  useEffect(() => {
    const url = (form.property.maps_url || "").trim();
    if (
      !url ||
      !/^https?:\/\/\S+$/i.test(url) ||
      !/(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(url)
    )
      return;
    if (enrichedUrlRef.current === url) return;
    if (enriching) return;
    const t = setTimeout(() => {
      enrichedUrlRef.current = url;
      void handleEnrich();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.property.maps_url, enriching]);

  async function handleGenerateCityRecommendations(mode: "replace" | "fill" = "fill") {
    const city = form.property.city.trim();
    if (!city) {
      toast.error("Preencha o endereço completo (aba A casa) antes de gerar recomendações.");
      return;
    }
    setGeneratingCityRecs(true);
    try {
      const request = {
        city_label: city,
        state: form.property.state?.trim() || null,
        country: form.property.country?.trim() || "BR",
        propertyId: id,
      };
      // Centro do raio de 30 km = coordenada do imóvel na tela.
      const originCoords =
        typeof form.property.lat === "number" && typeof form.property.lng === "number"
          ? { lat: form.property.lat, lng: form.property.lng }
          : {};
      if (mode === "replace") {
        // Apaga as atuais VISÍVEIS (auto + manual) antes de regerar. Os
        // pontos que o anfitrião excluiu ficam guardados ocultos e continuam
        // fora — "excluídos nunca voltam" (regra explícita, 24/09/2026).
        try {
          const existing = await listGeneratedCityRefs({ data: { ...request, includeHidden: false } });
          const ids = ((existing.items ?? []) as Array<{ id: string }>).map((r) => r.id);
          if (ids.length) {
            // bulk delete suporta no máximo 500 ids por chamada.
            for (let i = 0; i < ids.length; i += 500) {
              await bulkDeleteCityRefsFn({ data: { ids: ids.slice(i, i + 500), hard: true } });
            }
          }
        } catch (e) {
          console.warn("[CityRefs] replace: bulk delete failed", e);
        }
      }
      const result = await generateCityRefs({ data: { ...request, ...originCoords } });
      invalidateCityRefs();
      const added = result.inserted ?? 0;
      const updated = result.updated ?? 0;
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
      toast.error(friendlyErrorMessage(e, "Erro ao gerar recomendações da cidade"));
    } finally {
      setGeneratingCityRecs(false);
    }
  }

  async function handleSave(
    overrides?: Partial<FormState["property"]>,
    opts?: { silent?: boolean; snapshot?: FormState; editVersion?: number },
  ) {
    const silent = opts?.silent === true;
    const formToSave = opts?.snapshot ?? formRef.current;
    const saveVersion = opts?.editVersion ?? editVersionRef.current;
    if (!silent && gateOpen) {
      if (!formToSave.property.gate_code.trim()) {
        toast.error("Informe o código do portão ou desative essa opção.");
        return;
      }
      if (!formToSave.property.gate_label.trim()) {
        toast.error("Defina um nome para o acesso do portão.");
        return;
      }
    }
    if (!silent && lockOpen) {
      if (!formToSave.property.lock_code.trim()) {
        toast.error("Informe o código da fechadura ou desative essa opção.");
        return;
      }
      if (!formToSave.property.lock_label.trim()) {
        toast.error("Defina um nome para o acesso da fechadura.");
        return;
      }
    }
    // Regra: "sem imóvel [completo, vinculado a um proprietário], sem guia".
    // Só em salvamentos explícitos (não no autosave silencioso) — igual ao
    // padrão já usado acima para portão/fechadura: o autosave nunca trava por
    // causa de um campo obrigatório que a pessoa ainda não chegou a preencher
    // enquanto edita outra parte do formulário.
    // Nome NÃO é pedido aqui: não existe campo "Nome" em "A casa" (mora só na
    // aba "O guia", depois que o guia é criado — ver publish-requirements.ts,
    // que trata "Identidade visual — Nome do imóvel" como requisito de
    // PUBLICAÇÃO, não de criação). Por isso, se ainda estiver vazio, é
    // derivado do endereço logo abaixo, em vez de travar o salvamento.
    if (!silent) {
      if (!formToSave.property.owner_contact_id) {
        toast.error("Selecione um proprietário para este imóvel.");
        return;
      }
    }
    if (silent) setAutoSaving(true);
    else setSaving(true);
    try {
      // `overrides` existe para casos como "Criar guia": precisamos gravar
      // guide_created=true NA MESMA chamada de save, sem esperar um ciclo de
      // render (setForm/update() é assíncrono — chamar handleSave logo depois
      // de um update() leria form.property desatualizado).
      const propertySource = overrides ? { ...formToSave.property, ...overrides } : formToSave.property;
      // Ver comentário acima: sem campo "Nome" em "A casa", um imóvel novo
      // (ou qualquer imóvel que ainda não tenha ganhado um nome pela aba "O
      // guia") é salvo com um nome provisório derivado do endereço — nunca
      // vazio, pois o banco exige `name` preenchido. A pessoa troca por um
      // nome de verdade depois, na aba "O guia" (Identidade visual), quando
      // quiser publicar.
      const derivedName =
        propertySource.name.trim() ||
        propertySource.address.trim().slice(0, 120) ||
        propertySource.city.trim() ||
        "Novo imóvel";
      const galleryImages = propertySource.gallery_images.filter((u) => u.trim()).slice(0, 4);
      const currentSections = sectionSnapshots({ ...formToSave, property: propertySource });
      let sections: Record<string, boolean> | null = null;
      if (silent && !isNew && savedSectionsRef.current && !overrides) {
        const prev = savedSectionsRef.current;
        sections = {
          property: prev.p !== currentSections.p,
          manual: prev.m !== currentSections.m,
          emergency: prev.e !== currentSections.e,
          faqs: prev.f !== currentSections.f,
          checkout: prev.c !== currentSections.c,
          // Lugares "Aqui pertinho" preenchidos pelo link do Maps fora da aba
          // Recomendações precisam ser gravados aqui; na própria aba, o
          // salvamento dedicado dela já cuida disso.
          recommendations: false,
        };
        if (!Object.values(sections).some(Boolean)) return;
      }
      const payload = {
        sections,
        id: isNew ? null : id,
        ownerId: isNew ? (impersonation?.userId ?? null) : null,
        property: {
          ...propertySource,
          name: derivedName,
          slug: propertySource.slug || slugify(derivedName),
          tagline: propertySource.tagline || null,
          hero_image_url: galleryImages[0] || propertySource.hero_image_url || null,
          gallery_images: galleryImages,
          theme_images: {
            checkin: propertySource.theme_images.checkin || undefined,
            residencia: propertySource.theme_images.residencia || undefined,
            faq: propertySource.theme_images.faq || undefined,
            explore: propertySource.theme_images.explore || undefined,
          },
          marketplace_links: propertySource.marketplace_links
            .map((m) => ({
              label: m.label.trim(),
              url: m.url.trim(),
              description: m.description.trim() || null,
            }))
            .filter((m) => m.label && m.url),
          address: propertySource.address || null,
          maps_url: propertySource.maps_url || null,
          garage_maps_url: propertySource.garage_maps_url || null,
          // Desligar o condomínio NÃO apaga os valores: ficam guardados e
          // voltam se a chave for religada (decisão do cliente, 01/10/2026).
          in_condominium: propertySource.in_condominium,
          apartment_number: propertySource.apartment_number.trim() || null,
          apartment_floor: propertySource.apartment_floor.trim() || null,
          parking_spots: normalizeParkingSpots(propertySource.parking_spots),
          has_elevator: propertySource.has_elevator,
          city: propertySource.city || null,
          state: propertySource.state || null,
          country: propertySource.country || null,
          checkin_time: propertySource.checkin_time || null,
          checkin_time_max: propertySource.checkin_time_max || null,
          checkin_note: propertySource.checkin_note || null,
          checkout_time: propertySource.checkout_time || null,
          checkout_time_min: propertySource.checkout_time_min || null,
          checkout_note: propertySource.checkout_note || null,
          lock_code: propertySource.lock_code || null,
          lock_label: propertySource.lock_code ? propertySource.lock_label.trim() || "Fechadura" : null,
          gate_code: propertySource.gate_code || null,
          gate_label: propertySource.gate_code ? propertySource.gate_label.trim() || "Portão" : null,
          access_codes_pin:
            propertySource.gate_code || propertySource.lock_code
              ? propertySource.access_codes_pin.trim() || null
              : null,
          address_note: propertySource.address_note || null,
          checkin_instructions: propertySource.checkin_instructions || null,
          checkout_instructions: propertySource.checkout_instructions || null,
          house_rules: propertySource.house_rules || null,
          checkin_media: propertySource.checkin_media,
          gate_instructions: propertySource.gate_code ? propertySource.gate_instructions || null : null,
          gate_media: propertySource.gate_code ? propertySource.gate_media : [],
          gate_video_url: propertySource.gate_code ? propertySource.gate_video_url || null : null,
          lock_instructions: propertySource.lock_code ? propertySource.lock_instructions || null : null,
          lock_media: propertySource.lock_code ? propertySource.lock_media : [],
          lock_video_url: propertySource.lock_code ? propertySource.lock_video_url || null : null,
          wifi_ssid: propertySource.wifi_ssid || null,
          wifi_password: propertySource.wifi_password || null,
          host_name: propertySource.host_name || null,
          host_phone: propertySource.host_phone || null,
          brand_name: canBrand ? propertySource.brand_name || null : null,
          brand_logo_url: canBrand ? propertySource.brand_logo_url || null : null,

          // Guias de Check-In & Check-Out sempre exigem o formulário de
          // primeiro acesso — o campo fica bloqueado na interface.
          require_access_gate: true,
          pin_code: propertySource.access_mode === "pin" ? propertySource.pin_code || null : null,
          pin_expires_at:
            propertySource.access_mode === "pin" && propertySource.pin_expires_at
              ? new Date(propertySource.pin_expires_at).toISOString()
              : null,
          airbnb_listing_url: propertySource.airbnb_listing_url || airbnbUrl.trim() || null,
        },
        // Apenas "Aqui pertinho" é por imóvel; "Pela cidade" mora em city_references.
        // Só persiste pontos vindos do Google (com place_id).
        recommendations: formToSave.recommendations.filter(
          (r) => r.scope === "nearby" && r.place_id && r.name && r.name.trim().length > 0,
        ),
        manual: formToSave.manual.filter((m) => m.title),
        emergency: formToSave.emergency.filter((m) => m.label && m.number),
        faqs: formToSave.faqs.filter((m) => m.question && m.answer),
        checkout: formToSave.checkout.filter((m) => m.label),
      };
      const queuedSave = saveQueueRef.current.then(() => save({ data: payload }));
      saveQueueRef.current = queuedSave.then(
        () => undefined,
        () => undefined,
      );
      const r = await queuedSave;
      // O Airbnb é a fonte da verdade do anúncio: se ele recusou, o valor voltou ao do Airbnb.
      const airbnb = (r as { airbnb?: { ok: boolean; errors: string[] } } | undefined)?.airbnb;
      if (airbnb && !airbnb.ok) {
        toast.warning(`O Airbnb não aceitou a alteração: ${airbnb.errors[0] ?? "erro"}. O campo voltou ao valor do anúncio.`);
        queryClient.invalidateQueries({ queryKey: ["property", id] });
      }
      savedSectionsRef.current = { ...(savedSectionsRef.current ?? {}), ...currentSections };
      if (!silent) toast.success(isNew ? "Imóvel criado" : "Guia salvo");
      setAutoSaveError(null);
      if (editVersionRef.current === saveVersion) dirtyRef.current = false;
      // Atualiza o snapshot usado pela barra de Cancelar/Salvar alterações de
      // "editar propriedade" (ver `savedPropertyKey`): assim que o que acabou
      // de ser salvo — seja autosave silencioso ou clique manual — bate com o
      // formulário atual, a barra some sozinha.
      setSavedPropertyKey(JSON.stringify(propertySource));
      // Em autosave (silent) NÃO invalidamos nada: refetch do guia inteiro a
      // cada tecla era o que deixava a edição lenta. Só marcamos as queries
      // como obsoletas (refetchType: "none"), então elas se atualizam no
      // próximo mount/foco, sem travar quem está digitando.
      const mode = silent ? ({ refetchType: "none" } as const) : ({} as const);
      queryClient.invalidateQueries({ queryKey: ["property", id], ...mode });
      queryClient.invalidateQueries({ queryKey: ["my-properties"], ...mode });
      // Bidirecional: a ficha do proprietário (Stakeholders) lê os mesmos
      // campos direto da tabela "properties" — mas fica em cache próprio.
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "stakeholder-detail", ...mode });
      if (isNew)
        navigate({
          to: "/admin/properties/$id",
          params: { id: r.id },
          search: search.returnTo ? { returnTo: search.returnTo } : undefined,
        });
    } catch (e) {
      const msg = friendlyErrorMessage(e, "Erro ao salvar");
      if (!silent) toast.error(msg);
      else {
        console.warn("[autosave] guia", e);
        setAutoSaveError(msg);
      }
    } finally {
      if (silent) setAutoSaving(false);
      else setSaving(false);
    }
  }

  // ---- Autosave da aba "Recomendações" ----
  // Salva silenciosamente as recomendações "Aqui pertinho" 1.2s após a última
  // alteração enquanto o usuário está na aba "recs". "Pela cidade" já é
  // persistido inline em city_references via mutations próprias.
  useEffect(() => {
    if (!hydratedRef.current || isNew || saving || readOnly) return;
    const nearby = form.recommendations.filter((r) => r.scope === "nearby");
    const snapshot = JSON.stringify(nearby);
    if (snapshot === lastSavedRecsRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        setAutoSaving(true);
        const galleryImages = form.property.gallery_images.filter((u) => u.trim()).slice(0, 4);
        const payload = {
          sections: { recommendations: true },
          id,
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
              .map((m) => ({ label: m.label.trim(), url: m.url.trim(), description: m.description.trim() || null }))
              .filter((m) => m.label && m.url),
          },
          recommendations: nearby.filter((r) => r.place_id && r.name && r.name.trim().length > 0),
          manual: form.manual.filter((m) => m.title),
          emergency: form.emergency.filter((m) => m.label && m.number),
          faqs: form.faqs.filter((m) => m.question && m.answer),
          checkout: form.checkout.filter((m) => m.label),
        };
        await save({ data: payload });
        lastSavedRecsRef.current = snapshot;
        setAutoSaveError(null);
      } catch (e) {
        console.warn("[autosave] recs", e);
        setAutoSaveError(friendlyErrorMessage(e, "Erro ao salvar"));
      } finally {
        setAutoSaving(false);
      }
    }, 800);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.recommendations, isNew]);

  // ---- Sincronização instantânea entre quem está nesta tela (estilo Miro) ----
  // Cada seção é transmitida na hora para os outros navegadores; quem recebe
  // só exibe (não regrava) — a gravação é feita por quem editou.
  const liveEnabled = !isNew && hydratedRef.current;
  const applyRemote = (key: "property" | "manual" | "emergency" | "faqs" | "checkout", snap: string) =>
    (v: unknown) => {
      suppressHydrationAutosaveRef.current = true;
      savedSectionsRef.current = { ...(savedSectionsRef.current ?? {}), [snap]: JSON.stringify(v) };
      setForm((f) => ({ ...f, [key]: v }) as FormState);
    };
  useLiveState(presence, "p", form.property, applyRemote("property", "p"), { enabled: liveEnabled });
  useLiveState(presence, "m", form.manual, applyRemote("manual", "m"), { enabled: liveEnabled });
  useLiveState(presence, "e", form.emergency, applyRemote("emergency", "e"), { enabled: liveEnabled });
  useLiveState(presence, "f", form.faqs, applyRemote("faqs", "f"), { enabled: liveEnabled });
  useLiveState(presence, "c", form.checkout, applyRemote("checkout", "c"), { enabled: liveEnabled });
  const nearbyLive = React.useMemo(
    () => form.recommendations.filter((r) => r.scope === "nearby"),
    [form.recommendations],
  );
  useLiveState(
    presence,
    "r",
    nearbyLive,
    (v) => {
      lastSavedRecsRef.current = JSON.stringify(v);
      setForm((f) => ({
        ...f,
        recommendations: [...f.recommendations.filter((r) => r.scope !== "nearby"), ...v],
      }));
    },
    { enabled: liveEnabled },
  );

  // ---- Autosave global do editor ----
  // Qualquer campo, chave ou botão do "Editar guia" grava sozinho ~1,2s depois
  // da última alteração — sem depender do botão "Salvar" (que foi removido).
  const globalSnapshotRef = useRef<string>("");
  const globalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formKey = JSON.stringify({
    p: form.property,
    m: form.manual,
    e: form.emergency,
    f: form.faqs,
    c: form.checkout,
  });
  useEffect(() => {
    if (suppressHydrationAutosaveRef.current) {
      globalSnapshotRef.current = formKey;
      suppressHydrationAutosaveRef.current = false;
      return;
    }
    if (!hydratedRef.current || isNew || readOnly || saving) {
      globalSnapshotRef.current = formKey;
      return;
    }
    if (!globalSnapshotRef.current) {
      globalSnapshotRef.current = formKey;
      return;
    }
    if (globalSnapshotRef.current === formKey) return;
    if (globalTimerRef.current) clearTimeout(globalTimerRef.current);
    globalTimerRef.current = setTimeout(() => {
      globalSnapshotRef.current = formKey;
      void handleSave(undefined, {
        silent: true,
        snapshot: formRef.current,
        editVersion: editVersionRef.current,
      });
    }, 900);
    return () => {
      if (globalTimerRef.current) clearTimeout(globalTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey, isNew, readOnly, saving]);

  // Precisa ser calculado e chamado ANTES do "return" de carregamento abaixo:
  // hooks não podem ser condicionais. Chamar useGuidePreviewUrl depois do
  // early-return fazia a 1ª renderização (isLoading=true, sem este hook)
  // divergir da renderização seguinte (isLoading=false, com o hook) — o
  // React derruba o componente com "Rendered more hooks than during the
  // previous render", que é exatamente o erro genérico visto ao abrir
  // "Editar guia" pela primeira vez (e que some ao clicar em "Tentar de novo",
  // pois a 2ª tentativa já reaproveita os dados em cache e nunca passa pelo
  // estado isLoading=true).
  const savedSlug = !isNew
    ? ((data?.property as Record<string, unknown> | undefined)?.slug as string | undefined)
    : undefined;
  const previewSlug = savedSlug || form.property.slug;
  const previewUrl = useGuidePreviewUrl(previewOpen ? previewSlug : null);

  if (!isNew && isLoading) {
    return <div className="max-w-4xl mx-auto px-6 py-10 text-sm text-muted-foreground">Carregando…</div>;
  }

  const nearbyRecs = form.recommendations.filter((r) => r.scope === "nearby");

  const marketplaceNode = (
<Section
                  id="marketplace"
                  icon={Ticket}
                  title="Compre Online"
                  badge={form.property.marketplace_links.length > 0 ? <CountPill>{form.property.marketplace_links.length}</CountPill> : undefined}
                  topLine="brand"
                  collapsible
                  action={
                    sigmaLocked ? null : (
                      <AddBtn
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            property: {
                              ...f.property,
                              marketplace_links: [
                                ...f.property.marketplace_links,
                                { label: "", url: "", description: "" },
                              ],
                            },
                          }))
                        }
                      />
                    )
                  }
                >
                  {sigmaLocked && (
                    <div className="ds-well ds-atencao flex items-center gap-1.5 px-3 py-2 text-xs">
                      <Lock className="size-3.5" /> Links gerenciados pelo ConciergeIA — edição bloqueada.
                    </div>
                  )}
                  <fieldset
                    disabled={sigmaLocked}
                    className={
                      sigmaLocked
                        ? "min-w-0 m-0 p-0 border-0 opacity-60 pointer-events-none space-y-3"
                        : "min-w-0 m-0 p-0 border-0 space-y-3"
                    }
                  >
                    {form.property.marketplace_links.length === 0 ? (
                      <EmptyHint text="Ex: tour de barco, transfer do aeroporto, kit de boas-vindas." />
                    ) : (
                      form.property.marketplace_links.map((m, i) => (
                        <ItemCard
                          key={i}
                          onRemove={() =>
                            setForm((f) => ({
                              ...f,
                              property: {
                                ...f.property,
                                marketplace_links: f.property.marketplace_links.filter((_, j) => j !== i),
                              },
                            }))
                          }
                        >
                          <Input
                            placeholder="Título (ex: Tour de barco)"
                            value={m.label}
                            maxLength={120}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                property: {
                                  ...f.property,
                                  marketplace_links: f.property.marketplace_links.map((x, j) =>
                                    j === i ? { ...x, label: e.target.value } : x,
                                  ),
                                },
                              }))
                            }
                          />
                          <Input
                            placeholder="https://link-de-venda.com"
                            value={m.url}
                            maxLength={2048}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                property: {
                                  ...f.property,
                                  marketplace_links: f.property.marketplace_links.map((x, j) =>
                                    j === i ? { ...x, url: e.target.value } : x,
                                  ),
                                },
                              }))
                            }
                          />
                          <div className="space-y-1">
                            <Textarea
                              placeholder="Descrição curta (obrigatória — entre 100 e 200 caracteres)"
                              value={m.description}
                              minLength={100}
                              maxLength={200}
                              required
                              aria-invalid={
                                m.description.trim().length > 0 &&
                                (m.description.trim().length < 100 || m.description.trim().length > 200)
                              }
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  property: {
                                    ...f.property,
                                    marketplace_links: f.property.marketplace_links.map((x, j) =>
                                      j === i ? { ...x, description: e.target.value.slice(0, 200) } : x,
                                    ),
                                  },
                                }))
                              }
                            />
                            <div
                              className={`text-[11px] tabular-nums text-right ${m.description.trim().length < 100 || m.description.trim().length > 200 ? "text-rose-500" : "text-muted-foreground"}`}
                            >
                              {m.description.trim().length}/200{" "}
                              {m.description.trim().length < 100
                                ? `· faltam ${100 - m.description.trim().length} para o mínimo`
                                : ""}
                            </div>
                          </div>
                          {m.url ? (
                            <div className="flex justify-end">
                              <POIMetricsBadge
                                counts={{ views: marketplaceClicks[m.url] ?? 0, likes: 0, dislikes: 0, shares: 0 }}
                                viewsOnly
                                position="inline"
                              />
                            </div>
                          ) : null}
                        </ItemCard>
                      ))
                    )}
                  </fieldset>
                </Section>
  );
  const currentOwner = propertyOwnerOptions.find((o) => o.id === form.property.owner_contact_id);
  const showPreview = !!previewSlug;
  const showPlaybook = !isNew && !!id;
  const showMaps = !!(form.property.garage_maps_url || form.property.maps_url || form.property.address);
  const propertyAddressLine = [form.property.address, form.property.city].filter((v) => (v ?? "").trim()).join(", ") || null;

  return (
    <div className="ds-dense-fields ds-presence-fields px-2.5 sm:px-5 lg:px-8 py-5 lg:py-8 max-w-[1440px] w-full">
      {readOnly ? (
        <EditorNotice tone="amber" icon={Lock} className="mb-5">
          Você tem acesso apenas para visualizar este guia. A edição está bloqueada.
        </EditorNotice>
      ) : null}
      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
        {/* CABEÇALHO NO MOLDE DO DASHBOARD (mockup "Editar guia — padrão
            Presença", aprovado em 01/10/2026): data por extenso, título numa
            linha com reticências, "Proprietário: <nome>" logo abaixo (regra de
            17/09 e 23/09: nome do imóvel SEMPRE com o proprietário e o Maps) e
            o subtítulo. Os vãos saem de `ds-page-heading`, como no Dashboard.

            No computador, as abas e a peça de ações ficam na linha do título,
            à direita (a peça colada à esquerda das abas, mesma altura). No
            celular, as abas ocupam a largura inteira e a peça vem embaixo. */}
        <div className="ds-page-heading">
          <PageDateRow
            back={
              <Link to={backTo as "/admin/guias"} className={PAGE_BACK_CLASS}>
                <ArrowLeft className="size-3.5" /> Voltar
              </Link>
            }
          />
          <div>
            <div className="ds-page-heading min-w-0 lg:flex-1">
              <h1 className="ds-page-title !text-lg truncate">{form.property.name || "Sem título"}</h1>
              {currentOwner ? (
                <OwnerLine
                  name={currentOwner.name}
                  phone={currentOwner.phone}
                  country={currentOwner.phoneCountry}
                  phonePosition="adjacent"
                  variant="neutral"
                />
              ) : null}
              <p className="ds-page-subtitle">
                Monte a curadoria de dicas locais deste imóvel.
              </p>
              {!isNew ? (
                <div className="ds-scroll-x items-center gap-2">
                  <PresenceAvatars users={presence.users} />
                </div>
              ) : null}
            </div>

            {(showPreview || showMaps || showPlaybook) && (
              <div className="mt-5 flex flex-col gap-2 lg:mt-2.5 lg:flex-row lg:items-center lg:gap-2">
                {(showPreview || showMaps || showPlaybook) && (
                  /* UMA PEÇA SÓ, PARTIDA AO MEIO — como Filtros|Pendências no
                     Kanban (pedido explícito, 01/10/2026): à esquerda o olho +
                     "Pré-Visualizar", à direita o pin + "Localização". O botão
                     de olho flutuante saiu do canto da tela (ficava em cima do
                     "Próximo"), e o Maps saiu do lado do título. A Localização
                     é o MESMO `PropertyMapsButton` dos cards, só com outra cara. */
                  <div className={`order-2 lg:order-1 lg:shrink-0 ${ACTION_BAR}`}>
                    {showPreview && (
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewMode(null);
                          setPreviewOpen(true);
                        }}
                        title="Pré-visualizar guia"
                        aria-label="Pré-Visualizar"
                        className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
                      >
                        <Eye className={ACTION_ICON} />
                        <span className="lg:hidden">Pré-Visualizar</span>
                      </button>
                    )}
                    {showPlaybook && (
                      <Link
                        to="/admin/playbook/$id"
                        params={{ id }}
                        title="Playbook do imóvel"
                        aria-label="Playbook"
                        className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
                      >
                        <FileText className={ACTION_ICON} />
                        <span className="lg:hidden">Playbook</span>
                      </Link>
                    )}
                    {showMaps && (
                      <PropertyMapsButton
                        propertyName={form.property.name || null}
                        propertyAddress={propertyAddressLine}
                        mapsUrl={form.property.maps_url || null}
                        garageMapsUrl={form.property.garage_maps_url || null}
                        complement={form.property}
                        trigger={
                          <button
                            type="button"
                            title="Localização do imóvel"
                            aria-label="Localização"
                            className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
                          >
                            <MapPin className={ACTION_ICON} />
                            <span className="lg:hidden">Localização</span>
                          </button>
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DenseSections variant="presence">
          <div>
            {/* ================= RECOMENDAÇÕES ================= */}
            <div className={TAB_CONTENT}>
              {!isNew && <SigmaActiveBanner propertyId={id} />}
              <div className={SECTION_LIST}>
              <SectionGroup defaultOpenId="marketplace">
                {marketplaceNode}
                <div className={`${PANEL_SHELL} flex flex-col gap-3 p-3.5`}>
                  <PanelHeading
                    title="Adicionar ponto"
                    dotColor="#e82dae"
                    className=""
                    right={<span className="ds-faint text-[10.5px]">Decidimos o quadrante pela distância</span>}
                  />
                  <PlaceAutocomplete
                    scope="nearby"
                    lat={form.property.lat}
                    lng={form.property.lng}
                    existingPlaceIds={allExistingPlaceIds}
                    onSelect={(rec) => {
                      const isNearby =
                        (rec.distance_meters != null && rec.distance_meters <= 1500) ||
                        (rec.walk_minutes != null && rec.walk_minutes <= 20);
                      if (isNearby) {
                        setForm((f) => ({
                          ...f,
                          recommendations: [...f.recommendations, { ...rec, scope: "nearby" }],
                        }));
                      } else {
                        const city = (form.property.city || "").trim();
                        if (!city) {
                          toast.error("Preencha o endereço completo (aba A casa) antes.");
                          return;
                        }
                        addCityRefFn({
                          data: {
                            city_label: city,
                            state: form.property.state || null,
                            country: form.property.country || "BR",
                            type: rec.type || "other",
                            category: rec.category || "Outros",
                            name: rec.name,
                            place_id: rec.place_id!,
                            note: rec.note ?? null,
                            rating: rec.rating ?? null,
                            user_ratings_total: rec.user_ratings_total ?? null,
                            image_url: rec.image_url ?? null,
                            maps_url: rec.maps_url ?? null,
                            opening_hours: rec.opening_hours ?? null,
                            lat: rec.lat ?? null,
                            lng: rec.lng ?? null,
                            propertyId: id,
                          },
                        })
                          .then(() => invalidateCityRefs())
                          .catch((e) =>
                            toast.error(
                              friendlyErrorMessage(e, "Não conseguimos adicionar este ponto. Tente outro lugar."),
                            ),
                          );
                      }
                    }}
                  />
                </div>

                <RecGroup
                  title="Aqui pertinho"
                  items={nearbyRecs}
                  onChange={(items) => setForm((f) => ({ ...f, recommendations: items }))}
                  scope="nearby"
                  lat={form.property.lat}
                  lng={form.property.lng}
                  hideSearch
                  headerExtra={<LinkGuidesButton propertyId={id} />}
                  metricsCounts={poiCounts}
                />

                <CityRefsGroup
                  cityLabel={form.property.city}
                  state={form.property.state || null}
                  country={form.property.country || "BR"}
                  propertyLat={form.property.lat}
                  propertyLng={form.property.lng}
                  propertyId={id}
                  queryKey={cityRefsKey}
                  listFn={listGeneratedCityRefs}
                  addFn={addCityRefFn}
                  updateFn={updateCityRefFn}
                  bulkDeleteFn={bulkDeleteCityRefsFn}
                  invalidate={invalidateCityRefs}
                  locked={sigmaLocked}
                  metricsCounts={poiCounts}
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

              </SectionGroup>
              </div>
            </div>
          </div>
        </DenseSections>

        <div aria-hidden="true" className="h-36 sm:h-32 lg:h-28" />

        {/* O botão de olho flutuante saiu daqui (01/10/2026): virou a metade
            "Pré-Visualizar" da peça de ações do cabeçalho. A janela continua
            a mesma. */}
        {previewSlug && (
          <>
            <Dialog
              open={previewOpen}
              onOpenChange={(o) => {
                setPreviewOpen(o);
                if (!o) setPreviewMode(null);
              }}
            >
              <DialogContent
                className={
                  previewMode === "desktop"
                    ? "p-0 gap-0 overflow-hidden border-0 bg-transparent shadow-none sm:max-w-[1100px] w-[min(95vw,1100px)] [&>button]:hidden"
                    : previewMode === "mobile"
                      ? "p-0 gap-0 overflow-visible border-0 bg-transparent shadow-none sm:max-w-[340px] w-[min(82vw,340px)] [&>button]:hidden"
                      : "p-0 gap-0 overflow-visible border-0 bg-transparent shadow-none sm:max-w-[400px] w-[min(92vw,400px)] [&>button]:hidden"
                }
              >
                <DialogTitle className="sr-only">Pré-visualização do guia</DialogTitle>
                {previewMode === null ? (
                  /* Padrão "Janelas flutuantes" (`ds-overlay`, mockup aprovado
                     01/10/2026): eyebrow + fechar, título, as duas opções em
                     cartões e "toque fora para fechar" — tocar fora já fecha
                     pelo próprio Dialog. */
                  <div className="ds-overlay flex flex-col gap-4 p-5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="ds-eyebrow text-[10px] text-muted-foreground">Pré-visualizar</span>
                      <button
                        type="button"
                        onClick={() => setPreviewOpen(false)}
                        aria-label="Fechar"
                        className="grid size-7 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <div>
                      <h3 className="font-display text-lg font-bold tracking-tight">Como deseja visualizar?</h3>
                      <p className="text-xs text-muted-foreground mt-1">Escolha o modo de pré-visualização do guia.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setPreviewMode("mobile")}
                        className="group flex flex-col items-center gap-2 rounded-[14px] bg-foreground/[0.045] px-2.5 py-4 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_6.5%,transparent)] transition-colors hover:bg-foreground/[0.07]"
                      >
                        <Smartphone className="size-7 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={1.5} />
                        <span className="text-[13px] font-bold">Celular</span>
                        <span className="text-[11px] text-muted-foreground">Tela do celular</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode("desktop")}
                        className="group flex flex-col items-center gap-2 rounded-[14px] bg-foreground/[0.045] px-2.5 py-4 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_6.5%,transparent)] transition-colors hover:bg-foreground/[0.07]"
                      >
                        <Monitor className="size-7 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={1.5} />
                        <span className="text-[13px] font-bold">Navegador</span>
                        <span className="text-[11px] text-muted-foreground">Tela ampla</span>
                      </button>
                    </div>
                    <p className="ds-faint text-center text-[11px]">Toque fora para fechar</p>
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
                          <p className="text-[10px] font-medium text-muted-foreground/80 truncate flex-1">
                            /g/{previewSlug}
                          </p>
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
                          src={previewUrl ?? "about:blank"}
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
                  <div className="flex flex-col h-[85vh] max-h-[820px] ds-surface overflow-hidden bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] ring-1 ring-black/10">
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
                      src={previewUrl ?? "about:blank"}
                      title="Pré-visualização do guia"
                      className="w-full flex-1 border-0 bg-background"
                    />
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* RODAPÉ (mockup aprovado, 01/10/2026): Anterior | Próximo como UMA
            peça partida ao meio (removida em 29/10/2026 com as abas antigas);
            ficou só o aviso do salvamento automático com o ponto verde-sálvia. */}
        <div
          ref={editorFooterRef}
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/85 px-4 pt-3 pb-3.5 backdrop-blur-[10px]"
        >
          <div className="mx-auto flex max-w-[420px] flex-col items-center gap-2">
            {!readOnly && !isNew && (
              <p
                className={`text-center text-[11px] inline-flex w-full items-center justify-center gap-1.5 ${
                  autoSaveError ? "ds-falta" : "ds-faint"
                }`}
                // Passe o mouse aqui pra ver o motivo real de uma falha — sem
                // isso, "Falha ao salvar" sozinho não dava nenhuma pista do
                // que travou o autosave desta página.
                title={autoSaveError ?? undefined}
              >
                {autoSaving ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> Salvando…
                  </>
                ) : autoSaveError ? (
                  <>
                    <AlertTriangle className="size-3" /> Falha ao salvar — passe o mouse aqui pra ver o motivo
                  </>
                ) : (
                  <>
                    <span aria-hidden className="size-1.5 rounded-full bg-[#7fb79a]" />
                    Alterações salvas automaticamente
                  </>
                )}
              </p>
            )}
          </div>
        </div>

      </fieldset>
    </div>
  );
}

/**
 * Publica a altura do rodapé fixo em `--page-footer-h`, para o botão flutuante
 * do Assistente (`FloatingDock`) ficar SEMPRE acima dele, nunca por cima do
 * "Próximo" (mockup aprovado, 01/10/2026). Ref de callback no nível do módulo:
 * é estável entre renders e o editor só existe uma vez na tela.
 */
let editorFooterObserver: ResizeObserver | null = null;
function editorFooterRef(node: HTMLDivElement | null) {
  editorFooterObserver?.disconnect();
  editorFooterObserver = null;
  const root = document.documentElement;
  if (!node) {
    root.style.removeProperty("--page-footer-h");
    return;
  }
  const publish = () => root.style.setProperty("--page-footer-h", `${node.offsetHeight}px`);
  publish();
  editorFooterObserver = new ResizeObserver(publish);
  editorFooterObserver.observe(node);
}

/* ------------------------------------------------------------------------ */
/* Padrão Presença no editor de guia (mockup aprovado, 01/10/2026)          */
/* ------------------------------------------------------------------------ */

/**
 * O RITMO DE UMA ABA — os mesmos dois números do Dashboard, sem número novo:
 * 24px entre BLOCOS (`--ds-block-gap`: cabeçalho → conteúdo, aviso →
 * quadrantes, subabas → quadrantes) e 10px entre QUADRANTES vizinhos
 * (`--ds-grid-gap`, `ds-card-grid`). Flex/grid `gap`, nunca margem.
 */
const TAB_CONTENT = "mt-6 flex flex-col gap-[var(--ds-block-gap,24px)]";
const SECTION_LIST = "ds-card-grid grid-cols-[minmax(0,1fr)]";

/**
 * AVISO DENTRO DO EDITOR — card normal com o fio de 2px no topo na cor do tom
 * (padrão Presença: "Limpezas completas para aprovar" deixou de ser uma
 * moldura âmbar inteira e virou isto). Vale para pendências, plano, erro da
 * importação e conteúdo travado pelo ConciergeIA.
 */
function EditorNotice({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: SectionTopLine;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  const iconTone = tone === "rose" ? "ds-falta" : tone === "amber" ? "ds-atencao" : "text-muted-foreground";
  return (
    <div className={cn(PANEL_SHELL, className)}>
      <SectionTopLineBar tone={tone} />
      <div className="flex items-start gap-2.5 p-3.5">
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", iconTone)} />
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function AddBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} className="shrink-0 rounded-full text-xs">
      <Plus className="size-3.5" /> Adicionar
    </Button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-[12px] border border-dashed border-border/70 px-4 py-5 text-center text-xs text-muted-foreground leading-relaxed">
      {text}
    </div>
  );
}

function ItemCard({
  children,
  onRemove,
  row = false,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  /** Uma linha só: o campo e a lixeira ao lado, sem caixa (mockup "Checklist de check-out", 01/10/2026). */
  row?: boolean;
}) {
  if (row) {
    return (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remover"
          className="ds-faint grid size-9 shrink-0 place-items-center rounded-[8px] transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div className="group ds-well p-3.5 pr-10 space-y-2.5 relative transition-colors">
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

export function PlaceAutocomplete({
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
  const wrapRef = useManualOverlayLayer<HTMLDivElement>(open, () => setOpen(false));

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
      lat: p.lat ?? null,
      lng: p.lng ?? null,
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
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1.5 w-full ds-surface border border-border bg-popover shadow-lg overflow-hidden max-h-80 overflow-y-auto">
          {results.map((p) => {
            const dup = p.place_id ? existingPlaceIds.has(p.place_id) : false;
            return (
              <button
                key={p.place_id}
                type="button"
                onClick={() => pick(p)}
                disabled={dup}
                aria-disabled={dup}
                title={dup ? "Este ponto já foi adicionado ao guia." : undefined}
                className={`w-full flex items-start gap-3 px-3 py-2.5 text-left border-b border-border/40 last:border-b-0 transition-colors ${
                  dup ? "bg-muted/40 opacity-60 cursor-not-allowed grayscale" : "hover:bg-muted/50"
                }`}
              >
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt=""
                    className={`size-10 rounded-md object-cover shrink-0 ${dup ? "opacity-60" : ""}`}
                  />
                ) : (
                  <span className="grid place-items-center size-10 rounded-md bg-muted shrink-0">
                    <MapPin className="size-4 text-muted-foreground" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium truncate flex items-center gap-1.5 ${dup ? "line-through text-muted-foreground" : ""}`}
                  >
                    {dup && <Lock className="size-3 shrink-0" />}
                    {p.name}
                  </p>
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
                {dup && (
                  <span className="self-center shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <Lock className="size-3" /> Já no guia
                  </span>
                )}
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
  propertyId,
  queryKey,
  onGenerate,
  generating,
  listFn,
  addFn,
  updateFn,
  bulkDeleteFn,
  invalidate,
  locked,
  metricsCounts,
}: {
  cityLabel: string;
  state: string | null;
  country: string;
  propertyLat: number | null;
  propertyLng: number | null;
  propertyId: string;
  queryKey: readonly unknown[];
  onGenerate?: () => void;
  generating?: boolean;
  listFn: (args: {
    data: {
      city_label: string;
      state: string | null;
      country: string;
      includeHidden?: boolean;
      propertyId?: string | null;
    };
  }) => Promise<{ items: unknown[] }>;
  addFn: (args: { data: Record<string, unknown> }) => Promise<{ id: string | null; duplicate?: boolean }>;
  updateFn: (args: { data: { id: string; patch: Record<string, unknown> } }) => Promise<{ ok: boolean }>;
  bulkDeleteFn: (args: { data: { ids: string[] } }) => Promise<{ ok: boolean; deleted?: number }>;
  invalidate: () => void;
  locked?: boolean;
  metricsCounts?: Record<string, { views: number; likes: number; dislikes: number; shares: number }>;
}) {
  const city = (cityLabel || "").trim();
  const q = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { city_label: city, state, country, includeHidden: false, propertyId } }),
    enabled: !!city && !!propertyId,
  });

  const serverItems: RecItem[] = React.useMemo(() => {
    const rows = (q.data?.items ?? []) as CityRefRow[];
    return rows.filter((r) => !r.is_hidden).map(rowToRec);
  }, [q.data]);

  // Estado local para edições otimistas (nome/nota/maps_url). Reconciliamos
  // com o servidor sempre que a query atualiza.
  const [localItems, setLocalItems] = React.useState<RecItem[]>(serverItems);
  React.useEffect(() => {
    setLocalItems(serverItems);
  }, [serverItems]);

  // Debounce de updates por id (chave -> timeout).
  const pendingUpdates = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inflightAdds = React.useRef<Set<string>>(new Set());
  function scheduleUpdate(id: string, patch: Record<string, unknown>) {
    const map = pendingUpdates.current;
    const existing = map.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      map.delete(id);
      updateFn({ data: { id, patch } })
        .then(() => invalidate())
        .catch((e) => toast.error(friendlyErrorMessage(e, "Erro ao salvar alteração")));
    }, 700);
    map.set(id, t);
  }

  function handleChange(next: RecItem[]) {
    const prev = localItems;
    setLocalItems(next);

    if (!city) {
      toast.error("Preencha o endereço completo (aba A casa) antes de gerenciar referências.");
      return;
    }

    // Exclusões: ids presentes em prev e ausentes em next.
    const prevIds = new Set(prev.map((p) => p._dbId).filter(Boolean) as string[]);
    const nextIds = new Set(next.map((p) => p._dbId).filter(Boolean) as string[]);
    const deletedIds = [...prevIds].filter((id) => !nextIds.has(id));
    if (deletedIds.length) {
      bulkDeleteFn({ data: { ids: deletedIds } })
        .then(() => invalidate())
        .catch((e) => toast.error(friendlyErrorMessage(e, "Não conseguimos excluir agora.")));
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
          lat: rec.lat ?? null,
          lng: rec.lng ?? null,
          propertyId,
        },
      })
        .then(() => invalidate())
        .catch((e) => toast.error(friendlyErrorMessage(e, "Não conseguimos adicionar este ponto. Tente outro lugar.")))
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
      if ((n.category ?? null) !== (before.category ?? null)) patch.category = n.category ?? null;
      if (Object.keys(patch).length) scheduleUpdate(n._dbId, patch);
    }
  }

  // Renomear/mover uma categoria inteira grava EM LOTE, numa chamada só, e
  // só nos pontos deste guia/grupo — não um update por ponto (com 100+
  // pontos, o debounce por item disparava 100+ chamadas).
  const renameCategoryFn = useServerFn(renameCityReferenceCategory);
  async function handleRenameCategory(from: string, to: string, groupItems: RecItem[]) {
    const ids = groupItems.map((it) => it._dbId).filter((x): x is string => !!x);
    if (!ids.length) return;
    await renameCategoryFn({ data: { propertyId, ids, to } });
    setLocalItems((prev) => prev.map((it) => (it._dbId && ids.includes(it._dbId) ? { ...it, category: to } : it)));
    invalidate();
  }

  return (
    <RecGroup
      title="Pela cidade"
      items={localItems}
      onChange={handleChange}
      onRenameCategory={handleRenameCategory}
      scope="city"
      lat={propertyLat}
      lng={propertyLng}
      generating={generating || q.isFetching}
      headerExtra={
        <>
          <SigmaImportButton propertyId={propertyId} />
          <SaveAsSigmaPackButton propertyId={propertyId} />
          <LinkGuidesButton propertyId={propertyId} />
        </>
      }
      hideSearch
      locked={locked}
      metricsCounts={metricsCounts}
    />
  );
}

export function RecGroup({
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
  headerExtra,
  hideSearch,
  locked,
  metricsCounts,
  onRenameCategory,
}: {
  title: string;
  desc?: string;
  items: RecItem[];
  onChange: (i: RecItem[]) => void;
  /** Troca o rótulo de categoria de um grupo de pontos NESTE guia (ver
   * `CityRefsGroup`, que grava em lote). Sem isto, o rótulo é trocado nos
   * itens via `onChange` — caso do "Aqui pertinho", salvo pelo autosave. */
  onRenameCategory?: (from: string, to: string, groupItems: RecItem[]) => Promise<void>;
  scope: "nearby" | "city";
  lat: number | null;
  lng: number | null;
  onReplicate?: () => void;
  onGenerate?: () => void;
  generating?: boolean;
  headerExtra?: React.ReactNode;
  hideSearch?: boolean;
  locked?: boolean;
  metricsCounts?: Record<string, { views: number; likes: number; dislikes: number; shares: number }>;
}) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [openItemIdx, setOpenItemIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());
  const [filterQuery, setFilterQuery] = useState("");
  // "Nova categoria…" do menu Mover: nome digitado para onde vão os
  // pontos selecionados (a categoria só existe neste guia).
  const [newMoveCatOpen, setNewMoveCatOpen] = useState(false);
  const [newMoveCatName, setNewMoveCatName] = useState("");
  const { isAdmin } = useIsAdmin();
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [dragOverCat, setDragOverCat] = useState<string | null>(null);
  const qc = useQueryClient();
  const reorderFn = useServerFn(reorderPoiCategories);
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const filterActive = filterQuery.trim().length > 0;
  const matchesFilter = (it: RecItem) =>
    !filterActive ||
    norm(it.name ?? "").includes(norm(filterQuery)) ||
    norm(it.category ?? "").includes(norm(filterQuery));
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { data: taxonomy } = useTaxonomy();

  // Mapa slug-da-tag → label-da-categoria (fonte da verdade ao agrupar).
  const tagToCategoryLabel = React.useMemo(() => {
    const m = new Map<string, string>();
    (taxonomy?.tags ?? []).forEach((t) => m.set(t.slug, t.category_label));
    return m;
  }, [taxonomy]);

  // Sem limite por subcategoria — usuário pode adicionar quantos pontos quiser.
  const groups = new Map<string, { items: RecItem[]; indices: number[] }>();
  items.forEach((it, idx) => {
    const key = it.category || tagToCategoryLabel.get(it.type) || "Outros";
    const g = groups.get(key) ?? { items: [], indices: [] };
    g.items.push(it);
    g.indices.push(idx);
    groups.set(key, g);
  });
  // Ordena pelos display_order da taxonomia; categorias órfãs vão para o fim.
  const orderByLabel = React.useMemo(() => {
    const m = new Map<string, number>();
    (taxonomy?.categories ?? []).forEach((c) => m.set(c.label, c.display_order ?? 9999));
    return m;
  }, [taxonomy]);
  const groupEntries = Array.from(groups.entries()).sort((a, b) => {
    const oa = orderByLabel.get(a[0]) ?? 99999;
    const ob = orderByLabel.get(b[0]) ?? 99999;
    if (oa !== ob) return oa - ob;
    return a[0].localeCompare(b[0]);
  });

  /*
   * CATEGORIAS SÃO DESTE GUIA (auditoria das recomendações, 24/09/2026).
   *
   * Renomear, criar, mover e excluir categoria aqui mexe SÓ nos pontos deste
   * guia (ou do grupo de guias vinculados). Antes, esses botões editavam a
   * taxonomia GLOBAL da plataforma: para um anfitrião davam erro, e para um
   * admin mudavam o guia de todo mundo — a categoria-base "Compras" virou "No
   * Paraguai" num guia de Foz e passou a aparecer em Ourinhos. A taxonomia
   * global continua existindo (é dela que vêm os nomes padrão e a ordem) e se
   * edita só em Admin → Taxonomia.
   */
  const groupKeyOf = (it: RecItem) => it.category || tagToCategoryLabel.get(it.type) || "Outros";
  async function renameGroup(from: string, to: string) {
    const groupItems = items.filter((it) => groupKeyOf(it) === from);
    if (onRenameCategory) await onRenameCategory(from, to, groupItems);
    else onChange(items.map((it) => (groupKeyOf(it) === from ? { ...it, category: to } : it)));
  }
  function deleteGroup(label: string) {
    onChange(items.filter((it) => groupKeyOf(it) !== label));
  }
  // Destinos possíveis para "Mover": as categorias já usadas neste guia + as
  // padrão da plataforma (sem repetir), na ordem da taxonomia.
  const moveTargets = React.useMemo(() => {
    const labels = new Set<string>([
      ...Array.from(groups.keys()),
      ...(taxonomy?.categories ?? []).map((c) => c.label),
    ]);
    return Array.from(labels).sort((a, b) => {
      const oa = orderByLabel.get(a) ?? 99999;
      const ob = orderByLabel.get(b) ?? 99999;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, taxonomy, orderByLabel]);
  function moveSelectedTo(label: string) {
    const next = items.map((it, i) => (selectedIdx.has(i) ? { ...it, category: label } : it));
    onChange(next);
    setSelectedIdx(new Set());
    toast.success(`Movidos para "${label}"`);
  }

  async function handleDropOnCat(targetLabel: string) {
    if (!dragCat || dragCat === targetLabel) {
      setDragCat(null);
      setDragOverCat(null);
      return;
    }
    const labels = groupEntries.map(([l]) => l);
    const from = labels.indexOf(dragCat);
    const to = labels.indexOf(targetLabel);
    if (from < 0 || to < 0) {
      setDragCat(null);
      setDragOverCat(null);
      return;
    }
    const next = labels.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    setDragCat(null);
    setDragOverCat(null);
    // Converte labels → ids da taxonomia (ignora órfãs que não existem).
    const ids = next
      .map((lbl) => (taxonomy?.categories ?? []).find((c) => c.label === lbl)?.id)
      .filter((x): x is string => !!x);
    if (ids.length < 2) return;
    try {
      await reorderFn({ data: { ordered_ids: ids } });
      qc.invalidateQueries({ queryKey: TAXONOMY_QUERY_KEY });
    } catch (e) {
      toast.error(friendlyErrorMessage(e));
    }
  }

  const existingPlaceIds = new Set(items.map((i) => i.place_id).filter((x): x is string => !!x));

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
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
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
    <Section icon={scope === "nearby" ? MapPin : Compass} title={title} desc={desc} badge={items.length ? <CountPill>{items.length}</CountPill> : undefined}>
      {locked && (
        <div className="ds-well flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="ds-atencao text-xs inline-flex items-center gap-1.5">
            <Lock className="size-3.5" /> Conteúdo gerenciado pelo ConciergeIA — edição bloqueada.
          </span>
          <div className="flex items-center gap-1.5">{headerExtra}</div>
        </div>
      )}
      <fieldset
        disabled={!!locked}
        className={
          locked
            ? "min-w-0 m-0 p-0 border-0 opacity-60 pointer-events-none space-y-3"
            : "min-w-0 m-0 p-0 border-0 space-y-3"
        }
      >
        {/* Linha 1: ações de seleção (alinhadas à esquerda) */}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 -mt-1">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 h-8 inline-flex items-center"
            >
              {selectedIdx.size === items.length ? "Limpar" : "Selecionar todos"}
            </button>
            {selectedIdx.size > 0 && (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="rounded-full text-xs"
                >
                  <Trash2 className="size-3.5" /> Excluir ({selectedIdx.size})
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="rounded-full text-xs">
                      <MoveRight className="size-3.5" /> Mover ({selectedIdx.size})
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                    <DropdownMenuLabel className="text-[10px] uppercase">Mover para categoria</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {moveTargets.map((label) => (
                      <DropdownMenuItem key={label} onClick={() => moveSelectedTo(label)}>
                        {label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        setNewMoveCatName("");
                        setNewMoveCatOpen(true);
                      }}
                    >
                      <Plus className="size-3.5" /> Nova categoria…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        )}
        <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {selectedIdx.size} item(ns)?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação remove <strong>{selectedIdx.size}</strong> recomendaç{selectedIdx.size === 1 ? "ão" : "ões"}{" "}
                selecionada{selectedIdx.size === 1 ? "" : "s"} da lista. Você poderá adicioná-las novamente depois,
                manualmente ou via "Gerar com IA".
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={deleteSelected}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Linha 2: busca à esquerda (larga) + ações à direita */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative flex-1 min-w-[180px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Buscar neste quadrante…"
              className="h-8 pl-7 pr-2 text-xs rounded-full w-full"
              maxLength={120}
            />
          </div>
          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
            {headerExtra}
            {onReplicate && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onReplicate}
                className="shrink-0 rounded-full text-xs text-muted-foreground hover:text-foreground"
                title="Replicar"
              >
                <Share2 className="size-3.5" /> <span className="hidden sm:inline">Replicar</span>
              </Button>
            )}
            {onGenerate && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onGenerate}
                disabled={generating}
                className="shrink-0 rounded-full text-xs"
                title="Gerar com IA"
              >
                {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                <span className="hidden sm:inline">Gerar com IA</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="shrink-0 rounded-full text-xs" title="Editar">
                  <Settings2 className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[420px] overflow-y-auto w-64">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Categorias deste guia
                </DropdownMenuLabel>
                <p className="px-2 pb-1.5 text-[10.5px] leading-snug text-muted-foreground">
                  Renomear ou excluir aqui muda só este guia.
                </p>
                <div className="px-1.5 pb-1.5 space-y-0.5">
                  {groupEntries.length === 0 ? (
                    <p className="px-1.5 py-1 text-[11px] text-muted-foreground">Nenhuma categoria ainda.</p>
                  ) : (
                    groupEntries.map(([label, g]) => (
                      <div
                        key={label}
                        className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted/60"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <div className="min-w-0 flex-1">
                          <InlineCategoryRename currentLabel={label} onRename={(to) => renameGroup(label, to)} />
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          ({g.items.length})
                        </span>
                        <CategoryDeleteButton
                          currentLabel={label}
                          targets={moveTargets.filter((l) => l !== label)}
                          itemsInCategory={g.items.length}
                          onMove={(to) => renameGroup(label, to)}
                          onDelete={() => deleteGroup(label)}
                        />
                      </div>
                    ))
                  )}
                </div>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/admin/taxonomia" className="text-xs">
                        <Settings2 className="size-3.5" /> Taxonomia global (admin)
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Dialog open={newMoveCatOpen} onOpenChange={setNewMoveCatOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Nova categoria</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Os {selectedIdx.size} ponto(s) selecionado(s) vão para esta categoria — ela vale só para este guia.
            </p>
            <Input
              autoFocus
              value={newMoveCatName}
              onChange={(e) => setNewMoveCatName(e.target.value)}
              placeholder="Ex.: Shoppings, Sorveterias, No Paraguai"
              maxLength={60}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newMoveCatName.trim()) {
                  e.preventDefault();
                  moveSelectedTo(newMoveCatName.trim());
                  setNewMoveCatOpen(false);
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setNewMoveCatOpen(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={!newMoveCatName.trim() || selectedIdx.size === 0}
                onClick={() => {
                  moveSelectedTo(newMoveCatName.trim());
                  setNewMoveCatOpen(false);
                }}
              >
                Mover
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {!hideSearch && (
          <PlaceAutocomplete
            scope={scope}
            lat={lat}
            lng={lng}
            existingPlaceIds={existingPlaceIds}
            onSelect={handlePlaceSelect}
          />
        )}

        {items.length === 0 ? (
          <EmptyHint text="Nenhuma recomendação. Busque um lugar acima ou use o auto-preenchimento." />
        ) : (
          <div className="space-y-2">
            {groupEntries.map(([cat, g]) => {
              const visibleItems = filterActive ? g.items.filter((it) => matchesFilter(it)) : g.items;
              if (visibleItems.length === 0) return null;
              const open = openCat === cat || filterActive;
              const groupSelected = g.indices.filter((i) => selectedIdx.has(i)).length;
              const allInGroup = groupSelected === g.indices.length && g.indices.length > 0;
              return (
                <div
                  key={cat}
                  className={`ds-well overflow-hidden transition-colors ${
                    dragOverCat === cat ? "ring-2 ring-primary/30" : ""
                  } ${dragCat === cat ? "opacity-60" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragCat && dragCat !== cat) setDragOverCat(cat);
                  }}
                  onDragLeave={() => {
                    if (dragOverCat === cat) setDragOverCat(null);
                  }}
                  onDrop={() => handleDropOnCat(cat)}
                >
                  <div
                    className="flex min-h-12 items-center gap-2.5 px-3 py-2 transition-colors hover:bg-foreground/[0.02]"
                    /* A ORDEM das categorias é a da taxonomia global (vale
                       para todos os guias) — só admin arrasta. Para quem não
                       é admin, arrastar sempre terminava em erro de permissão. */
                    draggable={isAdmin}
                    onDragStart={() => isAdmin && setDragCat(cat)}
                    onDragEnd={() => {
                      setDragCat(null);
                      setDragOverCat(null);
                    }}
                    title={isAdmin ? "Arraste para reordenar (ordem global)" : undefined}
                    style={{ cursor: isAdmin ? "grab" : undefined }}
                  >
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
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <InlineCategoryRename currentLabel={cat} onRename={(to) => renameGroup(cat, to)} />
                        <CategoryDeleteButton
                          currentLabel={cat}
                          targets={moveTargets.filter((l) => l !== cat)}
                          itemsInCategory={g.items.length}
                          onMove={(to) => renameGroup(cat, to)}
                          onDelete={() => deleteGroup(cat)}
                        />
                        <span className="flex-1" />
                        <CountPill>
                          {g.items.length}
                          {groupSelected > 0 ? ` · ${groupSelected} sel.` : ""}
                        </CountPill>
                      </div>
                      <ChevronDown
                        className={`size-[14px] shrink-0 transition-transform ${open ? "rotate-180 text-muted-foreground" : "ds-faint"}`}
                      />
                    </button>
                  </div>
                  {open && (
                    <div className="flex flex-col">
                      {g.items.map((r, k) => {
                        if (filterActive && !matchesFilter(r)) return null;
                        const idx = g.indices[k];
                        const checked = selectedIdx.has(idx);
                        const itemOpen = openItemIdx === idx;
                        const tagLabel = (taxonomy?.tags ?? []).find((t) => t.slug === r.type)?.label ?? r.type ?? "";
                        return (
                          <div
                            key={idx}
                            className="border-t border-foreground/[0.05]"
                          >
                            <div className="flex items-center gap-2.5 px-3 py-2.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSelect(idx)}
                                className="size-4 accent-current shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <button
                                type="button"
                                onClick={() => setOpenItemIdx(itemOpen ? null : idx)}
                                className="flex-1 min-w-0 flex items-center gap-2 text-left"
                                aria-expanded={itemOpen}
                              >
                                {/* Linha do ponto (mockup aprovado, 01/10/2026): foto
                                    de 40px, nome numa linha e, embaixo, nota e
                                    distância — dados que o ponto já tem. */}
                                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[9px] bg-foreground/[0.05] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)]">
                                  {r.image_url ? (
                                    <img src={r.image_url} alt="" className="size-full object-cover" loading="lazy" />
                                  ) : (
                                    <ImageIcon className="ds-faint size-3.5" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-semibold">{r.name || "(sem nome)"}</span>
                                  {(r.rating != null || r.distance_text || tagLabel) && (
                                    <span className="ds-faint mt-0.5 block truncate text-[11px]">
                                      {r.rating != null && (
                                        <>
                                          <span className="ds-atencao">★</span> {String(r.rating).replace(".", ",")}
                                        </>
                                      )}
                                      {r.rating != null && r.distance_text ? " · " : null}
                                      {r.distance_text || null}
                                      {r.rating == null && !r.distance_text ? tagLabel : null}
                                    </span>
                                  )}
                                </span>
                                <ChevronDown
                                  className={`size-[14px] shrink-0 transition-transform ${itemOpen ? "rotate-180 text-muted-foreground" : "ds-faint"}`}
                                />
                              </button>
                              {metricsCounts && r._dbId ? (
                                <POIMetricsBadge counts={metricsCounts[r._dbId]} position="inline" />
                              ) : null}
                              <button
                                type="button"
                                onClick={() => removeAt(idx)}
                                className="ds-faint shrink-0 inline-flex size-7 items-center justify-center rounded-[8px] hover:text-rose-500 hover:bg-foreground/[0.05]"
                                aria-label="Remover"
                                title="Remover"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                            {itemOpen && (
                              <div className="border-t border-foreground/[0.05] px-3 py-3 space-y-2">
                                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                                  <Input
                                    placeholder="Nome"
                                    value={r.name}
                                    maxLength={200}
                                    onChange={(e) => updateAt(idx, { name: e.target.value })}
                                  />
                                  <TagPicker
                                    value={r.type}
                                    onChange={(v) => {
                                      const tags = taxonomy?.tags ?? [];
                                      const tag = tags.find((t) => t.slug === v);
                                      const newCat = tag?.category_label ?? r.category ?? null;
                                      updateAt(idx, { type: v, category: newCat });
                                    }}
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <Input
                                    placeholder="Distância (texto)"
                                    value={r.distance_text ?? ""}
                                    maxLength={80}
                                    onChange={(e) => updateAt(idx, { distance_text: e.target.value })}
                                  />
                                  <Input
                                    placeholder="Link Maps"
                                    value={r.maps_url ?? ""}
                                    maxLength={2048}
                                    onChange={(e) => updateAt(idx, { maps_url: e.target.value })}
                                  />
                                </div>
                                <Textarea
                                  placeholder="Nota pessoal (opcional)"
                                  value={r.note ?? ""}
                                  maxLength={1000}
                                  onChange={(e) => updateAt(idx, { note: e.target.value })}
                                />
                                {(r.category || r.rating) && (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <MapPin className="size-3" /> {r.category} {r.rating ? `· ★ ${r.rating}` : ""}
                                    {r.user_ratings_total ? ` (${r.user_ratings_total.toLocaleString("pt-BR")})` : ""}
                                  </div>
                                )}
                              </div>
                            )}
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
      </fieldset>
    </Section>
  );
}

/**
 * Renomear uma categoria DESTE GUIA (auditoria das recomendações,
 * 24/09/2026). Troca só o rótulo dos pontos deste guia — nunca a taxonomia
 * global, que valia para todos os clientes (ver `renameGroup` no RecGroup).
 * Se o nome novo já existir no guia, os dois grupos viram um só.
 */
function InlineCategoryRename({
  currentLabel,
  onRename,
}: {
  currentLabel: string;
  onRename: (to: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentLabel);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(currentLabel);
  }, [currentLabel]);

  const cancel = () => {
    setEditing(false);
    setValue(currentLabel);
  };

  const commit = async (e?: React.SyntheticEvent) => {
    e?.stopPropagation?.();
    const next = value.trim();
    if (!next || next === currentLabel) {
      cancel();
      return;
    }
    try {
      setSaving(true);
      await onRename(next);
      toast.success(`Categoria renomeada para "${next}" neste guia`);
      setEditing(false);
    } catch (err) {
      toast.error(friendlyErrorMessage(err, "Não conseguimos renomear agora. Tente de novo."));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              void commit(e);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={saving}
          className="h-7 text-sm w-44"
          maxLength={60}
        />
        <button
          type="button"
          onClick={commit}
          disabled={saving}
          className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted text-emerald-600"
          aria-label="Salvar"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            cancel();
          }}
          className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Cancelar"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-sm font-medium truncate">{currentLabel}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted opacity-60 hover:opacity-100"
        aria-label="Renomear categoria"
        title="Renomear categoria (só neste guia)"
      >
        <Pencil className="size-3" />
      </button>
    </div>
  );
}

/** Excluir uma categoria DESTE GUIA: move os pontos para outra ou apaga os
 * pontos junto — nunca apaga a categoria da taxonomia global. */
function CategoryDeleteButton({
  currentLabel,
  targets,
  itemsInCategory,
  onMove,
  onDelete,
}: {
  currentLabel: string;
  targets: string[];
  itemsInCategory: number;
  onMove: (to: string) => Promise<void> | void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"move" | "delete">("move");
  const [targetLabel, setTargetLabel] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && !targetLabel && targets[0]) setTargetLabel(targets[0]);
  }, [open, targetLabel, targets]);

  const confirm = async () => {
    try {
      setSaving(true);
      if (mode === "move" && itemsInCategory > 0) {
        if (!targetLabel) {
          toast.error("Escolha uma categoria de destino.");
          return;
        }
        await onMove(targetLabel);
        toast.success(`Pontos movidos para "${targetLabel}"`);
      } else {
        onDelete();
        toast.success("Categoria e pontos excluídos deste guia");
      }
      setOpen(false);
    } catch (err) {
      toast.error(friendlyErrorMessage(err, "Não conseguimos excluir agora. Tente de novo."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-rose-500 hover:bg-muted opacity-60 hover:opacity-100"
        aria-label="Excluir categoria"
        title="Excluir categoria (só neste guia)"
      >
        <Trash2 className="size-3" />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a categoria "{currentLabel}" deste guia?</AlertDialogTitle>
            <AlertDialogDescription>
              {itemsInCategory > 0
                ? `Ela tem ${itemsInCategory} ponto(s). Escolha o que fazer com eles — os outros guias não são afetados.`
                : "Esta categoria não tem pontos neste guia."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {itemsInCategory > 0 && (
            <div className="space-y-3 py-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" checked={mode === "move"} onChange={() => setMode("move")} className="mt-1" />
                <div className="flex-1 space-y-1.5">
                  <div className="text-sm font-medium">Mover os pontos para outra categoria</div>
                  <Select value={targetLabel} onValueChange={setTargetLabel} disabled={mode !== "move"}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Escolha a categoria de destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((label) => (
                        <SelectItem key={label} value={label}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" checked={mode === "delete"} onChange={() => setMode("delete")} className="mt-1" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-rose-500">Excluir os pontos junto com a categoria</div>
                  <div className="text-[11px] text-muted-foreground">Esta ação não pode ser desfeita.</div>
                </div>
              </label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
              disabled={saving || (itemsInCategory > 0 && mode === "move" && !targetLabel)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
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
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
            <button
              type="button"
              onClick={() => onPick("fill")}
              className="group text-left ds-surface border border-border bg-card hover:border-primary/40 hover:bg-primary/[0.03] hover:shadow-sm transition-all p-4"
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className="grid place-items-center size-8 rounded-full bg-primary/10 text-primary shrink-0">
                  <Sparkles className="size-4" strokeWidth={1.75} />
                </span>
                <p className="text-sm font-semibold">Gerar apenas os excedentes</p>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-primary/80 font-medium">
                  Recomendado
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed pl-[42px]">
                Mantém todas as referências atuais e adiciona apenas pontos novos de alta qualidade, respeitando o
                limite máximo por categoria.
              </p>
            </button>
            <button
              type="button"
              onClick={() => onPick("replace")}
              className="group text-left ds-surface border border-border bg-card hover:border-destructive/40 hover:bg-destructive/[0.03] hover:shadow-sm transition-all p-4"
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
            <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type CaptureMode = "off" | "optional" | "required";

/** Conteúdo serializado de cada seção do editor — base da gravação cirúrgica. */
function sectionSnapshots(f: FormState): Record<string, string> {
  return {
    p: JSON.stringify(f.property),
    m: JSON.stringify(f.manual),
    e: JSON.stringify(f.emergency),
    f: JSON.stringify(f.faqs),
    c: JSON.stringify(f.checkout),
  };
}
