import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useGuidePreviewUrl } from "@/hooks/useGuidePreviewUrl";
import { useServerFn } from "@tanstack/react-start";
import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyProperty, upsertProperty, listMyProperties, transferPropertyOwner } from "@/lib/properties.functions";
import { missingRequiredHouseFields } from "@/lib/property-house-fields";

import { buildDefaultFaqs, mergeDefaultFaqs } from "@/lib/default-faqs";
import {
  enrichFromMapsLink,
  searchPlacesForRec,
  refreshRecommendationsFromGoogle,
  type PlaceSearchResult,
} from "@/lib/maps.functions";
import {
  generateCityReferences,
  listCityReferences,
  addManualCityReference,
  updateCityReference,
  bulkDeleteCityReferences,
} from "@/lib/city-references.functions";
import { listActivePropertyOwnersForSelect } from "@/lib/stakeholders.functions";
import { importFromAirbnb } from "@/lib/airbnb.functions";
import { syncPropertyAirbnbIcal, listPropertyReservations } from "@/lib/airbnb-ical.functions";
import { useSubscription } from "@/hooks/useSubscription";
import { useCityReferencesRealtime } from "@/hooks/useCityReferencesRealtime";
import { LinkGuidesButton } from "@/components/admin/LinkGuidesDialog";
import { POIMetricsBadge } from "@/components/POIMetricsBadge";
import { getPropertyPoiCounts, getMarketplaceClicks } from "@/lib/poi-engagement.functions";

import { Input } from "@/components/ui/input";
import { MoneyInput, centsToReaisInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import { TagMentionTextarea, type TagMentionItem } from "@/components/tags/TagMentionTextarea";
import { slugForTag } from "@/lib/guide-tags";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Section, SectionGroup, DenseSections } from "@/components/editor/Section";
import { Stepper, GUIDE_STEPS, NON_HOUSE_STEPS } from "@/components/editor/Stepper";
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
  KeyRound,
  Home,
  Compass,
  LifeBuoy,
  Check,
  Eye,
  Image as ImageIcon,
  ImagePlus,
  MapPinned,
  Clock,
  DoorOpen,
  Wifi,
  UserRound,
  BookOpen,
  ClipboardCheck,
  Shield,
  Power,
  Phone,
  HelpCircle,
  Sun,
  Moon,
  Lock,
  MessageSquare,
  LogOut,
  ChevronDown,
  Ticket,
  RefreshCw,
  Copy,
  Share2,
  X,
  MoveRight,
  ClipboardList,
  Car,
  IdCard,
  NotebookPen,
  ArrowLeftRight,
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
import { ImageUpload } from "@/components/ImageUpload";
import { MediaUpload, type MediaItem } from "@/components/MediaUpload";
import { EtiquetaSelect, ETIQUETA_OPTIONS } from "@/components/EtiquetaSelect";
import { ETIQUETA_CHECKIN_CHECKOUT } from "@/lib/publish-requirements";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
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
import { TimePicker } from "@/components/ui/time-picker";
import { DateTimePicker } from "@/components/ui/date-picker";
import {
  TagPicker,
  useTaxonomy,
  TAXONOMY_QUERY_KEY,
  NewCategoryDialog,
  NewTagDialog,
} from "@/components/admin/TagPicker";
import { updatePoiCategory, reorderPoiCategories, deletePoiCategory } from "@/lib/poi-taxonomy.functions";
import {
  PropertyDetailsEditor,
  DetailImages,
  usePrefetchPropertyDetails,
} from "@/components/admin/PropertyDetailsEditor";
import { PropertyTypeSelect } from "@/components/admin/PropertyTypeSelect";
import { usePresence } from "@/hooks/usePresence";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";
import { PresenceAvatars } from "@/components/presence/PresenceAvatars";
import { FieldTypingBadge } from "@/components/presence/FieldTypingBadge";
import { Pencil, Check as CheckIcon, X as XIcon, Search, Settings2 } from "lucide-react";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { SigmaImportButton, SigmaActiveBanner, SaveAsSigmaPackButton } from "@/components/admin/SigmaImportButton";
import { getMyPropertySigmaState } from "@/lib/sigma-recommendations.functions";
import { supabase } from "@/integrations/supabase/client";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useAccess } from "@/lib/permissions/useAccess";
import { PageHeader } from "@/components/ds/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/properties/$id")({
  // `houseOnly`: abre direto (e trava) na aba "A casa", sem a barra de abas —
  // usado pelo botão "Editar" do imóvel dentro do proprietário em
  // Stakeholders, que precisa espelhar exatamente esta mesma aba, sem
  // duplicar seus campos em outra tela. `returnTo`: para onde volta o link
  // "Voltar"/"Fechar" — sem ele, cai no padrão (/admin/guias).
  validateSearch: (s: Record<string, unknown>): { houseOnly?: boolean; returnTo?: string; ownerId?: string } => ({
    ...(s.houseOnly === true ? { houseOnly: true as const } : {}),
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
      tagline: "",
      hero_image_url: "",
      gallery_images: [],
      theme_images: { checkin: "", residencia: "", faq: "", explore: "" },
      marketplace_links: [],
      address: "",
      maps_url: "",
      garage_maps_url: "",
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

function isEtiqueta(value: string) {
  return (ETIQUETA_OPTIONS as readonly string[]).includes(value);
}

// missingRequiredHouseFields agora vive em "@/lib/property-house-fields" —
// compartilhada também com o link "Editar" do imóvel dentro do Proprietário
// em Stakeholders (que abre esta mesma página, em modo `houseOnly`), para as
// duas entradas nunca mais divergirem sobre quais campos são obrigatórios.

function PropertyEditor() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const search = Route.useSearch();
  // Modo "só a casa": usado quando se chega aqui pelo botão "Editar" de um
  // imóvel já com guia criado, dentro do Proprietário em Stakeholders — trava
  // na aba "A casa" e nunca mostra a barra de abas (mesma regra pedida para
  // "Criar nova residência", que já cai na tela enxuta abaixo).
  const houseOnly = search.houseOnly === true;
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
      onRemoteChange: () => {
        if (dirtyRef.current) {
          toast.info(
            "Outra pessoa atualizou este imóvel. Salve suas alterações para não perder nada, depois atualize a página para ver as mudanças dela.",
          );
        }
      },
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
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(null);

  const importAirbnb = useServerFn(importFromAirbnb);
  const syncIcal = useServerFn(syncPropertyAirbnbIcal);
  const listReservations = useServerFn(listPropertyReservations);
  const [syncingIcal, setSyncingIcal] = useState(false);

  const [pendingIcalClear, setPendingIcalClear] = useState(false);
  const [showIcal2, setShowIcal2] = useState(false);
  const reservationsQuery = useQuery({
    queryKey: ["airbnb-reservations", id],
    queryFn: () => listReservations({ data: { propertyId: id } }),
    enabled: !isNew,
    refetchInterval: 60_000,
  });
  const { info: sub } = useSubscription();
  const canAirbnb = sub.features.autoImport;
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

  // Transferência deliberada de proprietário — uma vez vinculado, o campo
  // "Proprietário" fica travado (não é mais um <Select> livre) e só pode
  // mudar através deste fluxo dedicado, com confirmação explícita.
  const transferOwnerFn = useServerFn(transferPropertyOwner);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState<string>("");
  const [transferring, setTransferring] = useState(false);
  async function handleConfirmTransfer() {
    if (!transferTargetId || isNew) return;
    setTransferring(true);
    try {
      await transferOwnerFn({ data: { propertyId: id, newOwnerContactId: transferTargetId } });
      update("owner_contact_id", transferTargetId);
      await queryClient.invalidateQueries({ queryKey: ["properties"] });
      toast.success("Proprietário transferido com sucesso.");
      setTransferOpen(false);
      setTransferTargetId("");
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Não foi possível transferir o proprietário."));
    } finally {
      setTransferring(false);
    }
  }

  const [form, setForm] = useState<FormState>(() => {
    const base = emptyForm();
    if (isNew && search.ownerId) base.property.owner_contact_id = search.ownerId;
    return base;
  });
  // Veio de dentro de um proprietário específico ("Criar nova residência") —
  // o campo Proprietário nasce preenchido e travado, sem opção de trocar
  // aqui (ver renderOwnerFields()).
  const ownerLockedFromContext = isNew && !!search.ownerId;
  const currentOwnerName = propertyOwnerOptions.find((o) => o.id === form.property.owner_contact_id)?.name;
  const formRef = useRef(form);
  formRef.current = form;

  const editVersionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hydratedRef = useRef(false);
  const suppressHydrationAutosaveRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRecsRef = useRef<string>("");
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
  const [step, setStepRaw] = useState<string>(() => {
    if (typeof window === "undefined") return "house";
    const raw = window.location.hash.replace("#tab-", "");
    const valid = ["house", "guide", "checkin", "checkout", "faq", "recs"];
    return valid.includes(raw) ? raw : "house";
  });
  const setStep = React.useCallback((s: string) => {
    setStepRaw(s);
    if (typeof window !== "undefined") {
      try {
        window.history.replaceState(null, "", `#tab-${s}`);
      } catch {}
    }
  }, []);
  const [enriching, setEnriching] = useState(false);
  const enrichedUrlRef = useRef<string | null>(null);
  const [generatingCityRecs, setGeneratingCityRecs] = useState(false);
  const [saving, setSaving] = useState(false);
  // Itens para o picker @mention (FAQs do imóvel; recomendações são carregadas em outro fluxo).
  const tagItems = React.useMemo<TagMentionItem[]>(() => {
    const out: TagMentionItem[] = [];
    const seen = new Set<string>();
    for (const f of form.faqs) {
      const q = (f.question ?? "").trim();
      if (!q) continue;
      const base = slugForTag(q);
      if (!base) continue;
      let s = base;
      let n = 1;
      while (seen.has(s)) s = `${base}-${++n}`;
      seen.add(s);
      out.push({ key: "faq", param: s, label: q.length > 80 ? q.slice(0, 77) + "…" : q, hint: "FAQ deste guia" });
    }
    return out;
  }, [form.faqs]);
  const [airbnbUrl, setAirbnbUrl] = useState("");
  // Rehidrata o campo do anúncio a partir do que ficou salvo no imóvel.
  useEffect(() => {
    const saved = form.property.airbnb_listing_url;
    if (saved && !airbnbUrl) setAirbnbUrl(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.property.airbnb_listing_url]);
  const [importingAirbnb, setImportingAirbnb] = useState(false);
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
      lastSavedRecsRef.current = JSON.stringify(
        (data.recommendations ?? []).filter((r: Record<string, unknown>) => r.scope === "nearby"),
      );
    }, 0);
  }, [data, isNew]);

  // Marca se há edição local ainda não salva — usado pra decidir se uma
  // atualização em tempo real vinda de outra pessoa pode recarregar a tela
  // com segurança, ou se isso apagaria o que você está digitando agora.
  const dirtyRef = useRef(false);

  function update<K extends keyof FormState["property"]>(key: K, value: FormState["property"][K]) {
    editVersionRef.current += 1;
    dirtyRef.current = true;
    setForm((f) => ({ ...f, property: { ...f.property, [key]: value } }));
  }

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

  const [generatingNearbyRecs, setGeneratingNearbyRecs] = useState(false);
  async function handleGenerateNearby() {
    if (!form.property.maps_url) {
      toast.error("Cole o link do Google Maps do imóvel antes de gerar.");
      return;
    }
    setGeneratingNearbyRecs(true);
    try {
      const r = await enrich({ data: { mapsUrl: form.property.maps_url, propertyId: id !== "new" ? id : undefined } });
      if (r.recommendations_skipped) {
        toast.info(r.skip_reason ?? "Recomendações vinculadas: nada novo foi inserido.");
        return;
      }
      const existing = new Set(form.recommendations.map((x) => x.place_id).filter((x): x is string => !!x));
      const incoming = r.recommendations
        .filter((rec) => rec.scope === "nearby")
        .filter((rec) => (rec.distance_meters ?? 0) <= 2000)
        .filter((rec) => !rec.place_id || !existing.has(rec.place_id))

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
        }));
      if (incoming.length === 0) {
        toast.info("Nenhum lugar novo encontrado pertinho do imóvel.");
      } else {
        setForm((f) => ({ ...f, recommendations: [...f.recommendations, ...incoming] }));
        toast.success(
          `Adicionamos ${incoming.length} ${incoming.length === 1 ? "lugar novo" : "lugares novos"} em "Aqui pertinho".`,
        );
      }
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Não conseguimos gerar lugares pertinho. Tente novamente."));
    } finally {
      setGeneratingNearbyRecs(false);
    }
  }

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
              ...r.recommendations
                .filter((rec) => rec.scope === "nearby" && (rec.distance_meters ?? 0) <= 2000)
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
      toast.error(e instanceof Error ? e.message : "Erro ao enriquecer");
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
      toast.error("Preencha a cidade antes de gerar recomendações.");
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
      const r = await importAirbnb({ data: { url: airbnbUrl.trim(), propertyId: id } });
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
          airbnb_listing_url: airbnbUrl.trim(),
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

  async function handleSyncIcal() {
    if (isNew) {
      toast.error("Salve o imóvel antes de sincronizar.");
      return;
    }
    const url = form.property.airbnb_ical_url?.trim();
    if (!url) {
      toast.error("Cole a URL do calendário Airbnb antes.");
      return;
    }
    if (autoSaving) {
      toast.info("Aguarde salvar as alterações.");
      return;
    }
    const wasFirstActivation = !form.property.airbnb_ical_last_sync_at;
    setSyncingIcal(true);
    try {
      const r = await syncIcal({
        data: { propertyId: id, icalUrl: url, icalUrl2: form.property.airbnb_ical_url_2?.trim() || null },
      });
      const parts: string[] = [];
      if (r.imported) parts.push(`${r.imported} nova(s)`);
      if (r.updated) parts.push(`${r.updated} atualizada(s)`);
      if (r.removed) parts.push(`${r.removed} removida(s)`);
      toast.success(parts.length ? `Sincronizado: ${parts.join(" · ")}` : "Sincronizado — nenhuma mudança.");
      await reservationsQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["property", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar");
    } finally {
      setSyncingIcal(false);
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
      const missing = missingRequiredHouseFields(formToSave.property);
      if (missing.length > 0) {
        toast.error(`Preencha antes de salvar: ${missing.join(", ")}.`);
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
      const payload = {
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
          require_access_gate:
            propertySource.tagline === ETIQUETA_CHECKIN_CHECKOUT ? true : propertySource.require_access_gate,
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
      const msg = e instanceof Error ? e.message : "Erro ao salvar";
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
    if (!hydratedRef.current || isNew || step !== "recs" || saving || readOnly) return;
    const nearby = form.recommendations.filter((r) => r.scope === "nearby");
    const snapshot = JSON.stringify(nearby);
    if (snapshot === lastSavedRecsRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        setAutoSaving(true);
        const galleryImages = form.property.gallery_images.filter((u) => u.trim()).slice(0, 4);
        const payload = {
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
        setAutoSaveError(e instanceof Error ? e.message : "Erro ao salvar");
      } finally {
        setAutoSaving(false);
      }
    }, 800);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.recommendations, step, isNew]);

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
    }, 350);
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

  // Trava: "sem imóvel [completo, vinculado a um proprietário], sem guia".
  // Cobre também imóveis já existentes (de antes desta regra) que ficaram sem
  // proprietário e/ou sem os dados básicos obrigatórios (tipo, endereço
  // completo, calendário Airbnb) — bloqueia qualquer edição, mesmo de um guia
  // já publicado, até completar. Só se aplica depois que o guia já foi criado
  // (`guide_created`): antes disso, é a própria tela enxuta "Novo imóvel" que
  // já pede e valida esses mesmos campos.
  const missingOwner = !isNew && !form.property.owner_contact_id;
  const missingHouseFields = form.property.guide_created ? missingRequiredHouseFields(form.property) : [];
  const allMissingRequiredFields = [...(missingOwner ? ["Proprietário"] : []), ...missingHouseFields];
  const needsRequiredHouseInfo =
    !isNew && form.property.guide_created && (missingOwner || missingHouseFields.length > 0);

  // Mesmo motivo do comentário de useGuidePreviewUrl acima: hooks não podem
  // ser condicionais. Este useEffect ficava depois do early-return de
  // isLoading logo abaixo e reproduzia o MESMO bug ("Rendered more hooks than
  // during the previous render") na 1ª abertura de "Editar guia" — só
  // funcionava depois de "Tentar de novo" porque a 2ª tentativa já reaproveita
  // os dados em cache e nunca passa pelo estado isLoading=true.
  useEffect(() => {
    if ((needsRequiredHouseInfo || houseOnly) && step !== "house") {
      setStep("house");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRequiredHouseInfo, houseOnly, step]);

  if (!isNew && isLoading) {
    return <div className="max-w-4xl mx-auto px-6 py-10 text-sm text-muted-foreground">Carregando…</div>;
  }

  const nearbyRecs = form.recommendations.filter((r) => r.scope === "nearby");

  // Extraídos como funções para serem reaproveitados tanto na tela enxuta de
  // criação do imóvel (isNew) quanto na aba "A casa" do editor completo —
  // mesmo JSX, duas telas, sem duplicar campos/handlers.
  // Idem: só o conteúdo, sem <Section> — mesma razão do renderOwnerFields.
  const renderPropertyTypeFields = () => (
    <PropertyTypeSelect value={form.property.property_type_id} onChange={(v) => update("property_type_id", v)} />
  );

  // Quadrante "Identificação do Imóvel": Proprietário + Tipo do imóvel —
  // antes eram dois cards separados; unificados a pedido num só.
  const renderIdentitySection = () => (
    <Section
      id="identity"
      icon={Home}
      title="Identificação do Imóvel"
      desc="Proprietário e tipo do imóvel."
      collapsible
    >
      {renderOwnerFields()}
      {renderPropertyTypeFields()}
    </Section>
  );

  // Quadrante EXCLUSIVO de limpeza: valores fixos (R$, armazenados em
  // centavos — mesma convenção de dinheiro já usada em prestadores de
  // serviço via hourly_rate_cents) + período estimado (minutos, múltiplos de
  // 30). Separado da Identificação do imóvel a pedido. Os helpers de
  // formatação/parsing agora vivem em <MoneyInput> (components/ui/money-input)
  // — digitação livre, sem reformatar a cada tecla (ver comentário lá).
  // 30min, 1h, 1h30 ... até 8h — cobre da limpeza rápida à faxina completa de
  // uma casa grande, sempre em passos de meia hora.
  const CLEANING_DURATION_OPTIONS = Array.from({ length: 16 }, (_, i) => {
    const minutes = (i + 1) * 30;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const label = h === 0 ? `${m}min` : m === 0 ? `${h}h` : `${h}h${m}`;
    return { value: minutes, label };
  });
  const renderCleaningSection = () => (
    <Section
      id="cleaning"
      icon={Sparkles}
      title="Custos e Duração da Limpeza"
      desc="Valores fixos cobrados e o período estimado de cada tipo de limpeza deste imóvel."
      collapsible
    >
      {/* Cada tipo de limpeza (normal / completa) tem seu próprio prazo —
          uma limpeza completa costuma levar mais tempo que uma normal, então
          o valor e o prazo de cada tipo ficam agrupados lado a lado. No
          desktop os 2 grupos ficam um ao lado do outro pra economizar
          espaço; no mobile cada grupo ocupa sua própria linha. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-[0.3rem] border border-border/60 bg-background/40 p-3">
          <p className="mb-2.5 text-xs font-medium text-foreground/70">Limpeza normal</p>
          {/* items-start (não stretch) + hintClassName nos dois Fields: sem
              isso, a legenda de 2 linhas de "Valor (R$)" empurrava o campo
              de valor mais pra baixo que o dropdown de "Prazo estimado"
              (legenda de 1 linha só) — título alinhava com título, mas o
              campo preenchível de cada um ficava numa altura diferente. */}
          <div className="grid grid-cols-2 gap-3 items-start">
            <div className="min-w-0">
              <Field
                label="Valor (R$)"
                hint="Valor fixo cobrado por uma limpeza normal deste imóvel."
                hintClassName="min-h-[30px]"
              >
                <MoneyInput
                  cents={form.property.cleaning_price_normal_cents}
                  onChange={(c) => {
                    update("cleaning_price_normal_cents", c);
                    presence.broadcastTyping("cleaning_price_normal_cents", centsToReaisInput(c));
                  }}
                  onBlur={() => presence.broadcastFieldBlur("cleaning_price_normal_cents")}
                />
              </Field>
              <FieldTypingBadge typing={presence.typing["cleaning_price_normal_cents"]} />
            </div>
            <div className="min-w-0">
              <Field label="Prazo estimado" hint="Em intervalos de 30 minutos." hintClassName="min-h-[30px]">
                <Select
                  value={
                    form.property.cleaning_duration_normal_minutes != null
                      ? String(form.property.cleaning_duration_normal_minutes)
                      : ""
                  }
                  onValueChange={(v) => {
                    update("cleaning_duration_normal_minutes", v ? Number(v) : null);
                    const opt = CLEANING_DURATION_OPTIONS.find((o) => String(o.value) === v);
                    presence.broadcastTyping("cleaning_duration_normal_minutes", opt?.label ?? "");
                  }}
                  onOpenChange={(open) => !open && presence.broadcastFieldBlur("cleaning_duration_normal_minutes")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  {/* Grade de 4 colunas em vez de lista longa — as 16 opções
                      (30min a 8h) cabem inteiras sem rolagem, muito mais rápido
                      de escanear do que uma lista vertical de 16 linhas. */}
                  <SelectContent>
                    <div className="grid grid-cols-4 gap-1 p-1">
                      {CLEANING_DURATION_OPTIONS.map((o) => (
                        <SelectItem
                          key={o.value}
                          value={String(o.value)}
                          className="justify-center rounded-md px-2 py-1.5 text-center tabular-nums"
                        >
                          {o.label}
                        </SelectItem>
                      ))}
                    </div>
                  </SelectContent>
                </Select>
              </Field>
              <FieldTypingBadge typing={presence.typing["cleaning_duration_normal_minutes"]} />
            </div>
          </div>
        </div>
        <div className="rounded-[0.3rem] border border-border/60 bg-background/40 p-3">
          <p className="mb-2.5 text-xs font-medium text-foreground/70">Limpeza completa</p>
          <div className="grid grid-cols-2 gap-3 items-start">
            <div className="min-w-0">
              <Field
                label="Valor (R$)"
                hint="Valor fixo cobrado por uma limpeza completa deste imóvel."
                hintClassName="min-h-[30px]"
              >
                <MoneyInput
                  cents={form.property.cleaning_price_full_cents}
                  onChange={(c) => {
                    update("cleaning_price_full_cents", c);
                    presence.broadcastTyping("cleaning_price_full_cents", centsToReaisInput(c));
                  }}
                  onBlur={() => presence.broadcastFieldBlur("cleaning_price_full_cents")}
                />
              </Field>
              <FieldTypingBadge typing={presence.typing["cleaning_price_full_cents"]} />
            </div>
            <div className="min-w-0">
              <Field label="Prazo estimado" hint="Em intervalos de 30 minutos." hintClassName="min-h-[30px]">
                <Select
                  value={
                    form.property.cleaning_duration_full_minutes != null
                      ? String(form.property.cleaning_duration_full_minutes)
                      : ""
                  }
                  onValueChange={(v) => {
                    update("cleaning_duration_full_minutes", v ? Number(v) : null);
                    const opt = CLEANING_DURATION_OPTIONS.find((o) => String(o.value) === v);
                    presence.broadcastTyping("cleaning_duration_full_minutes", opt?.label ?? "");
                  }}
                  onOpenChange={(open) => !open && presence.broadcastFieldBlur("cleaning_duration_full_minutes")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="grid grid-cols-4 gap-1 p-1">
                      {CLEANING_DURATION_OPTIONS.map((o) => (
                        <SelectItem
                          key={o.value}
                          value={String(o.value)}
                          className="justify-center rounded-md px-2 py-1.5 text-center tabular-nums"
                        >
                          {o.label}
                        </SelectItem>
                      ))}
                    </div>
                  </SelectContent>
                </Select>
              </Field>
              <FieldTypingBadge typing={presence.typing["cleaning_duration_full_minutes"]} />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );

  const renderAddressSection = () => (
    <Section
      id="address"
      icon={MapPinned}
      title="Endereço e localização"
      desc="Cole o link do Google Maps — o endereço é preenchido automaticamente."
      collapsible
    >
      <Field label="Link do Google Maps — Entrada principal" required>
        <Input
          value={form.property.maps_url}
          onChange={(e) => update("maps_url", e.target.value)}
          placeholder="https://maps.app.goo.gl/..."
        />
        {enriching && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Buscando endereço…
          </p>
        )}
      </Field>
      <Field
        label="Link do Google Maps — Garagem (opcional)"
        hint="Aparece como um segundo botão de localização no guia."
      >
        <Input
          value={form.property.garage_maps_url}
          onChange={(e) => update("garage_maps_url", e.target.value)}
          placeholder="https://maps.app.goo.gl/..."
        />
      </Field>
      <Field label="Endereço" required>
        <Input value={form.property.address} onChange={(e) => update("address", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cidade" required>
          <Input value={form.property.city} onChange={(e) => update("city", e.target.value)} />
        </Field>
        <Field label="País" required>
          <Input value={form.property.country} onChange={(e) => update("country", e.target.value)} />
        </Field>
      </div>
      <Field label="Observação sobre o endereço" hint="Ponto de referência, instruções para o motorista, etc.">
        <Textarea
          value={form.property.address_note}
          maxLength={1000}
          onChange={(e) => update("address_note", e.target.value)}
        />
      </Field>
    </Section>
  );

  const renderAirbnbCalendarSection = () => (
    <Section
      id="airbnb-calendar"
      icon={RefreshCw}
      title="Calendário do Airbnb"
      desc="Sincronize para habilitar dashboard, calendário e kanban — funciona mesmo sem publicar um guia."
      collapsible
    >
      {isNew && (
        <div className="mb-3 ds-surface border border-border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
          <Clock className="size-3.5 shrink-0 mt-0.5" />
          <span>
            Salve o imóvel uma vez (botão "Salvar" abaixo) para liberar a sincronização — não precisa preencher o guia.
          </span>
        </div>
      )}

      <Field
        label="URL do calendário Airbnb"
        required
        hint={
          form.property.tagline === ETIQUETA_CHECKIN_CHECKOUT
            ? "Obrigatório para criar o imóvel e para publicar guias do tipo Check-In & Check-Out. No Airbnb: Anúncio → Calendário → Disponibilidade → Exportar calendário. Sincroniza a cada 30 minutos."
            : "Obrigatório para criar o imóvel. No Airbnb: Anúncio → Calendário → Disponibilidade → Exportar calendário. Sincroniza a cada 30 minutos."
        }
      >
        <div className="flex gap-2">
          <Input
            value={form.property.airbnb_ical_url ?? ""}
            onChange={(e) => {
              const next = e.target.value.trim() || null;
              const prev = form.property.airbnb_ical_url;
              if (!next && prev) {
                setPendingIcalClear(true);
                return;
              }
              update("airbnb_ical_url", next);
              presence.broadcastTyping("airbnb_ical_url", e.target.value);
            }}
            onBlur={() => presence.broadcastFieldBlur("airbnb_ical_url")}
            placeholder="https://www.airbnb.com/calendar/ical/12345.ics?s=..."
          />
          <Button
            onClick={handleSyncIcal}
            disabled={syncingIcal || isNew || !(form.property.airbnb_ical_url ?? "").trim()}
            variant="secondary"
            className="shrink-0"
            title={isNew ? "Salve o imóvel antes de sincronizar" : "Sincronizar agora"}
          >
            {syncingIcal ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span className="ml-1.5 hidden sm:inline">{syncingIcal ? "Sincronizando…" : "Sincronizar"}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            disabled={!(form.property.airbnb_ical_url ?? "").trim()}
            onClick={() => setPendingIcalClear(true)}
            title="Remover calendário"
            aria-label="Remover calendário"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        <FieldTypingBadge typing={presence.typing["airbnb_ical_url"]} />
      </Field>

      {showIcal2 || (form.property.airbnb_ical_url_2 ?? "").trim() ? (
        <Field
          label="2º calendário (outro anúncio do mesmo imóvel)"
          hint="Use quando o imóvel tem mais de um anúncio no Airbnb. As reservas dos dois calendários são unificadas."
        >
          <div className="flex gap-2">
            <Input
              value={form.property.airbnb_ical_url_2 ?? ""}
              onChange={(e) => update("airbnb_ical_url_2", e.target.value.trim() || null)}
              placeholder="https://www.airbnb.com/calendar/ical/67890.ics?s=..."
            />
            <Button
              onClick={handleSyncIcal}
              disabled={syncingIcal || isNew || !(form.property.airbnb_ical_url_2 ?? "").trim()}
              variant="secondary"
              className="shrink-0"
              title={isNew ? "Salve o imóvel antes de sincronizar" : "Sincronizar agora"}
            >
              {syncingIcal ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              <span className="ml-1.5 hidden sm:inline">{syncingIcal ? "Sincronizando…" : "Sincronizar"}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => {
                update("airbnb_ical_url_2", null);
                setShowIcal2(false);
              }}
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

      {(form.property.airbnb_ical_last_sync_at || form.property.airbnb_ical_last_error) && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
          {form.property.airbnb_ical_last_sync_at && (
            <span>
              Última sincronização: {new Date(form.property.airbnb_ical_last_sync_at).toLocaleString("pt-BR")}
            </span>
          )}
          {form.property.airbnb_ical_last_error && (
            <span className="text-destructive">Erro: {form.property.airbnb_ical_last_error}</span>
          )}
        </div>
      )}

      {reservationsQuery.data?.reservations && reservationsQuery.data.reservations.length > 0 && (
        <details className="group ds-surface border border-border bg-muted/30">
          <summary className="list-none cursor-pointer select-none px-3 py-2.5 flex items-center justify-between text-xs font-semibold">
            <span>Próximas reservas ({reservationsQuery.data.reservations.length})</span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <ul className="px-3 pb-3 space-y-1.5 max-h-56 overflow-y-auto">
            {reservationsQuery.data.reservations.map((r) => (
              <li
                key={r.id}
                className="text-xs flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0"
              >
                <span className="font-medium">
                  {new Date(`${r.checkin_date}T12:00:00`).toLocaleDateString("pt-BR")} →{" "}
                  {new Date(`${r.checkout_date}T12:00:00`).toLocaleDateString("pt-BR")}
                </span>
                {r.guest_hint && <span className="text-muted-foreground font-mono text-[10px]">{r.guest_hint}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );

  const renderHostContactSection = () => (
    <Section
      id="host-house"
      icon={UserRound}
      title="Contato do anfitrião"
      desc="Nome e WhatsApp para o hóspede te encontrar."
      collapsible
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome">
          <Input
            value={form.property.host_name}
            maxLength={120}
            onChange={(e) => update("host_name", e.target.value)}
          />
        </Field>
        <Field label="Telefone (WhatsApp)">
          <Input
            value={form.property.host_phone}
            maxLength={40}
            onChange={(e) => update("host_phone", e.target.value)}
          />
        </Field>
      </div>
    </Section>
  );

  // Proprietário (property_owners) — regra: sem imóvel vinculado a um
  // proprietário cadastrado, sem guia. Compartilhado entre a tela "Novo
  // imóvel", a trava de informações pendentes e a aba "A casa". Retorna só o
  // CONTEÚDO (sem <Section> em volta) — quem chama decide como agrupar: nas
  // telas "Novo imóvel"/trava continua em sua própria seção; na aba "A casa"
  // entra junto com Tipo do imóvel no quadrante "Identificação e Custos de
  // Limpeza".
  const renderOwnerFields = () => {
    const hasOwner = (!isNew && !!form.property.owner_contact_id) || ownerLockedFromContext;
    return (
      <>
        {hasOwner ? (
          <Field label="Proprietário">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-sm min-w-0">
                <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{currentOwnerName ?? "Proprietário vinculado"}</span>
              </span>
              {/* "Transferir" só existe para um imóvel já salvo — em
                      "Novo imóvel" vindo de dentro do proprietário, o campo
                      só está travado porque já se sabe o dono; não há o que
                      transferir ainda. */}
              {!isNew && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={readOnly}
                  onClick={() => {
                    setTransferTargetId("");
                    setTransferOpen(true);
                  }}
                >
                  <ArrowLeftRight className="size-3.5 mr-1.5" /> Transferir
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {isNew
                ? "Este imóvel está sendo criado a partir do proprietário selecionado."
                : 'O proprietário só pode ser alterado através do botão "Transferir", com confirmação.'}
            </p>
          </Field>
        ) : (
          <Field label="Proprietário" required>
            <Select
              value={form.property.owner_contact_id ?? ""}
              onValueChange={(v) => update("owner_contact_id", v || null)}
              disabled={ownersLoading || propertyOwnerOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={ownersLoading ? "Carregando…" : "Selecione um proprietário"} />
              </SelectTrigger>
              <SelectContent>
                {propertyOwnerOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {propertyOwnerOptions.length === 0 && !ownersLoading && (
              <p className="mt-1.5 text-xs text-amber-500">
                Nenhum proprietário cadastrado.{" "}
                <Link
                  to="/admin/stakeholders"
                  search={{ tab: "proprietarios" as const }}
                  className="underline underline-offset-2"
                >
                  Cadastre um em Stakeholders
                </Link>{" "}
                antes de continuar.
              </p>
            )}
          </Field>
        )}
        <Dialog
          open={transferOpen}
          onOpenChange={(o) => {
            if (!transferring) setTransferOpen(o);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Transferir proprietário</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Escolha o novo proprietário para <strong>{form.property.name || "este imóvel"}</strong>. O proprietário
              atual ({currentOwnerName ?? "vinculado"}) perde o vínculo com este imóvel.
            </p>
            <Select
              value={transferTargetId}
              onValueChange={setTransferTargetId}
              disabled={ownersLoading || transferring}
            >
              <SelectTrigger>
                <SelectValue placeholder={ownersLoading ? "Carregando…" : "Selecione o novo proprietário"} />
              </SelectTrigger>
              <SelectContent>
                {propertyOwnerOptions
                  .filter((o) => o.id !== form.property.owner_contact_id)
                  .map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" disabled={transferring} onClick={() => setTransferOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={!transferTargetId || transferring} onClick={handleConfirmTransfer}>
                {transferring ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                Confirmar transferência
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  };

  const renderHouseRulesSection = () => (
    <Section
      id="house-rules"
      icon={ClipboardCheck}
      title="Regras do espaço"
      desc="Uma regra por linha — cada linha vira um item numerado no guia."
      collapsible
    >
      <Field label="Regras (opcional)" hint="Uma regra por linha. Linhas em branco são ignoradas.">
        <TagMentionTextarea
          items={tagItems}
          value={form.property.house_rules}
          maxLength={3000}
          rows={6}
          onChange={(e) => update("house_rules", e.target.value)}
          placeholder={
            "Não é permitido fumar dentro do imóvel.\nFestas e eventos não são permitidos.\nRespeite o silêncio das 22h às 8h."
          }
        />
      </Field>
    </Section>
  );

  const renderManualSection = () => (
    <Section
      id="manual"
      icon={BookOpen}
      title="Manual da casa"
      desc="Instruções de equipamentos e funcionamento."
      collapsible
    >
      {isNew ? (
        <EmptyHint text="Salve o imóvel primeiro para adicionar itens do manual (as fotos precisam de um imóvel já salvo)." />
      ) : (
        <>
          {form.manual.length === 0 ? (
            <EmptyHint text="Nenhum item ainda. Adicione instruções para ar-condicionado, TV, fechadura, etc." />
          ) : (
            form.manual.map((m, i) => (
              <ItemCard key={i} onRemove={() => setForm((f) => ({ ...f, manual: f.manual.filter((_, j) => j !== i) }))}>
                <Input
                  placeholder="Título (ex: Ar-condicionado)"
                  value={m.title}
                  maxLength={120}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      manual: f.manual.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                    }))
                  }
                />
                <Input
                  placeholder="Descrição curta"
                  value={m.description}
                  maxLength={300}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      manual: f.manual.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                    }))
                  }
                />
                <TagMentionTextarea
                  items={tagItems}
                  placeholder="Instruções detalhadas"
                  value={m.body}
                  maxLength={4000}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      manual: f.manual.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)),
                    }))
                  }
                />
                <ManualItemImages
                  images={m.images}
                  propertyId={id}
                  onChange={(next) =>
                    setForm((f) => ({ ...f, manual: f.manual.map((x, j) => (j === i ? { ...x, images: next } : x)) }))
                  }
                />
              </ItemCard>
            ))
          )}
          <div className="pt-1">
            <AddBtn
              onClick={() =>
                setForm((f) => ({ ...f, manual: [...f.manual, { title: "", description: "", body: "", images: [] }] }))
              }
            />
          </div>
        </>
      )}
    </Section>
  );

  const renderPropertyDetailsSection = () => (
    <Section
      id="property-details"
      icon={NotebookPen}
      title="Detalhamento do Imóvel"
      desc="Base de conhecimento livre: micro detalhes que a IA usa e que não aparecem no guia."
      collapsible
    >
      {isNew ? (
        <EmptyHint text="Salve o imóvel primeiro para começar o detalhamento." />
      ) : (
        <PropertyDetailsEditor propertyId={id} presence={presence} />
      )}
    </Section>
  );

  // ================= INFORMAÇÕES DO IMÓVEL =================
  // Antes, um imóvel novo abria direto os 6 steps inteiros do editor de guia
  // (A casa, O guia, Checkin, Checkout, FAQ & Contatos, Recomendações) — a
  // maioria deles sem sentido nenhum antes de existir um guia de verdade.
  //
  // IMPORTANTE: a condição não é mais só "isNew" (que é temporário — vira
  // false assim que salva uma vez). Agora depende de `guide_created`, uma
  // coluna persistida em "properties". Ou seja: mesmo depois de criado e
  // salvo várias vezes, um imóvel sem guia continua caindo nesta tela enxuta
  // sempre que for aberto — até o anfitrião clicar em "Criar guia" de
  // propósito. Os campos aqui (nome, tipo, endereço, calendário, contato) são
  // os MESMOS da aba "A casa" do editor completo (mesmo form.property, mesmas
  // funções render*Section) — não existem em duplicidade, então qualquer
  // alteração feita aqui ou lá é a mesma informação, sempre.
  // Antes, este bloco tinha um `return` aqui com uma tela separada ("Complete
  // as informações do imóvel"), com um layout completamente diferente do
  // editor completo (sem Stepper, sem Acessos/Conversas, sem rodapé de
  // autosave). Isso fazia "Editar guia" de um imóvel com pendências parecer
  // outro sistema. Mantemos a MESMA trava (ninguém edita o guia sem antes
  // completar Proprietário/Tipo/Endereço/Calendário) mas replicando o visual:
  // a pessoa cai na mesma tela do editor completo, só que travada na aba
  // "A casa" (as outras 5 abas ficam visíveis porém bloqueadas, com cadeado)
  // até os campos obrigatórios serem preenchidos. Ver `missingOwner` /
  // `needsRequiredHouseInfo` e o useEffect que força a aba, calculados mais
  // acima (antes do early-return de carregamento) — e a prop `lockedValues`
  // do <Stepper>.

  const showLeanInfoScreen = isNew || !form.property.guide_created;

  if (showLeanInfoScreen) {
    // Sem exceção nenhuma: "Criar guia" só marca guide_created=true. Nome e
    // Tipo do guia (tagline) não são pedidos aqui — não fazem parte de "A
    // casa" e, como qualquer outro dado de "O guia" (fotos, instruções de
    // check-in/checkout etc.), são requisitos de PUBLICAÇÃO, não de criação
    // do guia (ver publish-requirements.ts). A pessoa preenche isso depois,
    // na aba "O guia", quando for publicar.
    function handleCreateGuide() {
      void handleSave({ guide_created: true });
    }
    // Cancelar/Salvar alterações só fazem sentido enquanto existir uma
    // edição de verdade ainda não confirmada como salva (comparação contra
    // `savedPropertyKey`, atualizado a cada save — manual ou autosave). Se a
    // pessoa desfizer a alteração manualmente antes de salvar, volta a bater
    // com o snapshot e a barra some sozinha, sem precisar salvar nada.
    // "Criar guia" é uma ação à parte, sempre disponível — não depende de
    // haver edição pendente.
    const isDirty = !isNew && savedPropertyKey !== "" && savedPropertyKey !== JSON.stringify(form.property);
    return (
      <div className="ds-dense-fields px-2.5 sm:px-5 lg:px-8 py-5 lg:py-8 max-w-[1440px] w-full">
        <Link
          to={backTo as "/admin/guias"}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>

        <header className="mb-3 min-w-0">
          {/* Sem nome definido ainda (nada em "A casa" pede Nome — ele só
              existe na aba "O guia"), a linha de título some inteira em vez
              de mostrar um texto genérico de preenchimento. */}
          {isNew ? (
            <h1 className="ds-page-title w-full break-words">Novo imóvel</h1>
          ) : (
            form.property.name && <h1 className="ds-page-title w-full break-words">{form.property.name}</h1>
          )}
        </header>

        <div className="mb-4 ds-scroll-x items-center gap-2">
          <PresenceAvatars users={presence.users} />
          {!isNew && (
            <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
              Sem guia criado
            </span>
          )}
        </div>

        <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
          <DenseSections>
            {/* Sem barra de abas aqui: só se fala de "A casa" nesta tela — "O
              guia" e as demais abas só existem depois que o guia é criado. */}

            {/* Espelho EXATO da aba "A casa" do editor completo: MESMAS funções
              renderIdentitySection() / renderCleaningSection() / etc. (nunca
              uma cópia à parte) — byte a byte igual à de "Editar guia", sem
              nenhum campo a mais e sem nenhuma exceção (nem Nome, nem Tipo do
              guia — ambos vivem só na aba "O guia", como requisito de
              publicação, não de criação). */}
            <SectionGroup>
              {renderIdentitySection()}
              {renderCleaningSection()}
              {renderAddressSection()}
              {renderAirbnbCalendarSection()}
              {renderHouseRulesSection()}
              {renderManualSection()}
              {renderPropertyDetailsSection()}
              {renderHostContactSection()}
            </SectionGroup>
          </DenseSections>

          {/* Mesmo padrão de rodapé do diálogo "Novo Proprietário"
              (StakeholderFormDialog): linha comum (sem fixar na base da
              tela), Cancelar em ghost e ação principal em gradiente com
              ícone de check. Em "editar propriedade" (!isNew), Cancelar/
              Salvar alterações só aparecem havendo uma edição pendente de
              verdade (`isDirty`) — "Criar guia" fica sempre visível. */}
          <div className="ds-scroll-x justify-end gap-3 pt-3 mt-6 border-t border-border/30">
            {(isNew || isDirty) && (
              <Button variant="ghost" className="h-9" onClick={() => navigate({ to: backTo as "/admin/guias" })}>
                Cancelar
              </Button>
            )}
            {(isNew || isDirty) && (
              <Button
                className="h-9 bg-[linear-gradient(135deg,#7C1AD8,#E82DAE)] text-white hover:opacity-90"
                onClick={() => handleSave()}
                disabled={saving}
              >
                {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Check className="size-4 mr-1.5" />}
                {isNew ? "Criar imóvel" : "Salvar alterações"}
              </Button>
            )}
            {!isNew && (
              <Button
                className="h-9 bg-[linear-gradient(135deg,#7C1AD8,#E82DAE)] text-white hover:opacity-90"
                onClick={handleCreateGuide}
                disabled={saving}
              >
                {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Check className="size-4 mr-1.5" />}
                Criar guia
              </Button>
            )}
          </div>
        </fieldset>
      </div>
    );
  }

  return (
    <div className="ds-dense-fields px-2.5 sm:px-5 lg:px-8 py-5 lg:py-8 max-w-[1440px] w-full">
      <Link
        to={backTo as "/admin/guias"}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors"
      >
        <ArrowLeft className="size-3.5" /> Voltar
      </Link>
      {readOnly ? (
        <div className="mb-4 flex items-center gap-2 rounded-[0.3rem] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="size-3.5 shrink-0" />
          Você tem acesso apenas para visualizar este guia. A edição está bloqueada.
        </div>
      ) : null}
      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
        <header className="mb-3 min-w-0">
          <h1 className="ds-page-title w-full break-words">{form.property.name || "Sem título"}</h1>
          <p className="ds-page-subtitle mt-1.5">
            {houseOnly ? "Edite as informações da casa deste imóvel." : "Edite as informações do guia deste imóvel."}
          </p>
        </header>

        {!isNew && !houseOnly ? (
          <div className="mb-4 ds-scroll-x items-center gap-2">
            <PresenceAvatars users={presence.users} />
            <Link
              to="/admin/properties/$id/acessos"
              params={{ id }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[0.3rem] bg-secondary/50 text-xs font-normal hover:bg-secondary transition-colors shrink-0"
            >
              <Shield className="size-3.5 shrink-0" /> Acessos
            </Link>
            <Link
              to="/admin/properties/$id/conversas"
              params={{ id }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[0.3rem] bg-secondary/50 text-xs font-normal hover:bg-secondary transition-colors shrink-0"
            >
              <MessageSquare className="size-3.5 shrink-0" /> Conversas
            </Link>
          </div>
        ) : (
          <div className="mb-4" />
        )}

        <DenseSections>
          <Tabs value={step} onValueChange={setStep}>
            {/* Modo "só a casa" (link "Editar" dentro do Proprietário, em
            Stakeholders): trava em "house" e nunca mostra esta barra — só se
            fala de informações "da casa" ali, igual à tela de criação. */}
            {!houseOnly && (
              <Stepper
                current={step}
                onChange={setStep}
                steps={[
                  { value: "house", label: "A casa", icon: Home },
                  { value: "guide", label: "O guia", icon: FileText },
                  { value: "checkin", label: "Checkin", icon: DoorOpen },
                  { value: "checkout", label: "Checkout", icon: LogOut },
                  { value: "faq", label: "FAQ & Contatos", icon: LifeBuoy },
                  { value: "recs", label: "Recomendações", icon: Compass },
                ]}
                lockedValues={needsRequiredHouseInfo ? ["guide", "checkin", "checkout", "faq", "recs"] : undefined}
              />
            )}

            {/* ================= A CASA ================= */}
            <TabsContent value="house" className="space-y-4 mt-6">
              <SectionGroup>
                {needsRequiredHouseInfo ? (
                  <div className="flex items-start gap-2 rounded-[0.3rem] border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                    <span>
                      Complete as informações obrigatórias pendentes ({allMissingRequiredFields.join(", ")}) para
                      desbloquear as demais abas do guia.
                    </span>
                  </div>
                ) : null}

                {renderIdentitySection()}

                {renderCleaningSection()}

                {renderAddressSection()}

                {renderAirbnbCalendarSection()}

                {renderHouseRulesSection()}

                {renderManualSection()}

                {renderPropertyDetailsSection()}

                {renderHostContactSection()}
              </SectionGroup>
            </TabsContent>

            {/* ================= O GUIA ================= */}
            <TabsContent value="guide" className="space-y-4 mt-6">
              <SectionGroup>
                <Section
                  id="import-airbnb"
                  icon={Sparkles}
                  tone="accent"
                  title="Importar do Airbnb"
                  desc="Cole o link do anúncio para importar descrição, fotos e comodidades no guia."
                  collapsible
                >
                  {!canAirbnb && (
                    <div className="mb-3 ds-surface border border-border bg-secondary/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
                      <Lock className="size-3.5 shrink-0 mt-0.5" />
                      <span>
                        Importação automática é exclusiva dos planos <strong>Pro</strong>, <strong>Business</strong> e{" "}
                        <strong>Enterprise</strong>. Faça upgrade em{" "}
                        <Link to="/precos" className="underline font-medium">
                          Planos
                        </Link>
                        .
                      </span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Input
                      value={airbnbUrl}
                      onChange={(e) => setAirbnbUrl(e.target.value)}
                      placeholder="https://airbnb.com.br/h/seu-anuncio"
                      disabled={!canAirbnb}
                    />
                    <Button
                      onClick={handleImportAirbnb}
                      disabled={importingAirbnb || !canAirbnb}
                      variant="secondary"
                      className="shrink-0"
                    >
                      {importingAirbnb ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                      <span className="ml-1.5 hidden sm:inline">{importingAirbnb ? "Importando…" : "Importar"}</span>
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Procurando o calendário/iCal? Ele foi para a aba <strong>A casa</strong> — não depende mais de criar
                    um guia.
                  </p>
                </Section>

                <Section
                  id="identity"
                  icon={FileText}
                  title="Identidade visual"
                  desc="Como o guia se apresenta para o hóspede."
                  collapsible
                >
                  <Field
                    label="Nome do imóvel"
                    required
                    hint={`Máx. 80 caracteres — ${form.property.name.length}/80. Curto e memorável funciona melhor no cabeçalho do guia.`}
                  >
                    <Input
                      value={form.property.name}
                      maxLength={80}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 80);
                        if (e.target.value.length > 80)
                          toast.info(
                            "O nome do guia tem limite de 80 caracteres — algo curto e marcante funciona melhor no topo do guia.",
                            { id: "name-cap" },
                          );
                        update("name", v);
                        if (isNew && !form.property.slug) update("slug", slugify(v));
                      }}
                    />
                  </Field>
                  <Field label="URL pública (slug)" hint="Aparece em /g/seu-slug">
                    <Input
                      value={form.property.slug}
                      maxLength={60}
                      onChange={(e) => update("slug", slugify(e.target.value))}
                    />
                  </Field>
                  <Field
                    label="Tipo do guia"
                    hint="Aparece abaixo do nome no cabeçalho do guia. Obrigatório só para publicar."
                  >
                    <EtiquetaSelect value={form.property.tagline} onChange={(v) => update("tagline", v)} />
                  </Field>
                </Section>

                <Section
                  id="gallery"
                  icon={ImageIcon}
                  title="Fotos da residência"
                  desc="Até 4 fotos — a primeira será a capa."
                  collapsible
                >
                  <GalleryEditor
                    compact
                    value={form.property.gallery_images}
                    onChange={(next) => {
                      setForm((f) => ({
                        ...f,
                        property: { ...f.property, gallery_images: next, hero_image_url: next[0] ?? "" },
                      }));
                    }}
                  />
                </Section>

                <Section
                  id="access-mode"
                  icon={Shield}
                  title="Modo de acesso"
                  desc="Quem pode visualizar este guia."
                  collapsible
                >
                  <Field label="Modo de acesso do Guia">
                    <Select
                      value={form.property.access_mode}
                      onValueChange={(v) => update("access_mode", v as "public" | "pin")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">URL pública (qualquer um com o link vê)</SelectItem>
                        <SelectItem value="pin">Protegido por código (PIN)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {form.property.access_mode === "pin" && (
                    <div className="grid grid-cols-2 gap-3 ds-surface bg-muted/40 p-3 border border-border/60">
                      <Field label="Código de acesso" required>
                        <Input
                          value={form.property.pin_code}
                          maxLength={20}
                          onChange={(e) => update("pin_code", e.target.value)}
                          placeholder="ex: 4729"
                        />
                      </Field>
                      <Field label="Expira em" hint="Deixe em branco para nunca expirar">
                        <DateTimePicker
                          value={form.property.pin_expires_at}
                          onChange={(v) => update("pin_expires_at", v)}
                        />
                      </Field>
                    </div>
                  )}

                  {/* Formulário de primeiro acesso: obrigatório em guias de
                Check-In & Check-Out (bloqueado), editável nos demais tipos. */}
                  {(() => {
                    const gateLocked = form.property.tagline === ETIQUETA_CHECKIN_CHECKOUT;
                    const gateOn = gateLocked || form.property.require_access_gate;
                    return (
                      <div className="flex items-center justify-between gap-3 ds-surface border border-border/60 bg-muted/40 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight">Exigir formulário de primeiro acesso</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {gateLocked
                              ? "Obrigatório para guias do tipo Check-In & Check-Out."
                              : "O hóspede se identifica antes de ver o guia."}
                          </p>
                        </div>
                        {gateLocked ? (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold shrink-0">
                            <Lock className="size-3" /> obrigatório
                          </span>
                        ) : (
                          <Switch checked={gateOn} onCheckedChange={(v) => update("require_access_gate", v)} />
                        )}
                      </div>
                    );
                  })()}
                </Section>
              </SectionGroup>
            </TabsContent>

            {/* ================= CHECKIN ================= */}
            <TabsContent value="checkin" className="space-y-4 mt-6">
              <SectionGroup>
                <Section
                  id="checkin-instr"
                  icon={DoorOpen}
                  title="Instruções de chegada"
                  desc="Passo a passo do check-in. Uma etapa por linha."
                  collapsible
                >
                  <Field label="Passo a passo (opcional)" hint="Uma etapa por linha. Linhas em branco são ignoradas.">
                    <TagMentionTextarea
                      items={tagItems}
                      value={form.property.checkin_instructions}
                      maxLength={3000}
                      rows={6}
                      onChange={(e) => update("checkin_instructions", e.target.value)}
                      placeholder={
                        "Estacione na vaga 12.\nAponte para o portão lateral.\nUse o código de portão e fechadura ao lado."
                      }
                    />
                  </Field>
                  <Field
                    label="Fotos e vídeos do check-in"
                    hint="Até 8 itens. Imagens (máx 10MB) ou vídeos (máx 60MB)."
                  >
                    <MediaUpload
                      value={form.property.checkin_media}
                      onChange={(next) => update("checkin_media", next)}
                      folder="checkin"
                      max={8}
                    />
                  </Field>
                </Section>

                <Section
                  id="checkin-times"
                  icon={Clock}
                  title="Horários de check-in"
                  desc="Janela de chegada."
                  collapsible
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Check-in a partir de">
                      <TimePicker
                        value={form.property.checkin_time}
                        onChange={(v) => update("checkin_time", v)}
                        placeholder="15:00"
                      />
                    </Field>
                    <Field label="Check-in até" hint="opcional">
                      <TimePicker
                        value={form.property.checkin_time_max}
                        onChange={(v) => update("checkin_time_max", v)}
                        placeholder="22:00"
                      />
                    </Field>
                  </div>
                  <Field
                    label="Observação do check-in (opcional)"
                    hint="Aparece abaixo dos horários no guia. Deixe em branco para ocultar."
                  >
                    <TagMentionTextarea
                      items={tagItems}
                      value={form.property.checkin_note}
                      maxLength={1000}
                      rows={3}
                      onChange={(e) => update("checkin_note", e.target.value)}
                      placeholder="Ex.: Após às 22h, avise pelo WhatsApp com 1h de antecedência."
                    />
                  </Field>
                </Section>

                <Section
                  id="access-codes"
                  icon={KeyRound}
                  title="Senhas de Acesso"
                  desc="Códigos de portão e fechadura, mais o código que libera as senhas no Guia."
                  collapsible
                >
                  {/* Campo inline — Código para visualizar as senhas no Guia */}
                  <div className="flex items-center justify-between gap-3 ds-surface border border-border/60 bg-muted/40 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">
                        Código para visualizar as senhas de acesso no Guia
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Opcional. Deixe em branco para liberar apenas pela janela de horário.
                      </p>
                    </div>
                    <Input
                      className="w-32 shrink-0 tabular-nums text-center"
                      value={form.property.access_codes_pin}
                      maxLength={20}
                      onChange={(e) => update("access_codes_pin", e.target.value)}
                      placeholder="Ex.: 8421"
                    />
                  </div>

                  <div className="space-y-3 mt-3">
                    {/* Portão — sempre recolhido por padrão */}
                    <details className="group ds-surface border border-border/60 bg-card/30" open={gateOpen}>
                      <summary
                        className="list-none cursor-pointer select-none w-full flex items-center gap-3 px-4 py-3.5"
                        onClick={(e) => {
                          e.preventDefault();
                          setGateOpen((v) => !v);
                        }}
                      >
                        <div
                          className={`size-9 rounded-lg grid place-items-center shrink-0 ${gateOpen ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"}`}
                        >
                          <KeyRound className="size-[18px]" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold leading-tight">Portão com código</p>
                          <p className="text-[11.5px] text-muted-foreground mt-0.5">
                            {gateOpen
                              ? "Configure abaixo o código e as instruções."
                              : "Ative se a entrada tem portão com senha."}
                          </p>
                        </div>
                        <Switch
                          checked={gateOpen}
                          onCheckedChange={(v) => {
                            setGateOpen(v);
                            if (!v)
                              setForm((f) => ({
                                ...f,
                                property: {
                                  ...f.property,
                                  gate_code: "",
                                  gate_instructions: "",
                                  gate_video_url: "",
                                  gate_media: [],
                                },
                              }));
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <ChevronDown
                          className={`size-4 text-muted-foreground transition-transform ${gateOpen ? "rotate-180" : ""}`}
                        />
                      </summary>
                      {gateOpen && (
                        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-border/40">
                          <Field label="Código do portão" required>
                            <Input
                              value={form.property.gate_code}
                              maxLength={40}
                              onChange={(e) => update("gate_code", e.target.value)}
                              placeholder="Ex.: 1212"
                            />
                          </Field>
                          <Field
                            label="Defina um nome"
                            required
                            hint="Como esse acesso aparece no guia. Ex.: Portão, Garagem, Cancela."
                          >
                            <Input
                              value={form.property.gate_label}
                              maxLength={40}
                              onChange={(e) => update("gate_label", e.target.value)}
                              placeholder="Portão"
                            />
                          </Field>
                          <Field label="Passo a passo (opcional)" hint="Cada linha vira uma etapa numerada no guia.">
                            <Textarea
                              value={form.property.gate_instructions}
                              maxLength={3000}
                              rows={5}
                              onChange={(e) => update("gate_instructions", e.target.value)}
                              placeholder={"Ex.: 1) Digite o código no teclado do portão e aperte #."}
                            />
                          </Field>
                          <Field label="Link de vídeo tutorial (opcional)">
                            <Input
                              value={form.property.gate_video_url}
                              maxLength={2048}
                              onChange={(e) => update("gate_video_url", e.target.value)}
                              placeholder="https://youtu.be/…"
                            />
                          </Field>
                          <Field label="Fotos e vídeos do portão (opcional)">
                            <MediaUpload
                              value={form.property.gate_media}
                              onChange={(next) => update("gate_media", next)}
                              folder="access"
                              max={8}
                            />
                          </Field>
                        </div>
                      )}
                    </details>

                    {/* Fechadura — sempre recolhido por padrão */}
                    <details className="group ds-surface border border-border/60 bg-card/30" open={lockOpen}>
                      <summary
                        className="list-none cursor-pointer select-none w-full flex items-center gap-3 px-4 py-3.5"
                        onClick={(e) => {
                          e.preventDefault();
                          setLockOpen((v) => !v);
                        }}
                      >
                        <div
                          className={`size-9 rounded-lg grid place-items-center shrink-0 ${lockOpen ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"}`}
                        >
                          <Lock className="size-[18px]" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold leading-tight">Fechadura com código</p>
                          <p className="text-[11.5px] text-muted-foreground mt-0.5">
                            {lockOpen
                              ? "Configure abaixo o código e as instruções."
                              : "Ative se a porta tem fechadura eletrônica."}
                          </p>
                        </div>
                        <Switch
                          checked={lockOpen}
                          onCheckedChange={(v) => {
                            setLockOpen(v);
                            if (!v)
                              setForm((f) => ({
                                ...f,
                                property: {
                                  ...f.property,
                                  lock_code: "",
                                  lock_instructions: "",
                                  lock_video_url: "",
                                  lock_media: [],
                                },
                              }));
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <ChevronDown
                          className={`size-4 text-muted-foreground transition-transform ${lockOpen ? "rotate-180" : ""}`}
                        />
                      </summary>
                      {lockOpen && (
                        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-border/40">
                          <Field label="Código da fechadura" required>
                            <Input
                              value={form.property.lock_code}
                              maxLength={40}
                              onChange={(e) => update("lock_code", e.target.value)}
                              placeholder="Ex.: 3333"
                            />
                          </Field>
                          <Field
                            label="Defina um nome"
                            required
                            hint="Como esse acesso aparece no guia. Ex.: Fechadura, Porta principal, Smart lock."
                          >
                            <Input
                              value={form.property.lock_label}
                              maxLength={40}
                              onChange={(e) => update("lock_label", e.target.value)}
                              placeholder="Fechadura"
                            />
                          </Field>
                          <Field label="Passo a passo (opcional)" hint="Cada linha vira uma etapa numerada no guia.">
                            <Textarea
                              value={form.property.lock_instructions}
                              maxLength={3000}
                              rows={5}
                              onChange={(e) => update("lock_instructions", e.target.value)}
                              placeholder={"Ex.: 1) Digite o código na fechadura e pressione #."}
                            />
                          </Field>
                          <Field label="Link de vídeo tutorial (opcional)">
                            <Input
                              value={form.property.lock_video_url}
                              maxLength={2048}
                              onChange={(e) => update("lock_video_url", e.target.value)}
                              placeholder="https://youtu.be/…"
                            />
                          </Field>
                          <Field label="Fotos e vídeos da fechadura (opcional)">
                            <MediaUpload
                              value={form.property.lock_media}
                              onChange={(next) => update("lock_media", next)}
                              folder="access"
                              max={8}
                            />
                          </Field>
                        </div>
                      )}
                    </details>

                    {!gateOpen && !lockOpen ? (
                      <p className="text-[12px] text-muted-foreground ds-surface border border-dashed border-border/60 bg-background/30 px-4 py-3">
                        Ative ao menos um tipo de acesso acima para cadastrar código e instruções.
                      </p>
                    ) : null}
                  </div>
                </Section>

                <Section
                  id="wifi"
                  icon={Wifi}
                  title="Wi-Fi"
                  desc="Rede e senha exibidas no card de Wi-Fi do guia público."
                  collapsible
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Rede (SSID)">
                      <Input
                        value={form.property.wifi_ssid}
                        maxLength={64}
                        onChange={(e) => update("wifi_ssid", e.target.value)}
                      />
                    </Field>
                    <Field label="Senha">
                      <Input
                        value={form.property.wifi_password}
                        maxLength={64}
                        onChange={(e) => update("wifi_password", e.target.value)}
                      />
                    </Field>
                  </div>
                </Section>

                <Section
                  id="guest-data"
                  icon={ClipboardList}
                  title="Dados do hóspede"
                  desc="O que é coletado no formulário de primeiro acesso."
                  collapsible
                >
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Obrigatoriamente coletados
                    </p>
                    <div className="grid gap-1.5">
                      {[
                        { label: "Nome cadastrado na plataforma", icon: UserRound },
                        { label: "Período da viagem (chegada e saída)", icon: Clock },
                        { label: "Telefone", icon: Phone },
                      ].map((it) => (
                        <div
                          key={it.label}
                          className="flex items-center justify-between ds-surface border border-border/60 bg-muted/40 px-3.5 py-2"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="grid place-items-center size-7 rounded-lg bg-accent/10 text-accent">
                              <it.icon className="size-3.5" />
                            </span>
                            <span className="text-sm font-medium">{it.label}</span>
                          </div>
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                            <Lock className="size-3" /> obrigatório
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 pt-3 mt-3 border-t border-border/60">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Você também pode solicitar
                    </p>
                    <CaptureRow
                      icon={Clock}
                      title="Horário previsto de chegada"
                      desc="Ajuda a preparar o check-in no horário certo."
                      mode={form.property.collect_arrival_time}
                      onModeChange={(m) =>
                        setForm((f) => ({ ...f, property: { ...f.property, collect_arrival_time: m } }))
                      }
                    />
                    <CaptureRow
                      icon={Car}
                      title="Veículo(s)"
                      desc="Quantos veículos e para cada um: placa, modelo, cor."
                      mode={form.property.collect_vehicles}
                      onModeChange={(m) => setForm((f) => ({ ...f, property: { ...f.property, collect_vehicles: m } }))}
                    >
                      {form.property.collect_vehicles !== "off" && (
                        <div className="flex items-center justify-between rounded-lg bg-muted/40 border border-border/50 px-3 py-2 mt-1">
                          <div className="text-[12.5px] text-muted-foreground">
                            <span className="font-medium text-foreground">Quantidade máxima permitida</span>
                            <span className="block text-[11px]">Define o teto que o hóspede pode escolher.</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setForm((f) => ({ ...f, property: { ...f.property, vehicles_max: n } }))}
                                className={cn(
                                  "size-8 rounded-full text-[12px] font-semibold border transition-colors",
                                  form.property.vehicles_max === n
                                    ? "bg-accent text-accent-foreground border-accent"
                                    : "border-border text-muted-foreground hover:text-foreground",
                                )}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </CaptureRow>
                    <CaptureRow
                      icon={IdCard}
                      title="Documento pessoal"
                      desc="Nome completo + número (CPF, RG, passaporte…)."
                      mode={form.property.collect_document}
                      onModeChange={(m) => setForm((f) => ({ ...f, property: { ...f.property, collect_document: m } }))}
                    >
                      {form.property.collect_document !== "off" && (
                        <div className="rounded-lg bg-muted/40 border border-border/50 px-3 py-2 mt-1">
                          <div className="text-[12px] font-medium mb-1.5">De quem coletar?</div>
                          <div className="flex gap-1.5">
                            {(
                              [
                                { v: "main", label: "Só do hóspede principal" },
                                { v: "all", label: "De todos os hóspedes" },
                              ] as const
                            ).map((o) => (
                              <button
                                key={o.v}
                                type="button"
                                onClick={() =>
                                  setForm((f) => ({ ...f, property: { ...f.property, document_scope: o.v } }))
                                }
                                className={cn(
                                  "px-3 py-1.5 rounded-full text-[11.5px] border transition-colors",
                                  form.property.document_scope === o.v
                                    ? "bg-accent text-accent-foreground border-accent"
                                    : "border-border text-muted-foreground hover:text-foreground",
                                )}
                              >
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </CaptureRow>
                  </div>
                </Section>
              </SectionGroup>
            </TabsContent>

            {/* ================= CHECKOUT ================= */}
            <TabsContent value="checkout" className="space-y-4 mt-6">
              <SectionGroup>
                <Section
                  id="checkout-instr"
                  icon={LogOut}
                  title="Instruções de saída"
                  desc="Passo a passo do check-out. Uma etapa por linha."
                  collapsible
                >
                  <Field label="Passo a passo (opcional)" hint="Uma etapa por linha. Linhas em branco são ignoradas.">
                    <TagMentionTextarea
                      items={tagItems}
                      value={form.property.checkout_instructions}
                      maxLength={3000}
                      rows={6}
                      onChange={(e) => update("checkout_instructions", e.target.value)}
                      placeholder={
                        "Deixe as chaves sobre a mesa de jantar.\nFeche todas as janelas.\nTranque a porta principal ao sair."
                      }
                    />
                  </Field>
                </Section>

                <Section
                  id="checkout-times"
                  icon={Clock}
                  title="Horários de check-out"
                  desc="Janela de saída."
                  collapsible
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Check-out a partir de" hint="opcional">
                      <TimePicker
                        value={form.property.checkout_time_min}
                        onChange={(v) => update("checkout_time_min", v)}
                        placeholder="08:00"
                      />
                    </Field>
                    <Field label="Check-out até">
                      <TimePicker
                        value={form.property.checkout_time}
                        onChange={(v) => update("checkout_time", v)}
                        placeholder="11:00"
                      />
                    </Field>
                  </div>
                  <Field
                    label="Observação do check-out (opcional)"
                    hint="Aparece abaixo dos horários no guia. Deixe em branco para ocultar."
                  >
                    <TagMentionTextarea
                      items={tagItems}
                      value={form.property.checkout_note}
                      maxLength={1000}
                      rows={3}
                      onChange={(e) => update("checkout_note", e.target.value)}
                      placeholder="Ex.: Late check-out mediante disponibilidade — consulte o anfitrião."
                    />
                  </Field>
                </Section>

                <Section
                  id="checkout-list"
                  icon={ClipboardCheck}
                  title="Checklist de check-out"
                  desc="O que o hóspede deve fazer antes de sair."
                  collapsible
                >
                  {form.checkout.length === 0 ? (
                    <EmptyHint text="Ex: trancar a porta, deixar a chave na mesa, fechar janelas." />
                  ) : (
                    form.checkout.map((c, i) => (
                      <ItemCard
                        key={i}
                        onRemove={() => setForm((f) => ({ ...f, checkout: f.checkout.filter((_, j) => j !== i) }))}
                      >
                        <Input
                          placeholder="ex: Trancar a porta"
                          value={c.label}
                          maxLength={200}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              checkout: f.checkout.map((x, j) => (j === i ? { label: e.target.value } : x)),
                            }))
                          }
                        />
                      </ItemCard>
                    ))
                  )}
                  <div className="pt-1">
                    <AddBtn onClick={() => setForm((f) => ({ ...f, checkout: [...f.checkout, { label: "" }] }))} />
                  </div>
                </Section>
              </SectionGroup>
            </TabsContent>

            {/* ================= FAQ & CONTATOS ================= */}
            <TabsContent value="faq" className="space-y-4 mt-6">
              <SectionGroup>
                <Section
                  id="emergency"
                  icon={Phone}
                  title="Emergências"
                  desc="Telefones úteis em caso de urgência."
                  collapsible
                >
                  {form.emergency.length === 0 ? (
                    <EmptyHint text="Adicione contatos como polícia, bombeiros, médico de plantão." />
                  ) : (
                    form.emergency.map((m, i) => (
                      <ItemCard
                        key={i}
                        onRemove={() => setForm((f) => ({ ...f, emergency: f.emergency.filter((_, j) => j !== i) }))}
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Rótulo"
                            value={m.label}
                            maxLength={120}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                emergency: f.emergency.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                              }))
                            }
                          />
                          <Input
                            placeholder="Número"
                            value={m.number}
                            maxLength={40}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                emergency: f.emergency.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)),
                              }))
                            }
                          />
                        </div>
                      </ItemCard>
                    ))
                  )}
                  <div className="pt-1">
                    <AddBtn
                      onClick={() => setForm((f) => ({ ...f, emergency: [...f.emergency, { label: "", number: "" }] }))}
                    />
                  </div>
                </Section>

                <Section
                  id="faqs"
                  icon={HelpCircle}
                  title="Perguntas frequentes"
                  desc="Antecipe dúvidas comuns dos hóspedes."
                  collapsible
                >
                  {form.faqs.length === 0 ? (
                    <EmptyHint text="Ex: posso fumar? tem estacionamento? aceita pets?" />
                  ) : (
                    form.faqs.map((m, i) => {
                      const FAQ_TAGS: { value: "chegada" | "saida" | "residencia" | "explore"; label: string }[] = [
                        { value: "chegada", label: "Chegada (Check-In)" },
                        { value: "saida", label: "Saída (Check-Out)" },
                        { value: "residencia", label: "Residência" },
                        { value: "explore", label: "Explore" },
                      ];
                      const toggleTag = (tag: "chegada" | "saida" | "residencia" | "explore") => {
                        setForm((f) => ({
                          ...f,
                          faqs: f.faqs.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  tags: x.tags.includes(tag) ? x.tags.filter((t) => t !== tag) : [...x.tags, tag],
                                }
                              : x,
                          ),
                        }));
                      };
                      const isOpen = openFaqIdx === i;
                      const isSigma = m.tags.includes("sigma");
                      return (
                        <div
                          key={i}
                          className={`group bg-background border ds-surface overflow-hidden transition-colors ${isSigma ? "border-amber-400/40" : "border-border/60 hover:border-border"}`}
                        >
                          <div className="flex items-center gap-2 px-3.5 py-3">
                            <button
                              type="button"
                              onClick={() => setOpenFaqIdx(isOpen ? null : i)}
                              className="flex-1 flex items-center gap-2 min-w-0 text-left"
                              aria-expanded={isOpen}
                            >
                              {isSigma && <Lock className="size-3.5 text-amber-300 shrink-0" />}
                              <span className="text-sm font-medium truncate flex-1">
                                {m.question || <span className="text-muted-foreground italic">Sem pergunta</span>}
                              </span>
                              <ChevronDown
                                className={`size-4 text-muted-foreground transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`}
                              />
                            </button>
                            {!isSigma && (
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
                            )}
                          </div>
                          {isOpen && (
                            <fieldset
                              disabled={isSigma}
                              className={`px-3.5 pb-3.5 pt-1 space-y-2.5 border-t border-border/40 m-0 min-w-0 ${isSigma ? "opacity-70" : ""}`}
                            >
                              {isSigma && (
                                <p className="text-[11px] text-amber-300/90 inline-flex items-center gap-1">
                                  <Lock className="size-3" /> Pergunta do ConciergeIA — leitura somente.
                                </p>
                              )}
                              <Input
                                placeholder="Pergunta"
                                value={m.question}
                                maxLength={200}
                                onChange={(e) =>
                                  setForm((f) => ({
                                    ...f,
                                    faqs: f.faqs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)),
                                  }))
                                }
                              />
                              <TagMentionTextarea
                                items={tagItems}
                                placeholder="Resposta"
                                value={m.answer}
                                maxLength={2000}
                                onChange={(e) =>
                                  setForm((f) => ({
                                    ...f,
                                    faqs: f.faqs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)),
                                  }))
                                }
                              />
                              <div className="space-y-1.5">
                                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                  Exibir também em
                                </p>
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
                            </fieldset>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div className="ds-scroll-x gap-2 pt-1">
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
                          toast.success(
                            `${added} pergunta${added > 1 ? "s" : ""} gerada${added > 1 ? "s" : ""} a partir dos campos.`,
                          );
                          return { ...f, faqs: merged };
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs text-muted-foreground hover:text-foreground hover:border-accent/50 transition-colors shrink-0"
                    >
                      <Sparkles className="size-3.5" /> Gerar dos campos
                    </button>
                    <AddBtn
                      onClick={() =>
                        setForm((f) => ({ ...f, faqs: [...f.faqs, { question: "", answer: "", tags: [] }] }))
                      }
                    />
                  </div>
                </Section>

                <Section
                  id="host-faq"
                  icon={UserRound}
                  title="Contato do anfitrião"
                  desc="Nome e WhatsApp para o hóspede te encontrar."
                  collapsible
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nome">
                      <Input
                        value={form.property.host_name}
                        maxLength={120}
                        onChange={(e) => update("host_name", e.target.value)}
                      />
                    </Field>
                    <Field label="Telefone (WhatsApp)">
                      <Input
                        value={form.property.host_phone}
                        maxLength={40}
                        onChange={(e) => update("host_phone", e.target.value)}
                      />
                    </Field>
                  </div>
                </Section>
              </SectionGroup>
            </TabsContent>

            {/* ================= RECOMENDAÇÕES ================= */}
            <TabsContent value="recs" className="space-y-4 mt-6">
              {!isNew && <SigmaActiveBanner propertyId={id} />}
              <SectionGroup>
                <div className="ds-surface border border-border/60 bg-background/40 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Adicionar ponto/estabelecimento
                    </p>
                    <span className="text-[10px] text-muted-foreground/70">Decidimos o quadrante pela distância</span>
                  </div>
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
                          toast.error("Defina a cidade do imóvel antes.");
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
                  desc="Arredores do imóvel — a poucos minutos a pé."
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

                <Section
                  id="marketplace"
                  icon={Ticket}
                  title="Reservas & marketplace"
                  desc="Links para venda de ingressos, passeios, transfers, produtos ou qualquer experiência que você queira oferecer ao hóspede."
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
                    <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
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
              </SectionGroup>
            </TabsContent>
          </Tabs>
        </DenseSections>

        <div aria-hidden="true" className="h-36 sm:h-32 lg:h-28" />

        {previewSlug && (
          <>
            <button
              type="button"
              onClick={() => {
                setPreviewMode(null);
                setPreviewOpen(true);
              }}
              title="Pré-visualizar guia"
              aria-label="Pré-visualizar guia"
              className="fixed right-4 bottom-24 z-40 inline-flex items-center justify-center size-11 rounded-full bg-foreground text-background shadow-md hover:shadow-lg hover:scale-105 transition-all"
            >
              <Eye className="size-[18px]" />
            </button>
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
                      : "p-0 gap-0 overflow-hidden sm:max-w-[420px] w-[min(92vw,420px)] [&>button]:hidden"
                }
              >
                <DialogTitle className="sr-only">Pré-visualização do guia</DialogTitle>
                {previewMode === null ? (
                  <div className="p-6 bg-background ds-surface border border-border shadow-xl">
                    <div className="text-center mb-5">
                      <h3 className="font-display text-xl">Como deseja visualizar?</h3>
                      <p className="text-xs text-muted-foreground mt-1">Escolha o modo de pré-visualização do guia.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPreviewMode("mobile")}
                        className="group flex flex-col items-center gap-2 ds-surface border border-border bg-card hover:border-foreground/40 hover:bg-secondary/40 transition-colors p-5"
                      >
                        <div className="w-10 h-14 rounded-md border-2 border-foreground/70 group-hover:border-foreground transition-colors" />
                        <span className="text-sm font-medium">Mobile</span>
                        <span className="text-[11px] text-muted-foreground">Tela do celular</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode("desktop")}
                        className="group flex flex-col items-center gap-2 ds-surface border border-border bg-card hover:border-foreground/40 hover:bg-secondary/40 transition-colors p-5"
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

        <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur p-3 sm:p-4 z-50">
          <div className="max-w-4xl mx-auto">
            {/* ANTI-CORTE (regra global): a barra de ações rola na horizontal
            (ds-scroll-x) em vez de quebrar linha — o aviso de autosave abaixo
            é só texto informativo, por isso fica fora dessa barra, na sua
            própria linha. */}
            <div className="ds-scroll-x justify-center gap-2 sm:gap-3">
              {houseOnly ? (
                <Button
                  variant="outline"
                  className="h-10 min-w-[120px]"
                  onClick={() => navigate({ to: backTo as "/admin/guias" })}
                >
                  Fechar
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="h-10 min-w-[120px]"
                    onClick={() => {
                      // Mesma ordem das abas do Stepper acima (house, guide, checkin,
                      // checkout, faq, recs) — antes esta lista estava desatualizada
                      // (basics/access/extras não existem mais como abas) e fazia
                      // "Próximo"/"Anterior" pularem direto para "Recomendações".
                      const order = ["house", "guide", "checkin", "checkout", "faq", "recs"];
                      const i = order.indexOf(step);
                      if (i > 0) setStep(order[i - 1]);
                    }}
                    disabled={step === "house"}
                  >
                    <ArrowLeft className="size-3.5 mr-1" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 min-w-[120px]"
                    onClick={() => {
                      const order = ["house", "guide", "checkin", "checkout", "faq", "recs"];
                      const i = order.indexOf(step);
                      if (i < order.length - 1) setStep(order[i + 1]);
                    }}
                    disabled={step === "recs" || (needsRequiredHouseInfo && step === "house")}
                  >
                    Próximo
                    <ArrowLeft className="size-3.5 ml-1 rotate-180" />
                  </Button>
                </>
              )}
            </div>
            {!readOnly && !isNew && (
              <p
                className={`mt-1.5 text-center text-[11px] inline-flex w-full items-center justify-center gap-1.5 ${
                  autoSaveError ? "text-destructive" : "text-muted-foreground"
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
                  "Alterações salvas automaticamente"
                )}
              </p>
            )}
          </div>
        </div>

        <AlertDialog open={pendingIcalClear} onOpenChange={(o) => !o && setPendingIcalClear(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover integração com o Airbnb?</AlertDialogTitle>
              <AlertDialogDescription>
                As reservas sincronizadas deixarão de ser atualizadas automaticamente. Você pode reconectar a qualquer
                momento colando a URL novamente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  update("airbnb_ical_url", null);
                  setPendingIcalClear(false);
                }}
              >
                Remover integração
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </fieldset>
    </div>
  );
}

function Field({
  label,
  hint,
  hintClassName,
  required,
  children,
}: {
  label: string;
  hint?: string;
  // Opcional: reserva uma altura mínima pra legenda (hint), pra quando este
  // Field fica lado a lado com outro Field cujo hint tem um número
  // DIFERENTE de linhas — sem isso, o campo com legenda mais curta "subia"
  // e ficava desalinhado com o campo vizinho (título com título, mas campo
  // preenchível cada um numa altura diferente). Só é preciso passar isso
  // quando dois Fields precisam ficar emparelhados lado a lado.
  hintClassName?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <Label className="block truncate text-[13px] font-normal text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {hint && <p className={cn("text-[11px] text-muted-foreground mt-0.5 leading-snug", hintClassName)}>{hint}</p>}
      <div className="mt-2">{children}</div>
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
    <div className="ds-surface border border-dashed border-border/70 bg-muted/30 px-4 py-5 text-center text-xs text-muted-foreground leading-relaxed">
      {text}
    </div>
  );
}

/** Upload de imagens por item do Manual da casa — guarda caminhos (não URLs
 * assinadas, que expiram) e reaproveita o preview de PropertyDetailsEditor. */
function ManualItemImages({
  images,
  propertyId,
  onChange,
}: {
  images: string[];
  propertyId: string;
  onChange: (next: string[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList) {
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, 6 - images.length)) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name}: imagem muito grande (máx 10MB)`);
          continue;
        }
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${u.user.id}/manual/${propertyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from("property-images")
          .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
        if (error) throw error;
        added.push(path);
      }
      onChange([...images, ...added]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2 pt-1">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <DetailImages paths={images} onRemove={(p) => onChange(images.filter((x) => x !== p))} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground"
        disabled={uploading || images.length >= 6}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? <Loader2 className="size-3 animate-spin mr-1.5" /> : <ImagePlus className="size-3 mr-1.5" />}
        {images.length > 0 ? "Adicionar foto" : "Anexar foto"}
      </Button>
    </div>
  );
}

function ItemCard({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="group bg-background border border-border/60 ds-surface p-3.5 pr-10 space-y-2.5 relative hover:border-border transition-colors">
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

  return (
    <RecGroup
      title="Pela cidade"
      desc="Vale a visita — alguns minutos de carro. Compartilhado entre todos os guias desta cidade."
      items={localItems}
      onChange={handleChange}
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
  headerExtra?: React.ReactNode;
  hideSearch?: boolean;
  locked?: boolean;
  metricsCounts?: Record<string, { views: number; likes: number; dislikes: number; shares: number }>;
}) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [openItemIdx, setOpenItemIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());
  const [filterQuery, setFilterQuery] = useState("");
  const [showNewCat, setShowNewCat] = useState(false);
  const [showNewTag, setShowNewTag] = useState(false);
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
    <Section icon={scope === "nearby" ? MapPin : Compass} title={title} desc={desc}>
      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
          <span className="text-xs text-amber-200 inline-flex items-center gap-1.5">
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
                    {(taxonomy?.categories ?? []).map((c) => (
                      <DropdownMenuItem
                        key={c.id}
                        onClick={() => {
                          const next = items.map((it, i) => (selectedIdx.has(i) ? { ...it, category: c.label } : it));
                          onChange(next);
                          setSelectedIdx(new Set());
                          toast.success(`Movidos para "${c.label}"`);
                        }}
                      >
                        {c.label}
                      </DropdownMenuItem>
                    ))}
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
                  Taxonomia
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setShowNewCat(true)}>
                  <Plus className="size-3.5" /> Nova categoria
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShowNewTag(true)}>
                  <Plus className="size-3.5" /> Nova tag
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Editar categorias
                </DropdownMenuLabel>
                <div className="px-1.5 pb-1.5 space-y-0.5">
                  {(taxonomy?.categories ?? []).map((c) => {
                    const count = groups.get(c.label)?.items.length ?? 0;
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted/60"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <span className="flex-1 truncate text-xs">
                          {c.label} <span className="text-muted-foreground">({count})</span>
                        </span>
                        <InlineCategoryRename
                          currentLabel={c.label}
                          categoryId={c.id}
                          isProtected={c.is_protected}
                          items={items}
                          onChange={onChange}
                        />
                        <CategoryDeleteButton
                          currentLabel={c.label}
                          categoryId={c.id}
                          isProtected={c.is_protected}
                          allCategories={(taxonomy?.categories ?? []).map((x) => ({ id: x.id, label: x.label }))}
                          itemsInCategory={count}
                          items={items}
                          onChange={onChange}
                        />
                      </div>
                    );
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {showNewCat && (
          <NewCategoryDialog
            onClose={() => setShowNewCat(false)}
            onSaved={() => {
              setShowNewCat(false);
              qc.invalidateQueries({ queryKey: TAXONOMY_QUERY_KEY });
            }}
          />
        )}
        {showNewTag && (
          <NewTagDialog
            categories={taxonomy?.categories ?? []}
            presetCategoryId={null}
            onClose={() => setShowNewTag(false)}
            onSaved={() => {
              setShowNewTag(false);
              qc.invalidateQueries({ queryKey: TAXONOMY_QUERY_KEY });
            }}
          />
        )}

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
                  className={`ds-surface border bg-background/40 overflow-hidden transition-colors ${
                    dragOverCat === cat ? "border-primary/70 ring-2 ring-primary/30" : "border-border/60"
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
                    className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-muted/30 transition-colors"
                    draggable
                    onDragStart={() => setDragCat(cat)}
                    onDragEnd={() => {
                      setDragCat(null);
                      setDragOverCat(null);
                    }}
                    title="Arraste para reordenar"
                    style={{ cursor: "grab" }}
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
                        <InlineCategoryRename
                          currentLabel={cat}
                          categoryId={taxonomy?.categories.find((c) => c.label === cat)?.id ?? null}
                          isProtected={!!taxonomy?.categories.find((c) => c.label === cat)?.is_protected}
                          items={items}
                          onChange={onChange}
                        />
                        <CategoryDeleteButton
                          currentLabel={cat}
                          categoryId={taxonomy?.categories.find((c) => c.label === cat)?.id ?? null}
                          isProtected={!!taxonomy?.categories.find((c) => c.label === cat)?.is_protected}
                          allCategories={(taxonomy?.categories ?? []).map((c) => ({ id: c.id, label: c.label }))}
                          itemsInCategory={g.items.length}
                          items={items}
                          onChange={onChange}
                        />
                        <span className="text-[11px] text-muted-foreground">
                          ({g.items.length}
                          {groupSelected > 0 ? ` · ${groupSelected} sel.` : ""})
                        </span>
                      </div>
                      <ChevronDown
                        className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>
                  {open && (
                    <div className="border-t border-border/50 px-3.5 py-3 space-y-2">
                      {g.items.map((r, k) => {
                        if (filterActive && !matchesFilter(r)) return null;
                        const idx = g.indices[k];
                        const checked = selectedIdx.has(idx);
                        const itemOpen = openItemIdx === idx;
                        const tagLabel = (taxonomy?.tags ?? []).find((t) => t.slug === r.type)?.label ?? r.type ?? "";
                        return (
                          <div
                            key={idx}
                            className="rounded-lg border border-border/60 bg-background/60 overflow-hidden"
                          >
                            <div className="flex items-center gap-2 px-3 py-2">
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
                                <span className="truncate text-sm font-medium">{r.name || "(sem nome)"}</span>
                                {tagLabel && (
                                  <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    {tagLabel}
                                  </span>
                                )}
                                <span className="flex-1" />
                                <ChevronDown
                                  className={`size-4 text-muted-foreground transition-transform shrink-0 ${itemOpen ? "rotate-180" : ""}`}
                                />
                              </button>
                              {metricsCounts && r._dbId ? (
                                <POIMetricsBadge counts={metricsCounts[r._dbId]} position="inline" />
                              ) : null}
                              <button
                                type="button"
                                onClick={() => removeAt(idx)}
                                className="shrink-0 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-rose-500 hover:bg-muted"
                                aria-label="Remover"
                                title="Remover"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                            {itemOpen && (
                              <div className="border-t border-border/50 px-3 py-3 space-y-2">
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

function InlineCategoryRename({
  currentLabel,
  categoryId,
  isProtected: _isProtected,
  items,
  onChange,
}: {
  currentLabel: string;
  categoryId: string | null;
  isProtected: boolean;
  items: RecItem[];
  onChange: (i: RecItem[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentLabel);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePoiCategory);

  useEffect(() => {
    setValue(currentLabel);
  }, [currentLabel]);

  // Toda categoria pode ser renomeada (mantém a mesma, só ajusta o nome).
  const canEdit = !!categoryId;

  const commit = async (e?: React.SyntheticEvent) => {
    e?.stopPropagation?.();
    const next = value.trim();
    if (!next || next === currentLabel || !categoryId) {
      setEditing(false);
      setValue(currentLabel);
      return;
    }
    try {
      setSaving(true);
      await updateFn({ data: { id: categoryId, label: next } });
      // Atualiza referência local dos pontos para o novo rótulo (mesma categoria, novo nome)
      onChange(items.map((it) => (it.category === currentLabel ? { ...it, category: next } : it)));
      await qc.invalidateQueries({ queryKey: TAXONOMY_QUERY_KEY });
      toast.success("Categoria renomeada");
      setEditing(false);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao renomear");
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
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setValue(currentLabel);
            }
          }}
          disabled={saving}
          className="h-7 text-sm w-44"
          maxLength={80}
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
            setEditing(false);
            setValue(currentLabel);
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
      {canEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted opacity-60 hover:opacity-100"
          aria-label="Renomear categoria"
          title="Renomear categoria"
        >
          <Pencil className="size-3" />
        </button>
      )}
    </div>
  );
}

function CategoryDeleteButton({
  currentLabel,
  categoryId,
  isProtected,
  allCategories,
  itemsInCategory,
  items,
  onChange,
}: {
  currentLabel: string;
  categoryId: string | null;
  isProtected: boolean;
  allCategories: { id: string; label: string }[];
  itemsInCategory: number;
  items: RecItem[];
  onChange: (i: RecItem[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"move" | "delete">("move");
  const [targetLabel, setTargetLabel] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const deleteFn = useServerFn(deletePoiCategory);

  const otherCats = allCategories.filter((c) => c.label !== currentLabel);
  useEffect(() => {
    if (open && !targetLabel && otherCats[0]) setTargetLabel(otherCats[0].label);
  }, [open, targetLabel, otherCats]);

  if (!categoryId || isProtected) return null;

  const confirm = async () => {
    try {
      setSaving(true);
      const targetId = mode === "move" ? allCategories.find((c) => c.label === targetLabel)?.id : undefined;
      if (mode === "move" && !targetId) {
        toast.error("Escolha uma categoria de destino.");
        setSaving(false);
        return;
      }
      await deleteFn({ data: { id: categoryId, reassign_to_category_id: targetId } });
      // Atualiza os itens locais
      if (mode === "move" && targetLabel) {
        onChange(items.map((it) => (it.category === currentLabel ? { ...it, category: targetLabel } : it)));
        toast.success(`Categoria excluída — pontos movidos para "${targetLabel}"`);
      } else {
        onChange(items.filter((it) => it.category !== currentLabel));
        toast.success("Categoria e pontos excluídos");
      }
      await qc.invalidateQueries({ queryKey: TAXONOMY_QUERY_KEY });
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao excluir categoria");
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
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-rose-500 hover:bg-muted opacity-60 hover:opacity-100"
        aria-label="Excluir categoria"
        title="Excluir categoria"
      >
        <Trash2 className="size-3" />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria "{currentLabel}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {itemsInCategory > 0
                ? `Existem ${itemsInCategory} ponto(s) vinculado(s) a esta categoria. Escolha o que fazer com eles antes de confirmar.`
                : "Esta categoria não possui pontos vinculados."}
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
                      {otherCats.map((c) => (
                        <SelectItem key={c.id} value={c.label}>
                          {c.label}
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
                confirm();
              }}
              disabled={saving || (itemsInCategory > 0 && mode === "move" && !targetLabel)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Confirmar exclusão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CategoryDescriptionField({
  categoryId,
  currentDescription,
  canEdit,
}: {
  categoryId: string | null;
  currentDescription: string | null;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(currentDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePoiCategory);
  const initialRef = React.useRef(currentDescription ?? "");

  useEffect(() => {
    setValue(currentDescription ?? "");
    initialRef.current = currentDescription ?? "";
  }, [currentDescription, categoryId]);

  if (!categoryId) return null;

  const save = async () => {
    if (!canEdit || saving) return;
    const next = value.trim();
    if (next === (initialRef.current ?? "").trim()) return;
    try {
      setSaving(true);
      await updateFn({ data: { id: categoryId, description: next || null } });
      await qc.invalidateQueries({ queryKey: TAXONOMY_QUERY_KEY });
      initialRef.current = next;
      setSavedAt(Date.now());
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar descrição");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Descrição da categoria <span className="opacity-60 normal-case tracking-normal">(opcional)</span>
        </label>
        {saving ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> salvando
          </span>
        ) : savedAt ? (
          <span className="text-[10px] text-emerald-600">salvo</span>
        ) : null}
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        disabled={!canEdit}
        placeholder={
          canEdit
            ? "Ex: Os melhores restaurantes da região para uma boa refeição em família."
            : "Categoria padrão — descrição não editável."
        }
        maxLength={500}
        rows={2}
        className="text-sm bg-background/60"
      />
    </div>
  );
}

function GalleryEditor({
  value,
  onChange,
  compact = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  compact?: boolean;
}) {
  const slots: string[] = [0, 1, 2, 3].map((i) => value[i] ?? "");
  function setAt(i: number, v: string) {
    const next = [...slots];
    next[i] = v;
    onChange(next.filter((x) => x.trim()));
  }
  return (
    <div className={compact ? "grid grid-cols-4 gap-1.5 max-w-sm" : "grid grid-cols-2 sm:grid-cols-4 gap-2"}>
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
            <span className="absolute top-1 left-1 rounded bg-background/85 text-[8px] uppercase tracking-widest px-1.5 py-0.5 font-bold z-10 pointer-events-none">
              Capa
            </span>
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
          <div className="grid gap-2.5">
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

function CaptureRow({
  icon: Icon,
  title,
  desc,
  mode,
  onModeChange,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  mode: CaptureMode;
  onModeChange: (m: CaptureMode) => void;
  children?: React.ReactNode;
}) {
  const options: { value: CaptureMode; label: string }[] = [
    { value: "off", label: "Não pedir" },
    { value: "optional", label: "Opcional" },
    { value: "required", label: "Obrigatório" },
  ];
  const active = mode !== "off";
  return (
    <div
      className={cn(
        "ds-surface border transition-all",
        active ? "border-accent/40 bg-accent/5" : "border-border/60 bg-card",
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3.5">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span
            className={cn(
              "grid place-items-center size-9 rounded-lg shrink-0",
              active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">{title}</div>
            <div className="text-[11.5px] text-muted-foreground leading-snug">{desc}</div>
          </div>
        </div>
        <div className="inline-flex items-center rounded-full bg-muted p-0.5 self-start sm:self-auto">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onModeChange(o.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11.5px] font-medium transition-colors",
                mode === o.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {children && <div className="px-3.5 pb-3.5">{children}</div>}
    </div>
  );
}
