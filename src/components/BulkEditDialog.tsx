import { useEffect, useMemo, useRef, useState } from "react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogDescription,
} from "@/components/ResponsiveDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Section, SectionGroup, type SectionIcon } from "@/components/editor/Section";
import { MoneyInput } from "@/components/ui/money-input";
import { PropertyTypeSelect } from "@/components/admin/PropertyTypeSelect";
import {
  Loader2, Plus, Trash2, MapPinned, ClipboardCheck, BookOpen, UserRound, Shield,
  DoorOpen, Clock, KeyRound, Wifi, ClipboardList, LogOut, Phone, HelpCircle,
  Home, Sparkles, NotebookPen, AlertTriangle,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bulkUpdateProperties, bulkFetchProperties } from "@/lib/properties.functions";
import { listActivePropertyOwnersForSelect } from "@/lib/stakeholders.functions";

import { toast } from "sonner";
import type { AutosaveStatus } from "@/hooks/useAutosave";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";

// 30min, 1h, 1h30 ... até 8h — mesma escala usada no editor individual
// (admin.properties.$id.tsx), duplicada aqui de propósito: é um array puro,
// sem lógica, e evita acoplar os dois arquivos por um detalhe tão pequeno.
const CLEANING_DURATION_OPTIONS = Array.from({ length: 16 }, (_, i) => {
  const minutes = (i + 1) * 30;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const label = h === 0 ? `${m}min` : m === 0 ? `${h}h` : `${h}h${m}`;
  return { value: minutes, label };
});

type FieldKey =
  | "checkin_time" | "checkin_time_max" | "checkin_note"
  | "checkout_time" | "checkout_time_min" | "checkout_note"
  | "address_note" | "checkin_instructions" | "checkout_instructions"
  | "gate_code" | "gate_label" | "gate_instructions"
  | "lock_code" | "lock_label" | "lock_instructions"
  | "access_codes_pin" | "wifi_ssid" | "wifi_password"
  | "host_name" | "host_phone"
  | "brand_name" | "brand_logo_url" | "guide_theme" | "house_rules"
  | "address" | "maps_url" | "garage_maps_url" | "city" | "state" | "country"
  | "default_language" | "published"
  | "access_mode" | "pin_code" | "require_access_gate"
  | "collect_arrival_time" | "collect_vehicles" | "vehicles_max"
  | "collect_document" | "document_scope"
  | "property_type_id" | "owner_contact_id"
  | "cleaning_price_normal_cents" | "cleaning_price_full_cents"
  | "cleaning_duration_normal_minutes" | "cleaning_duration_full_minutes";

type FieldKind =
  | "text" | "textarea" | "theme" | "language" | "access_mode" | "boolean" | "collect" | "docscope" | "number"
  | "select_owner" | "select_property_type" | "money" | "duration";
type FieldDef = { key: FieldKey; label: string; kind: FieldKind; placeholder?: string };

type ListKey = "manual" | "checkout" | "emergency" | "faqs" | "property_details";

type SubGroup = { id: string; title: string; fields: FieldDef[] };

type Group = {
  id: string;
  title: string;
  desc?: string;
  icon?: SectionIcon;
  fields?: FieldDef[];
  subgroups?: SubGroup[];
  lists?: ListKey[];
};

/** Todos os campos de um quadrante (soltos + agrupados em sub-quadros). */
function groupFields(g: Group): FieldDef[] {
  return [...(g.fields ?? []), ...(g.subgroups ?? []).flatMap((s) => s.fields)];
}


/** Mesma organização (abas + quadrantes + ordem dos campos) do editor individual. */
const TEXT_TABS: { id: string; label: string; groups: Group[] }[] = [
  {
    id: "house", label: "A casa",
    groups: [
      // Mesma ordem de quadrantes da aba "A casa" do editor individual
      // (admin.properties.$id.tsx) — precisa ser espelho fiel. "Calendário e
      // reservas (Airbnb)" fica de fora de propósito: cada imóvel tem seu
      // PRÓPRIO link de iCal, e aplicar o mesmo link em vários guias de uma
      // vez quebraria a sincronização de reservas de todos eles.
      {
        id: "identity", title: "Identificação do Imóvel", icon: Home,
        desc: "Proprietário e tipo do imóvel.",
        fields: [
          { key: "owner_contact_id", label: "Proprietário", kind: "select_owner" },
          { key: "property_type_id", label: "Tipo do imóvel", kind: "select_property_type" },
        ],
      },
      {
        id: "cleaning", title: "Custos e Duração da Limpeza", icon: Sparkles,
        desc: "Valores fixos cobrados e o período estimado de cada tipo de limpeza.",
        fields: [
          { key: "cleaning_price_normal_cents", label: "Valor (R$) — Limpeza normal", kind: "money" },
          { key: "cleaning_duration_normal_minutes", label: "Prazo estimado — Limpeza normal", kind: "duration" },
          { key: "cleaning_price_full_cents", label: "Valor (R$) — Limpeza completa", kind: "money" },
          { key: "cleaning_duration_full_minutes", label: "Prazo estimado — Limpeza completa", kind: "duration" },
        ],
      },
      {
        id: "address", title: "Endereço e localização", icon: MapPinned,
        desc: "Cole o link do Google Maps — o endereço é preenchido automaticamente.",
        fields: [
          { key: "maps_url", label: "Link do Google Maps — Entrada principal", kind: "text" },
          { key: "garage_maps_url", label: "Link do Google Maps — Garagem (opcional)", kind: "text" },
          { key: "address", label: "Endereço", kind: "textarea" },
          { key: "city", label: "Cidade", kind: "text" },
          { key: "country", label: "País", kind: "text" },
          { key: "address_note", label: "Observação sobre o endereço", kind: "textarea" },
        ],
      },
      {
        id: "house-rules", title: "Regras do espaço", icon: ClipboardCheck,
        desc: "Uma regra por linha — cada linha vira um item numerado no guia.",
        fields: [{ key: "house_rules", label: "Regras (opcional)", kind: "textarea" }],
      },
      {
        id: "manual", title: "Manual da casa", icon: BookOpen,
        desc: "Instruções de equipamentos e funcionamento.",
        lists: ["manual"],
      },
      {
        id: "property-details", title: "Detalhamento do Imóvel", icon: NotebookPen,
        desc: "Base de conhecimento livre: micro detalhes que a IA usa e que não aparecem no guia.",
        lists: ["property_details"],
      },
      {
        id: "host-house", title: "Contato do anfitrião", icon: UserRound,
        desc: "Nome e WhatsApp para o hóspede te encontrar.",
        fields: [
          { key: "host_name", label: "Nome", kind: "text" },
          { key: "host_phone", label: "Telefone (WhatsApp)", kind: "text" },
        ],
      },
    ],
  },
  {
    id: "guide", label: "O guia",
    groups: [
      {
        id: "access-mode", title: "Modo de acesso", icon: Shield,
        desc: "Quem pode visualizar este guia.",
        fields: [
          { key: "access_mode", label: "Modo de acesso do Guia", kind: "access_mode" },
          { key: "pin_code", label: "Código de acesso", kind: "text" },
        ],
      },
    ],
  },
  {
    id: "checkin", label: "Checkin",
    groups: [
      {
        id: "checkin-instr", title: "Instruções de chegada", icon: DoorOpen,
        desc: "Passo a passo do check-in. Uma etapa por linha.",
        fields: [{ key: "checkin_instructions", label: "Passo a passo (opcional)", kind: "textarea" }],
      },
      {
        id: "checkin-times", title: "Horários de check-in", icon: Clock,
        desc: "Janela de chegada.",
        fields: [
          { key: "checkin_time", label: "Check-in a partir de", kind: "text", placeholder: "15:00" },
          { key: "checkin_time_max", label: "Check-in até", kind: "text", placeholder: "22:00" },
          { key: "checkin_note", label: "Observação do check-in (opcional)", kind: "textarea" },
        ],
      },
      {
        id: "access-codes", title: "Senhas de Acesso", icon: KeyRound,
        desc: "Códigos de portão e fechadura, mais o código que libera as senhas no Guia.",
        subgroups: [
          {
            id: "gate", title: "Portão",
            fields: [
              { key: "gate_code", label: "Código do portão", kind: "text" },
              { key: "gate_label", label: "Defina um nome", kind: "text" },
              { key: "gate_instructions", label: "Passo a passo (opcional)", kind: "textarea" },
            ],
          },
          {
            id: "lock", title: "Fechadura",
            fields: [
              { key: "lock_code", label: "Código da fechadura", kind: "text" },
              { key: "lock_label", label: "Defina um nome", kind: "text" },
              { key: "lock_instructions", label: "Passo a passo (opcional)", kind: "textarea" },
            ],
          },
        ],
        fields: [
          { key: "access_codes_pin", label: "Senha para liberar códigos e Wi-Fi", kind: "text" },
        ],
      },

      {
        id: "wifi", title: "Wi-Fi", icon: Wifi,
        desc: "Rede e senha exibidas no card de Wi-Fi do guia público.",
        fields: [
          { key: "wifi_ssid", label: "Rede (SSID)", kind: "text" },
          { key: "wifi_password", label: "Senha", kind: "text" },
        ],
      },
      {
        id: "guest-data", title: "Dados do hóspede", icon: ClipboardList,
        desc: "O que é coletado no formulário de primeiro acesso.",
        fields: [
          { key: "collect_arrival_time", label: "Horário previsto de chegada", kind: "collect" },
          { key: "collect_vehicles", label: "Veículo(s)", kind: "collect" },
          { key: "vehicles_max", label: "Qtd. máxima de veículos", kind: "number" },
          { key: "collect_document", label: "Documento pessoal", kind: "collect" },
          { key: "document_scope", label: "Documentos: hóspedes", kind: "docscope" },
        ],
      },
    ],
  },
  {
    id: "checkout", label: "Checkout",
    groups: [
      {
        id: "checkout-instr", title: "Instruções de saída", icon: LogOut,
        desc: "Passo a passo do check-out. Uma etapa por linha.",
        fields: [{ key: "checkout_instructions", label: "Passo a passo (opcional)", kind: "textarea" }],
      },
      {
        id: "checkout-times", title: "Horários de check-out", icon: Clock,
        desc: "Janela de saída.",
        fields: [
          { key: "checkout_time_min", label: "Check-out a partir de", kind: "text", placeholder: "08:00" },
          { key: "checkout_time", label: "Check-out até", kind: "text", placeholder: "11:00" },
          { key: "checkout_note", label: "Observação do check-out (opcional)", kind: "textarea" },
        ],
      },
      {
        id: "checkout-list", title: "Checklist de check-out", icon: ClipboardCheck,
        desc: "O que o hóspede deve fazer antes de sair.",
        lists: ["checkout"],
      },
    ],
  },
  {
    id: "faq", label: "FAQ & Contatos",
    groups: [
      {
        id: "emergency", title: "Emergências", icon: Phone,
        desc: "Telefones úteis em caso de urgência.",
        lists: ["emergency"],
      },
      {
        id: "faqs", title: "Perguntas frequentes", icon: HelpCircle,
        desc: "Antecipe dúvidas comuns dos hóspedes.",
        lists: ["faqs"],
      },
      {
        id: "host-faq", title: "Contato do anfitrião", icon: UserRound,
        desc: "Nome e WhatsApp para o hóspede te encontrar.",
        fields: [
          { key: "host_name", label: "Nome", kind: "text" },
          { key: "host_phone", label: "Telefone (WhatsApp)", kind: "text" },
        ],
      },
    ],
  },
  { id: "recs", label: "Recomendações", groups: [] },
];



type State = {
  enabled: Partial<Record<FieldKey, boolean>>;
  values: Partial<Record<FieldKey, string | boolean | number | null>>;
  listsEnabled: Partial<Record<ListKey, boolean>>;
  manual: Array<{ title: string; description: string; body: string }>;
  emergency: Array<{ label: string; number: string }>;
  faqs: Array<{ question: string; answer: string; tags: string }>;
  checkout: Array<{ label: string }>;
  property_details: Array<{ title: string; content: string }>;
};

const emptyState: State = {
  enabled: {}, values: {}, listsEnabled: {},
  manual: [], emergency: [], faqs: [], checkout: [], property_details: [],
};

type FetchData = Awaited<ReturnType<typeof bulkFetchProperties>>;

const ALL_FIELDS: FieldDef[] = TEXT_TABS.flatMap((t) => t.groups.flatMap((g) => groupFields(g)));

/**
 * Pré-carrega o popup com o que já existe nos guias selecionados: o campo
 * aparece sempre preenchido com o valor atual (quando os guias divergem, o
 * campo fica vazio com aviso — nada é sobrescrito sem edição explícita).
 */
function buildInitialState(d: FetchData): State {
  const enabled: State["enabled"] = {};
  const values: State["values"] = {};
  for (const f of ALL_FIELDS) {
    // Sem chaves: todo campo já nasce editável. Basta preencher (ou apagar).
    enabled[f.key] = true;
    const distinct = new Set<string>();
    let filled = 0;
    let sample: string | boolean | number | undefined;
    for (const p of d.properties) {
      const raw = (p as Record<string, unknown>)[f.key];
      if (raw === null || raw === undefined || raw === "") continue;
      if (f.kind === "boolean" && raw === false) continue;
      filled += 1;
      distinct.add(String(raw));
      if (sample === undefined) sample = raw as string | boolean | number;
    }
    if (filled === 0) continue;
    // Valores divergentes entre os guias: mostramos o campo vazio (ou nulo,
    // pros campos de dinheiro/duração) para não sobrescrever informações
    // específicas sem intenção — só grava de fato o que a pessoa preencher.
    values[f.key] = distinct.size === 1
      ? (sample as string | boolean | number)
      : f.kind === "boolean" ? false
      : f.kind === "number" ? 0
      : f.kind === "money" || f.kind === "duration" ? null
      : "";
  }
  const listsEnabled: State["listsEnabled"] = { manual: true, emergency: true, faqs: true, checkout: true, property_details: true };
  const propertyIds = d.properties.map((property) => property.id);
  const commonList = <T extends Record<string, unknown>, R>(
    rows: T[],
    map: (row: T) => R,
  ): R[] => {
    const byProperty = propertyIds.map((propertyId) => rows.filter((row) => row.property_id === propertyId).map(map));
    const first = byProperty[0] ?? [];
    return byProperty.every((items) => JSON.stringify(items) === JSON.stringify(first)) ? first : [];
  };
  const listItems = d.listItems;
  return {
    ...emptyState,
    enabled,
    values,
    listsEnabled,
    manual: commonList(listItems.manual, (row) => ({
      title: String(row.title ?? ""), description: String(row.description ?? ""), body: String(row.body ?? ""),
    })),
    emergency: commonList(listItems.emergency, (row) => ({
      label: String(row.label ?? ""), number: String(row.number ?? ""),
    })),
    faqs: commonList(listItems.faqs, (row) => ({
      question: String(row.question ?? ""), answer: String(row.answer ?? ""),
      tags: Array.isArray(row.tags) ? row.tags.join(", ") : "",
    })),
    checkout: commonList(listItems.checkout, (row) => ({ label: String(row.label ?? "") })),
    property_details: commonList(listItems.property_details, (row) => ({
      title: String(row.title ?? ""), content: String(row.content ?? ""),
    })),
  };
}




export function BulkEditDialog({
  open, onOpenChange, ids, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ids: string[];
  onSaved?: () => void;
}) {
  const apply = useServerFn(bulkUpdateProperties);
  const fetchFn = useServerFn(bulkFetchProperties);
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>(emptyState);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FetchData | null>(null);

  // Proprietários ativos da conta, pro seletor do quadrante "Identificação
  // do Imóvel" — mesma fonte usada no editor individual.
  const listOwnersFn = useServerFn(listActivePropertyOwnersForSelect);
  const { data: ownersData } = useQuery({
    queryKey: ["property-owners-select"],
    queryFn: () => listOwnersFn(),
    staleTime: 30_000,
  });
  const ownerOptions = ownersData?.owners ?? [];

  // Sem salvamento automático de propósito: uma edição em massa afeta vários
  // guias de uma vez, então só grava quando a pessoa clica em "Salvar
  // alterações" — com uma confirmação explícita antes de aplicar.
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSummary, setConfirmSummary] = useState<{ fields: number; lists: number } | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  // Aba atual controlada: o popup precisa lembrar onde a pessoa parou mesmo
  // que o componente pai re-renderize (refetch, troca de aba do navegador…).
  const [tab, setTab] = useState<string>(TEXT_TABS[0]?.id ?? "house");

  // `ids` é um array novo a cada render do pai — usar a chave estável evita
  // recarregar (e resetar) o popup sem necessidade.
  const idsKey = ids.join(",");
  const loadedKeyRef = useRef<string | null>(null);
  // Quais campos vieram preenchidos ao abrir: desligar a chave de um deles
  // significa "remover essa informação dos guias selecionados".
  const initialEnabledRef = useRef<Partial<Record<FieldKey, boolean>>>({});
  // Só salvamos o que a pessoa realmente editou — assim campos com valores
  // diferentes entre os guias nunca são sobrescritos por engano.
  const dirtyRef = useRef<Set<FieldKey>>(new Set());
  const dirtyListsRef = useRef<Set<ListKey>>(new Set());
  // Versão de cada campo editado. Um save antigo nunca pode limpar a marca de
  // uma alteração mais nova feita enquanto a requisição ainda estava rodando.
  const fieldVersionRef = useRef<Partial<Record<FieldKey, number>>>({});
  const editVersionRef = useRef(0);
  const listVersionRef = useRef<Partial<Record<ListKey, number>>>({});
  // Serializa as gravações para impedir que uma resposta antiga sobrescreva a
  // edição mais recente quando a conexão está lenta.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Guias-alvo congelados no momento em que o popup carregou: se a seleção da
  // tela de trás mudar (ou for limpa) enquanto o popup está aberto, o
  // salvamento automático continua gravando nos guias certos.
  const [targetIds, setTargetIds] = useState<string[]>([]);

  function load(force = false) {
    if (ids.length === 0) return;
    if (!force && loadedKeyRef.current === idsKey) return;
    loadedKeyRef.current = idsKey;
    setLoading(true);
    setData(null);
    const loadingIds = idsKey.split(",");
    fetchFn({ data: { ids: loadingIds } })
      .then((d) => {
        setTargetIds(loadingIds);
        setData(d);
        const init = buildInitialState(d);
        initialEnabledRef.current = { ...init.enabled };
        dirtyRef.current = new Set();
        dirtyListsRef.current = new Set();
         fieldVersionRef.current = {};
         editVersionRef.current = 0;
        setState(init);
        setIsDirty(false);
        setSaveStatus("idle");
        setSaveError(null);
      })
      .catch(() => toast.error("Erro ao carregar dados dos guias"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey]);



  function reset() {
    setState(emptyState);
    setData(null);
    setTargetIds([]);
    dirtyRef.current = new Set();
    dirtyListsRef.current = new Set();
    fieldVersionRef.current = {};
    editVersionRef.current = 0;
    listVersionRef.current = {};
    saveQueueRef.current = Promise.resolve();
    loadedKeyRef.current = null;
    setTab(TEXT_TABS[0]?.id ?? "house");
    setIsDirty(false);
    setSaveStatus("idle");
    setSaveError(null);
  }

  // Ligar a chave NÃO propaga valor nenhum: ela só habilita a edição (e,
  // quando desligada, marca a informação para remoção). Sem isso, ligar um
  // bloco copiava o valor de um imóvel para todos os outros selecionados.
  function toggle(field: FieldKey, v: boolean) {
    if (!v) dirtyRef.current.delete(field);
    setIsDirty(true);
    setSaveStatus("idle");
    setState((s) => ({ ...s, enabled: { ...s.enabled, [field]: v } }));
  }
  function setValue(field: FieldKey, value: string | boolean | number | null) {
    dirtyRef.current.add(field);
    editVersionRef.current += 1;
    fieldVersionRef.current[field] = editVersionRef.current;
    setIsDirty(true);
    setSaveStatus("idle");
    setState((s) => ({ ...s, values: { ...s.values, [field]: value } }));
  }
  function markListDirty(list: ListKey) {
    dirtyListsRef.current.add(list);
    editVersionRef.current += 1;
    listVersionRef.current[list] = editVersionRef.current;
    setIsDirty(true);
    setSaveStatus("idle");
  }



  // Sumário dos valores atuais calculado UMA vez por carga de dados — antes
  // era recalculado por campo a cada render, o que travava o popup.
  const summaries = useMemo(() => {
    const map = new Map<string, { filled: number; empty: number; distinct: string[] }>();
    if (!data) return map;
    for (const p of data.properties) {
      for (const [key, v] of Object.entries(p as Record<string, unknown>)) {
        let e = map.get(key);
        if (!e) { e = { filled: 0, empty: 0, distinct: [] }; map.set(key, e); }
        if (v === null || v === undefined || v === "") e.empty += 1;
        else {
          e.filled += 1;
          const s = String(v);
          if (!e.distinct.includes(s)) e.distinct.push(s);
        }
      }
    }
    return map;
  }, [data]);

  function fieldSummary(key: FieldKey): { filled: number; empty: number; distinct: string[] } {
    return summaries.get(key) ?? { filled: 0, empty: data?.properties.length ?? 0, distinct: [] };
  }


  /** Campos que vieram preenchidos e foram desligados → serão removidos. */
  const removedFields = useMemo(() => {
    const out: FieldDef[] = [];
    for (const t of TEXT_TABS) {
      for (const g of t.groups) {
        for (const f of groupFields(g)) {
          if (initialEnabledRef.current[f.key] && !state.enabled[f.key]) out.push(f);
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, ids.length]);






  function coerce(f: FieldDef, v: string | boolean | number | null | undefined): unknown {
    if (f.kind === "boolean") return v === true;
    if (f.kind === "theme") return v === "light" ? "light" : "dark";
    if (f.kind === "language") return v === "en" ? "en" : "pt";
    if (f.kind === "access_mode") return v === "pin" ? "pin" : "public";
    if (f.kind === "collect") return v === "required" ? "required" : v === "optional" ? "optional" : "off";
    if (f.kind === "docscope") return v === "all" ? "all" : "main";
    if (f.kind === "number") return typeof v === "number" ? v : parseInt(String(v ?? "0"), 10) || 0;
    // Dinheiro/duração: "sem valor" é um estado válido (ex.: limpeza sem
    // preço combinado ainda) — ao contrário de "number", aqui vazio vira
    // null de verdade, não 0.
    if (f.kind === "money" || f.kind === "duration") return typeof v === "number" ? v : null;
    return v === undefined || v === null ? "" : v;
  }

  /**
   * Salvamento automático (igual às outras telas): aplica nos guias
   * selecionados só o que foi editado agora, sobrescrevendo o valor.
   */
  async function saveAuto(snapshot: State) {
    if (!data || targetIds.length === 0) return;
    const dirtyAtStart = new Set(dirtyRef.current);
    const dirtyListsAtStart = new Set(dirtyListsRef.current);
    const versionsAtStart = { ...fieldVersionRef.current };
    const listVersionsAtStart = { ...listVersionRef.current };
    const patch: Record<string, unknown> = {};
    for (const f of ALL_FIELDS) {
      // Só entra no patch o que a pessoa editou agora, neste popup.
      if (!dirtyAtStart.has(f.key)) continue;
      if (!snapshot.enabled[f.key]) continue;
      patch[f.key] = coerce(f, snapshot.values[f.key]);
    }

    // Bloco desligado = remover essas informações dos guias selecionados.
    for (const f of removedFields) {
      patch[f.key] = f.kind === "boolean" ? false : f.kind === "number" ? 0 : "";
    }

    const lists: Record<string, unknown> = {};
    if (dirtyListsAtStart.has("manual") && (snapshot.manual.length === 0 || snapshot.manual.every((m) => m.title.trim())))
      lists.manual = snapshot.manual.map((m) => ({
        title: m.title.trim(), description: m.description.trim() || null, body: m.body.trim() || null,
      }));
    if (dirtyListsAtStart.has("emergency") && (snapshot.emergency.length === 0 || snapshot.emergency.every((e) => e.label.trim() && e.number.trim())))
      lists.emergency = snapshot.emergency
        .map((e) => ({ label: e.label.trim(), number: e.number.trim() }));
    if (dirtyListsAtStart.has("faqs") && (snapshot.faqs.length === 0 || snapshot.faqs.every((f) => f.question.trim() && f.answer.trim())))
      lists.faqs = snapshot.faqs.map((f) => ({
        question: f.question.trim(), answer: f.answer.trim(),
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      }));
    if (dirtyListsAtStart.has("checkout") && (snapshot.checkout.length === 0 || snapshot.checkout.every((c) => c.label.trim())))
      lists.checkout = snapshot.checkout.map((c) => ({ label: c.label.trim() }));
    if (dirtyListsAtStart.has("property_details") && (snapshot.property_details.length === 0 || snapshot.property_details.every((pd) => pd.content.trim())))
      lists.property_details = snapshot.property_details.map((pd) => ({
        title: pd.title.trim() || null, content: pd.content.trim(),
      }));

    if (Object.keys(patch).length === 0 && Object.keys(lists).length === 0) return;

    setSaving(true);
    try {
      const queuedSave = saveQueueRef.current.then(() =>
        apply({ data: { ids: targetIds, patch, lists: Object.keys(lists).length ? lists : undefined, mode: "overwrite" } }),
      );
      saveQueueRef.current = queuedSave.then(() => undefined, () => undefined);
      const result = await queuedSave;
      if (result.updated !== targetIds.length) {
        throw new Error(`A alteração foi confirmada em ${result.updated} de ${targetIds.length} guias.`);
      }
      // Mantém o preview do próprio popup sincronizado com o que acabou de
      // ser persistido. Antes, os campos controlados mostravam o valor novo,
      // mas os resumos/chaves continuavam baseados no snapshot da abertura.
      if (Object.keys(patch).length > 0) {
        setData((current) => current ? {
          ...current,
          properties: current.properties.map((property) => ({ ...property, ...patch }) as typeof property),
        } : current);
        for (const [key, value] of Object.entries(patch)) {
          const field = ALL_FIELDS.find((candidate) => candidate.key === key);
          if (!field) continue;
          initialEnabledRef.current[field.key] =
            value !== null && value !== undefined && value !== "" && !(field.kind === "boolean" && value === false);
        }
      }
      for (const key of dirtyAtStart) {
        if (fieldVersionRef.current[key] !== versionsAtStart[key]) continue;
        dirtyRef.current.delete(key);
        delete fieldVersionRef.current[key];
      }
      for (const key of dirtyListsAtStart) {
        if (listVersionRef.current[key] !== listVersionsAtStart[key]) continue;
        dirtyListsRef.current.delete(key);
        delete listVersionRef.current[key];
      }
      // O editor individual não pode abrir com um snapshot anterior e, pelo
      // autosave dele, gravar esse snapshot por cima da edição em massa.
      for (const propertyId of targetIds) {
        queryClient.removeQueries({ queryKey: ["property", propertyId], exact: true, type: "inactive" });
        void queryClient.invalidateQueries({ queryKey: ["property", propertyId], exact: true });
      }
      onSaved?.();
    } catch (err) {
      // Antes o erro passava batido e o indicador continuava dizendo "Salvo".
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar as alterações nos guias selecionados.");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  /**
   * "Salvar alterações": só dispara depois da confirmação explícita no
   * AlertDialog — sem salvamento automático. Uma edição em massa aplica a
   * MESMA alteração em vários guias de uma vez (SÓ os campos/listas
   * realmente editados neste popup; valores divergentes entre os guias
   * viram vazio até a pessoa preencher — nunca ficam sobrescritos sem
   * intenção), então merece um passo deliberado antes de gravar de verdade.
   */
  function handleSaveClick() {
    if (saving || !isDirty) return;
    setConfirmSummary({ fields: dirtyRef.current.size, lists: dirtyListsRef.current.size });
    setConfirmOpen(true);
  }

  async function confirmAndSave() {
    setConfirmOpen(false);
    setSaveStatus("saving");
    setSaveError(null);
    try {
      await saveAuto(state);
      await saveQueueRef.current;
      setSaveStatus("saved");
      setIsDirty(dirtyRef.current.size > 0 || dirtyListsRef.current.size > 0);
    } catch (e) {
      setSaveStatus("error");
      setSaveError(e instanceof Error ? e.message : "Erro desconhecido");
    }
  }

  function requestClose() {
    if (saving) return;
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    reset();
    onOpenChange(false);
  }

  function confirmDiscardAndClose() {
    setDiscardConfirmOpen(false);
    reset();
    onOpenChange(false);
  }

  /**
   * Campos dependentes só aparecem quando a coleta correspondente está
   * ativada (Opcional/Obrigatório).
   */
  function isFieldVisible(key: FieldKey): boolean {
    const on = (v: unknown) => v === "optional" || v === "required";
    if (key === "vehicles_max") return on(state.values.collect_vehicles);
    if (key === "document_scope") return on(state.values.collect_document);
    return true;
  }

  /** Conteúdo de um campo. A chave fica apenas no bloco (ligar/desligar). */
  function fieldBlock(f: FieldDef, showSwitch: boolean) {
    const enabled = !!state.enabled[f.key];
    const value = state.values[f.key];
    const s2 = fieldSummary(f.key);
    const willRemove = showSwitch && !enabled && !!initialEnabledRef.current[f.key];
    const mixed = s2.distinct.length > 1;
    // Senhas, Wi-Fi, endereço e mapas são exclusivos de cada residência:
    // com vários guias selecionados o campo fica travado.
    return (
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <label className="block truncate text-[13px] font-normal">{f.label}</label>
            <div className={`text-[11px] mt-0.5 truncate ${willRemove ? "text-destructive" : "text-muted-foreground"}`}>
              {willRemove
                ? "Será removido dos guias selecionados"
                : mixed
                  ? `${s2.distinct.length} valores diferentes — preencha para igualar em todos`
                  : s2.filled > 0
                    ? (s2.empty > 0 ? `${s2.filled} preenchido${s2.filled > 1 ? "s" : ""} · ${s2.empty} vazio${s2.empty > 1 ? "s" : ""}` : "Valor atual")
                    : `${s2.empty} guia${s2.empty > 1 ? "s" : ""} sem valor`}
            </div>
          </div>
          {showSwitch && <Switch checked={enabled} onCheckedChange={(v) => toggle(f.key, v)} />}
        </div>
        {(!showSwitch || enabled) && (
          <div className="mt-2">{renderField(f, value, (v) => setValue(f.key, v), ownerOptions)}</div>
        )}
        {f.key === "owner_contact_id" && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3 shrink-0 mt-0.5" />
            Troca o proprietário vinculado diretamente nos guias selecionados, sem o fluxo de confirmação de
            "Transferir" usado no editor individual. Confira a seleção antes de salvar.
          </p>
        )}
      </div>
    );
  }




  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => {
        if (v) onOpenChange(true);
        else requestClose();
      }}
    >
      <ResponsiveDialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-3xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="text-[15px] font-semibold tracking-tight">Editar {targetIds.length || ids.length} {(targetIds.length || ids.length) === 1 ? "guia" : "guias"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-xs font-normal leading-relaxed">
            {loading
              ? "Carregando dados dos guias selecionados…"
              : "As informações atuais já aparecem preenchidas. Qualquer alteração é salva automaticamente nos guias selecionados."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>


        {loading ? (
          <div className="py-10 grid place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
        <Tabs value={tab} onValueChange={setTab} className="w-full min-w-0">
          {/* Mesmo padrão usado no resto do sistema (ds-scroll-x): os itens
              mantêm o tamanho natural (flex: none) e a barra inteira rola por
              baixo em telas estreitas, em vez de espremer tudo (flex-1) num
              container de largura fixa (w-max) — isso cortava a última aba
              em celulares mais estreitos. */}
          <TabsList className="ds-scroll-x mb-5 -mx-1 px-1 h-auto gap-0 rounded-[0.3rem] bg-foreground/5 p-0">
            {TEXT_TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="min-h-[34px] whitespace-nowrap rounded-none px-3 text-xs font-normal shadow-none data-[state=active]:shadow-none data-[state=active]:bg-gradient-to-br data-[state=active]:from-[#7C1AD8] data-[state=active]:to-[#E82DAE] data-[state=active]:text-white"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>


          {TEXT_TABS.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="space-y-4 pt-4 min-w-0">
              {tab.groups.length === 0 && (
                <p className="rounded-[0.3rem] border border-border bg-card/40 p-3 text-xs text-muted-foreground">
                  As recomendações são específicas de cada residência (endereço, distância e horários) e por isso
                  não podem ser aplicadas em massa. Edite-as no guia individual.
                </p>
              )}

              <SectionGroup>
                <div className="space-y-4">
                {tab.groups.map((group) => {
                  const gLists = group.lists ?? [];
                  return (
                  <Section
                    key={group.id}
                    id={`${tab.id}-${group.id}`}
                    icon={group.icon}
                    title={group.title}
                    desc={group.desc}
                    dense
                    collapsible
                  >
                  <>

                  {(group.subgroups ?? []).map((sg) => (
                    <div
                      key={sg.id}
                      className="rounded-[0.3rem] border border-border bg-card/40 p-3 min-w-0"
                    >
                      <div className="mb-2 truncate text-[13px] font-normal">{sg.title}</div>
                      <div className="divide-y divide-border/60">
                        {sg.fields.filter((f) => isFieldVisible(f.key)).map((f) => (
                          <div key={f.key} className="py-2.5 first:pt-0 last:pb-0">
                            {fieldBlock(f, false)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {(group.fields ?? []).length > 0 && (
                    <div className="rounded-[0.3rem] border border-border bg-card/40 p-3 min-w-0 divide-y divide-border/60">
                      {(group.fields ?? []).filter((f) => isFieldVisible(f.key)).map((f) => (
                        <div key={f.key} className="py-2.5 first:pt-0 last:pb-0">
                          {fieldBlock(f, false)}
                        </div>
                      ))}
                    </div>
                  )}

                  {gLists.map((lk) => (
                    <div key={lk} className="min-w-0">
                      {renderList(lk, state, setState, () => markListDirty(lk))}
                    </div>
                  ))}
                  </>


                  </Section>
                  );
                })}
                </div>
              </SectionGroup>

            </TabsContent>
          ))}
        </Tabs>
        )}

        <ResponsiveDialogFooter>
          <div className="mr-auto flex items-center gap-2">
            <AutosaveIndicator status={saveStatus} errorMessage={saveError} />
            {saveStatus === "idle" && isDirty && (
              <span className="text-[11px] text-muted-foreground">Alterações não salvas</span>
            )}
          </div>
          <Button variant="outline" onClick={requestClose} disabled={saving}>
            Fechar
          </Button>
          <Button onClick={handleSaveClick} disabled={saving || !isDirty}>
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            Salvar alterações
          </Button>
        </ResponsiveDialogFooter>
        </>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar alteração em massa</AlertDialogTitle>
              <AlertDialogDescription>
                Isso vai sobrescrever {confirmSummary?.fields ?? 0} campo{(confirmSummary?.fields ?? 0) === 1 ? "" : "s"} e{" "}
                {confirmSummary?.lists ?? 0} lista{(confirmSummary?.lists ?? 0) === 1 ? "" : "s"} em{" "}
                {targetIds.length} guia{targetIds.length === 1 ? "" : "s"} selecionado{targetIds.length === 1 ? "" : "s"},
                eliminando qualquer conteúdo atual desses campos/listas e colocando só o valor que está sendo salvo agora.
                Guias com valores divergentes entre si também serão igualados. Essa ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => void confirmAndSave()}>Confirmar e salvar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Descartar alterações não salvas?</AlertDialogTitle>
              <AlertDialogDescription>
                Você editou campos que ainda não foram salvos. Fechar agora descarta essas alterações — elas não
                afetarão os guias selecionados.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuar editando</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDiscardAndClose}>Descartar e fechar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function renderList(k: ListKey, state: State, setState: React.Dispatch<React.SetStateAction<State>>, markDirty: () => void) {
  if (k === "manual") {
    return (
      <div className="space-y-2 mt-2">
        {state.manual.map((m, i) => (
          <div key={i} className="rounded-lg border border-border p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <Input value={m.title} placeholder="Título" className="h-8 text-sm"
                onChange={(e) => { markDirty(); setState((s) => ({ ...s, manual: s.manual.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })); }} />
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => { markDirty(); setState((s) => ({ ...s, manual: s.manual.filter((_, j) => j !== i) })); }}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <Input value={m.description} placeholder="Descrição curta (opcional)" className="h-8 text-xs"
              onChange={(e) => { markDirty(); setState((s) => ({ ...s, manual: s.manual.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })); }} />
            <Textarea value={m.body} placeholder="Instruções detalhadas (opcional)" rows={2} className="text-xs"
              onChange={(e) => { markDirty(); setState((s) => ({ ...s, manual: s.manual.map((x, j) => j === i ? { ...x, body: e.target.value } : x) })); }} />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => { markDirty(); setState((s) => ({ ...s, manual: [...s.manual, { title: "", description: "", body: "" }] })); }}>
          <Plus className="size-3.5 mr-1" /> Adicionar item
        </Button>
      </div>
    );
  }
  if (k === "checkout") {
    return (
      <div className="space-y-2 mt-2">
        {state.checkout.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={c.label} placeholder="Ex.: Deixar as chaves na fechadura" className="h-8 text-sm"
              onChange={(e) => { markDirty(); setState((s) => ({ ...s, checkout: s.checkout.map((x, j) => j === i ? { label: e.target.value } : x) })); }} />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => { markDirty(); setState((s) => ({ ...s, checkout: s.checkout.filter((_, j) => j !== i) })); }}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => { markDirty(); setState((s) => ({ ...s, checkout: [...s.checkout, { label: "" }] })); }}>
          <Plus className="size-3.5 mr-1" /> Adicionar item
        </Button>
      </div>
    );
  }
  if (k === "emergency") {
    return (
      <div className="space-y-2 mt-2">
        {state.emergency.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={c.label} placeholder="Ex.: SAMU" className="h-8 text-sm"
              onChange={(e) => { markDirty(); setState((s) => ({ ...s, emergency: s.emergency.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })); }} />
            <Input value={c.number} placeholder="Número" className="h-8 text-sm max-w-[160px]"
              onChange={(e) => { markDirty(); setState((s) => ({ ...s, emergency: s.emergency.map((x, j) => j === i ? { ...x, number: e.target.value } : x) })); }} />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => { markDirty(); setState((s) => ({ ...s, emergency: s.emergency.filter((_, j) => j !== i) })); }}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => { markDirty(); setState((s) => ({ ...s, emergency: [...s.emergency, { label: "", number: "" }] })); }}>
          <Plus className="size-3.5 mr-1" /> Adicionar contato
        </Button>
      </div>
    );
  }
  if (k === "faqs") {
    return (
      <div className="space-y-2 mt-2">
        {state.faqs.map((f, i) => (
          <div key={i} className="rounded-lg border border-border p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <Input value={f.question} placeholder="Pergunta" className="h-8 text-sm"
                onChange={(e) => { markDirty(); setState((s) => ({ ...s, faqs: s.faqs.map((x, j) => j === i ? { ...x, question: e.target.value } : x) })); }} />
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => { markDirty(); setState((s) => ({ ...s, faqs: s.faqs.filter((_, j) => j !== i) })); }}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <Textarea value={f.answer} placeholder="Resposta" rows={2} className="text-xs"
              onChange={(e) => { markDirty(); setState((s) => ({ ...s, faqs: s.faqs.map((x, j) => j === i ? { ...x, answer: e.target.value } : x) })); }} />
            <Input value={f.tags} placeholder="Tags separadas por vírgula" className="h-7 text-[11px]"
              onChange={(e) => { markDirty(); setState((s) => ({ ...s, faqs: s.faqs.map((x, j) => j === i ? { ...x, tags: e.target.value } : x) })); }} />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => { markDirty(); setState((s) => ({ ...s, faqs: [...s.faqs, { question: "", answer: "", tags: "" }] })); }}>
          <Plus className="size-3.5 mr-1" /> Adicionar pergunta
        </Button>
      </div>
    );
  }
  // property_details: mesma simplificação do Manual da casa — só título +
  // conteúdo (sem imagens/áudio, que são específicos de cada imóvel).
  return (
    <div className="space-y-2 mt-2">
      {state.property_details.map((d, i) => (
        <div key={i} className="rounded-lg border border-border p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <Input value={d.title} placeholder="Título (opcional)" className="h-8 text-sm"
              onChange={(e) => { markDirty(); setState((s) => ({ ...s, property_details: s.property_details.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })); }} />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => { markDirty(); setState((s) => ({ ...s, property_details: s.property_details.filter((_, j) => j !== i) })); }}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Textarea value={d.content} placeholder="Conteúdo — micro detalhes que a IA usa" rows={3} className="text-xs"
            onChange={(e) => { markDirty(); setState((s) => ({ ...s, property_details: s.property_details.map((x, j) => j === i ? { ...x, content: e.target.value } : x) })); }} />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => { markDirty(); setState((s) => ({ ...s, property_details: [...s.property_details, { title: "", content: "" }] })); }}>
        <Plus className="size-3.5 mr-1" /> Adicionar item
      </Button>
    </div>
  );
}

function renderField(
  f: FieldDef,
  value: string | boolean | number | null | undefined,
  onChange: (v: string | boolean | number | null) => void,
  ownerOptions?: { id: string; name: string }[],
) {
  if (f.kind === "textarea") {
    return <Textarea value={(value as string) ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} rows={3} className="rounded-[0.3rem] text-[13px]" />;
  }
  if (f.kind === "theme") {
    return <Pills value={value as string} onChange={onChange} options={[["dark","Escuro"],["light","Claro"]]} />;
  }
  if (f.kind === "language") {
    return <Pills value={value as string} onChange={onChange} options={[["pt","Português"],["en","Inglês"]]} />;
  }
  if (f.kind === "access_mode") {
    return <Pills value={value as string} onChange={onChange} options={[["public","Público"],["pin","PIN"]]} />;
  }
  if (f.kind === "collect") {
    return <Pills value={value as string} onChange={onChange} options={[["off","Não pedir"],["optional","Opcional"],["required","Obrigatório"]]} />;
  }
  if (f.kind === "docscope") {
    return <Pills value={value as string} onChange={onChange} options={[["main","Principal"],["all","Todos"]]} />;
  }
  if (f.kind === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Switch checked={!!value} onCheckedChange={(v) => onChange(v)} />
        <span className="text-xs text-muted-foreground">{value ? "Sim" : "Não"}</span>
      </div>
    );
  }
  if (f.kind === "number") {
    return <Input type="number" min={0} max={10} value={(value as number | undefined) ?? ""} onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)} className="h-9 rounded-[0.3rem] text-[13px]" />;
  }
  if (f.kind === "money") {
    return <MoneyInput cents={(value as number | null | undefined) ?? null} onChange={(c) => onChange(c)} />;
  }
  if (f.kind === "duration") {
    const dValue = value != null ? String(value) : "";
    return (
      <Select value={dValue} onValueChange={(v) => onChange(v ? Number(v) : null)}>
        <SelectTrigger>
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          <div className="grid grid-cols-4 gap-1 p-1">
            {CLEANING_DURATION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)} className="justify-center rounded-md px-2 py-1.5 text-center tabular-nums">
                {o.label}
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
    );
  }
  if (f.kind === "select_owner") {
    return (
      <Select value={(value as string) || undefined} onValueChange={(v) => onChange(v)} disabled={!ownerOptions?.length}>
        <SelectTrigger>
          <SelectValue placeholder={ownerOptions?.length ? "Selecione um proprietário" : "Carregando…"} />
        </SelectTrigger>
        <SelectContent>
          {(ownerOptions ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (f.kind === "select_property_type") {
    return <PropertyTypeSelect value={(value as string) || null} onChange={onChange} />;
  }
  return <Input value={(value as string) ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-[0.3rem] text-[13px]" />;
}

function Pills({ value, onChange, options }: { value: string | undefined; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`h-8 inline-flex items-center px-3 rounded-[0.3rem] text-xs font-normal border ${value === v ? "bg-accent text-accent-foreground border-accent" : "border-border"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
