import { friendlyErrorMessage } from "@/lib/friendly-error";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { DenseSections, Section, SectionGroup, type SectionIcon } from "@/components/editor/Section";
import { MoneyInput } from "@/components/ui/money-input";
import { ElevatorSegment, ParkingSpotsInput } from "@/components/editor/CondominiumInputs";
import { PropertyTypeSelect } from "@/components/admin/PropertyTypeSelect";
import {
  Loader2, Plus, Trash2, HelpCircle, AlertTriangle,
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
  | "in_condominium" | "apartment_number" | "apartment_floor" | "parking_spots" | "has_elevator"
  | "default_language" | "published"
  | "access_mode" | "pin_code" | "require_access_gate"
  | "collect_arrival_time" | "collect_vehicles" | "vehicles_max"
  | "collect_document" | "document_scope"
  | "property_type_id" | "owner_contact_id"
  | "cleaning_price_normal_cents" | "cleaning_price_full_cents"
  | "cleaning_duration_normal_minutes" | "cleaning_duration_full_minutes";

type FieldKind =
  | "text" | "textarea" | "theme" | "language" | "access_mode" | "boolean" | "collect" | "docscope" | "number"
  | "select_owner" | "select_property_type" | "money" | "duration"
  // "Local dentro do prédio" (01/10/2026): vagas = lista (no estado, uma por
  // linha) e elevador = Tem / Não tem / não informado (true | false | null).
  | "spots" | "elevator";
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
// Edição em massa alinhada à arquitetura atual (29/10/2026): dados do imóvel
// (endereço, limpeza, check-in/out, senhas, Wi-Fi, regras, contatos) moram no
// Playbook ou vêm do Airbnb via Channex e NÃO são mais editados aqui. Ficam só
// as partes de Guia/Curadoria que fazem sentido aplicar em vários guias.
const TEXT_TABS: { id: string; label: string; groups: Group[] }[] = [
  {
    id: "faq", label: "FAQ",
    groups: [
      {
        id: "faqs", title: "Perguntas frequentes", icon: HelpCircle,
        desc: "Antecipe dúvidas comuns dos hóspedes.",
        lists: ["faqs"],
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
      if (Array.isArray(raw) && raw.length === 0) continue;
      if (f.kind === "boolean" && raw === false) continue;
      filled += 1;
      distinct.add(String(raw));
      if (sample === undefined) {
        // Vagas vêm como lista; no estado do popup viram uma por linha.
        sample = Array.isArray(raw) ? raw.join("\n") : (raw as string | boolean | number);
      }
    }
    if (filled === 0) continue;
    // Valores divergentes entre os guias: mostramos o campo vazio (ou nulo,
    // pros campos de dinheiro/duração) para não sobrescrever informações
    // específicas sem intenção — só grava de fato o que a pessoa preencher.
    values[f.key] = distinct.size === 1
      ? (sample as string | boolean | number)
      : f.kind === "boolean" ? false
      : f.kind === "number" ? 0
      : f.kind === "money" || f.kind === "duration" || f.kind === "elevator" ? null
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
  const [tab, setTab] = useState<string>(TEXT_TABS[0]?.id ?? "faq");

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
    setTab(TEXT_TABS[0]?.id ?? "faq");
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
        if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) e.empty += 1;
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
    // Elevador: "não informado" é um estado válido (null), diferente de "Não tem".
    if (f.kind === "elevator") return typeof v === "boolean" ? v : null;
    // Vagas: uma por linha no estado → lista limpa (o servidor normaliza de novo).
    if (f.kind === "spots") {
      return String(v ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
    }
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
      toast.error(friendlyErrorMessage(err, "Não foi possível salvar as alterações nos guias selecionados."));
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
      setSaveError(friendlyErrorMessage(e));
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
    // Campos do prédio só aparecem com "Condomínio?" ligado.
    if (key === "apartment_number" || key === "apartment_floor" || key === "parking_spots" || key === "has_elevator") {
      return state.values.in_condominium === true;
    }
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
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) onOpenChange(true);
        else requestClose();
      }}
    >
      {/* Janela padrão do projeto (Dialog + casca `ds-overlay`/véu do DialogContent):
          centralizada no celular e no computador, cresce com o conteúdo até 90% da
          tela; só a área do meio rola, cabeçalho e rodapé ficam fixos. */}
      <DialogContent
        className="ds-overlay flex max-h-[90dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden rounded-[14px] border-border/80 bg-card p-0 [scrollbar-gutter:stable] sm:max-w-3xl"
      >
        <>
        {/* Cabeçalho fixo — não rola junto com o conteúdo. */}
        <div className="shrink-0 border-b border-border/60 px-5 py-4">
        <DialogHeader className="pr-8">
          <DialogTitle className="font-display text-[15px] font-bold text-foreground">Editar {targetIds.length || ids.length} {(targetIds.length || ids.length) === 1 ? "guia" : "guias"}</DialogTitle>
          <DialogDescription className="text-[11.5px] text-muted-foreground">
            {loading
              ? "Carregando dados dos guias selecionados…"
              : "As informações atuais já aparecem preenchidas. Qualquer alteração é salva automaticamente nos guias selecionados."}
          </DialogDescription>
        </DialogHeader>
        </div>

        {/* Só essa área central rola — cabeçalho e rodapé ficam sempre
            visíveis, sem precisar descer até o fim do conteúdo. */}
        <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 [scrollbar-gutter:stable]">
        {loading ? (
          <div className="py-10 grid place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
        <DenseSections variant="presence">
        <Tabs value={tab} onValueChange={setTab} className="w-full min-w-0">
          {/* Mesmo padrão usado no resto do sistema (ds-scroll-x): os itens
              mantêm o tamanho natural (flex: none) e a barra inteira rola por
              baixo em telas estreitas, em vez de espremer tudo (flex-1) num
              container de largura fixa (w-max) — isso cortava a última aba
              em celulares mais estreitos. */}
          <TabsList className="ds-segmented mb-2.5 w-full rounded-[9px] bg-card p-0 shadow-[inset_0_0_0_1px_var(--border)] lg:rounded-[13px]">
            {TEXT_TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="relative flex min-h-[40px] items-center justify-center whitespace-nowrap px-3 text-center text-[12.5px] leading-none transition-colors hover:text-foreground data-[state=active]:ds-tab-active data-[state=active]:font-bold data-[state=inactive]:font-semibold data-[state=inactive]:text-muted-foreground"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>


          {TEXT_TABS.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="space-y-2.5 pt-2.5 min-w-0">
              {tab.groups.length === 0 && (
                <p className="rounded-[9px] border border-border/60 bg-muted/20 p-3.5 text-xs text-muted-foreground">
                  As recomendações são específicas de cada residência (endereço, distância e horários) e por isso
                  não podem ser aplicadas em massa. Edite-as no guia individual.
                </p>
              )}

              <SectionGroup>
                <div className="space-y-2.5">
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
                      className="rounded-[9px] border border-border/60 bg-muted/20 p-3.5 min-w-0"
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
                    <div className="rounded-[9px] border border-border/60 bg-muted/20 p-3.5 min-w-0 divide-y divide-border/60">
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
        </DenseSections>
        )}
        <div className="h-4" aria-hidden />
        </div>

        {/* Rodapé fixo — só aparece o botão de salvar quando há algo para
            salvar; "Fechar" fica sempre disponível para sair do popup. */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 bg-card px-5 py-3">
        <DialogFooter className="w-full !flex-row items-center justify-end gap-2 sm:space-x-0">
          <div className="mr-auto flex items-center gap-2">
            <AutosaveIndicator status={saveStatus} errorMessage={saveError} />
            {saveStatus === "idle" && isDirty && (
              <span className="text-[11px] text-muted-foreground">Alterações não salvas</span>
            )}
          </div>
          <Button variant="outline" onClick={requestClose} disabled={saving} className="h-9 rounded-[9px] px-4 text-[12.5px] font-semibold lg:rounded-[13px]">
            Fechar
          </Button>
          {(isDirty || saving) && (
            <Button onClick={handleSaveClick} disabled={saving || !isDirty} className="h-9 rounded-[9px] px-4 text-[12.5px] font-semibold lg:rounded-[13px]">
              {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
              Salvar alterações
            </Button>
          )}
        </DialogFooter>
        </div>
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

      </DialogContent>
    </Dialog>
  );
}

function renderList(k: ListKey, state: State, setState: React.Dispatch<React.SetStateAction<State>>, markDirty: () => void) {
  // Manual da casa, checklist, emergências e detalhamento saíram da edição em
  // massa (moram no Playbook); só as perguntas frequentes continuam aqui.
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
  return null;
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
  if (f.kind === "spots") {
    const list = typeof value === "string" && value !== "" ? value.split("\n") : [];
    return (
      <ParkingSpotsInput
        value={list}
        placeholder={f.placeholder}
        idPrefix="bulk-parking-spot"
        onChange={(next) => onChange(next.join("\n"))}
      />
    );
  }
  if (f.kind === "elevator") {
    return <ElevatorSegment value={typeof value === "boolean" ? value : null} onChange={(v) => onChange(v)} />;
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
