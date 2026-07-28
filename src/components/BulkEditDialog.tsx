import { useEffect, useMemo, useState } from "react";
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
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { bulkUpdateProperties, bulkFetchProperties } from "@/lib/properties.functions";
import { toast } from "sonner";

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
  | "collect_document" | "document_scope";

type FieldKind = "text" | "textarea" | "theme" | "language" | "access_mode" | "boolean" | "collect" | "docscope" | "number";
type FieldDef = { key: FieldKey; label: string; kind: FieldKind; placeholder?: string };

type ListKey = "manual" | "checkout" | "emergency" | "faqs";

const TEXT_TABS: { id: string; label: string; fields: FieldDef[] }[] = [
  {
    id: "house", label: "A casa",
    fields: [
      { key: "address", label: "Endereço completo", kind: "textarea" },
      { key: "maps_url", label: "Link do Google Maps", kind: "text" },
      { key: "garage_maps_url", label: "Link do Maps (garagem)", kind: "text" },
      { key: "city", label: "Cidade", kind: "text" },
      { key: "state", label: "Estado", kind: "text" },
      { key: "country", label: "País", kind: "text" },
      { key: "address_note", label: "Como chegar", kind: "textarea" },
      { key: "house_rules", label: "Regras do espaço", kind: "textarea" },
      { key: "host_name", label: "Nome do anfitrião", kind: "text" },
      { key: "host_phone", label: "Telefone do anfitrião", kind: "text" },
    ],
  },
  {
    id: "guide", label: "O guia",
    fields: [
      { key: "brand_name", label: "Nome da marca", kind: "text" },
      { key: "brand_logo_url", label: "URL do logo (https://)", kind: "text" },
      { key: "guide_theme", label: "Tema do guia", kind: "theme" },
      { key: "default_language", label: "Idioma padrão", kind: "language" },
      { key: "published", label: "Publicado", kind: "boolean" },
      { key: "access_mode", label: "Modo de acesso do guia", kind: "access_mode" },
      { key: "pin_code", label: "PIN (quando modo = PIN)", kind: "text" },
      { key: "require_access_gate", label: "Exigir formulário de primeiro acesso", kind: "boolean" },
    ],
  },
  {
    id: "checkin", label: "Checkin",
    fields: [
      { key: "checkin_instructions", label: "Instruções de check-in", kind: "textarea" },
      { key: "checkin_time", label: "Check-in a partir", kind: "text", placeholder: "15:00" },
      { key: "checkin_time_max", label: "Check-in até", kind: "text", placeholder: "20:00" },
      { key: "checkin_note", label: "Observação de check-in", kind: "textarea" },
      { key: "gate_code", label: "Código do portão", kind: "text" },
      { key: "gate_label", label: "Nome do portão", kind: "text" },
      { key: "gate_instructions", label: "Instruções do portão", kind: "textarea" },
      { key: "lock_code", label: "Código da fechadura", kind: "text" },
      { key: "lock_label", label: "Nome da fechadura", kind: "text" },
      { key: "lock_instructions", label: "Instruções da fechadura", kind: "textarea" },
      { key: "access_codes_pin", label: "Senha para liberar códigos e Wi-Fi", kind: "text" },
      { key: "wifi_ssid", label: "Rede Wi-Fi", kind: "text" },
      { key: "wifi_password", label: "Senha do Wi-Fi", kind: "text" },
      { key: "collect_arrival_time", label: "Horário previsto de chegada", kind: "collect" },
      { key: "collect_vehicles", label: "Veículos", kind: "collect" },
      { key: "vehicles_max", label: "Qtd. máxima de veículos", kind: "number" },
      { key: "collect_document", label: "Documento pessoal", kind: "collect" },
      { key: "document_scope", label: "Documentos: hóspedes", kind: "docscope" },
    ],
  },
  {
    id: "checkout", label: "Checkout",
    fields: [
      { key: "checkout_instructions", label: "Instruções de check-out", kind: "textarea" },
      { key: "checkout_time", label: "Check-out até", kind: "text", placeholder: "11:00" },
      { key: "checkout_time_min", label: "Check-out a partir", kind: "text" },
      { key: "checkout_note", label: "Observação de check-out", kind: "textarea" },
    ],
  },
  { id: "faq", label: "FAQ & Contatos", fields: [] },
];

const TAB_LISTS: Record<string, ListKey[]> = {
  house: ["manual"],
  checkout: ["checkout"],
  faq: ["emergency", "faqs"],
};


type State = {
  enabled: Partial<Record<FieldKey, boolean>>;
  values: Partial<Record<FieldKey, string | boolean | number>>;
  listsEnabled: Partial<Record<ListKey, boolean>>;
  manual: Array<{ title: string; description: string; body: string }>;
  emergency: Array<{ label: string; number: string }>;
  faqs: Array<{ question: string; answer: string; tags: string }>;
  checkout: Array<{ label: string }>;
};

const emptyState: State = { enabled: {}, values: {}, listsEnabled: {}, manual: [], emergency: [], faqs: [], checkout: [] };

type FetchData = Awaited<ReturnType<typeof bulkFetchProperties>>;

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
  const [state, setState] = useState<State>(emptyState);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FetchData | null>(null);
  const [confirmMode, setConfirmMode] = useState<null | "ask">(null);

  useEffect(() => {
    if (!open || ids.length === 0) return;
    setLoading(true);
    setData(null);
    fetchFn({ data: { ids } })
      .then((d) => setData(d))
      .catch(() => toast.error("Erro ao carregar dados dos guias"))
      .finally(() => setLoading(false));
  }, [open, ids, fetchFn]);

  function reset() {
    setState(emptyState);
    setData(null);
    setConfirmMode(null);
  }

  function toggle(field: FieldKey, v: boolean) {
    setState((s) => ({ ...s, enabled: { ...s.enabled, [field]: v } }));
  }
  function setValue(field: FieldKey, value: string | boolean | number) {
    setState((s) => ({ ...s, values: { ...s.values, [field]: value } }));
  }
  function toggleList(k: ListKey, v: boolean) {
    setState((s) => ({ ...s, listsEnabled: { ...s.listsEnabled, [k]: v } }));
  }

  // Preview: sumário de valores atuais de um campo entre os guias selecionados
  function fieldSummary(key: FieldKey): { filled: number; empty: number; distinct: string[] } {
    if (!data) return { filled: 0, empty: 0, distinct: [] };
    const set = new Set<string>();
    let filled = 0;
    let empty = 0;
    for (const p of data.properties) {
      const v = (p as Record<string, unknown>)[key];
      if (v === null || v === undefined || v === "") empty += 1;
      else { filled += 1; set.add(String(v)); }
    }
    return { filled, empty, distinct: Array.from(set) };
  }

  function listSummary(k: ListKey): { withItems: number; empty: number } {
    if (!data) return { withItems: 0, empty: 0 };
    const counts = data.listCounts[k];
    let withItems = 0, empty = 0;
    for (const p of data.properties) {
      if ((counts[p.id] ?? 0) > 0) withItems += 1; else empty += 1;
    }
    return { withItems, empty };
  }

  const hasAnySelected = useMemo(() => {
    return Object.values(state.enabled).some(Boolean) || Object.values(state.listsEnabled).some(Boolean);
  }, [state]);

  function coerce(f: FieldDef, v: string | boolean | number | undefined): unknown {
    if (f.kind === "boolean") return v === true;
    if (f.kind === "theme") return v === "light" ? "light" : "dark";
    if (f.kind === "language") return v === "en" ? "en" : "pt";
    if (f.kind === "access_mode") return v === "pin" ? "pin" : "public";
    if (f.kind === "collect") return v === "required" ? "required" : v === "optional" ? "optional" : "off";
    if (f.kind === "docscope") return v === "all" ? "all" : "main";
    if (f.kind === "number") return typeof v === "number" ? v : parseInt(String(v ?? "0"), 10) || 0;
    return v === undefined ? "" : v;
  }

  async function performSave(mode: "overwrite" | "fill-empty") {
    const patch: Record<string, unknown> = {};
    for (const tab of TEXT_TABS) {
      for (const f of tab.fields) {
        if (state.enabled[f.key]) patch[f.key] = coerce(f, state.values[f.key]);
      }
    }
    const lists: Record<string, unknown> = {};
    if (state.listsEnabled.manual)
      lists.manual = state.manual.filter((m) => m.title.trim()).map((m) => ({
        title: m.title.trim(), description: m.description.trim() || null, body: m.body.trim() || null,
      }));
    if (state.listsEnabled.emergency)
      lists.emergency = state.emergency.filter((e) => e.label.trim() && e.number.trim())
        .map((e) => ({ label: e.label.trim(), number: e.number.trim() }));
    if (state.listsEnabled.faqs)
      lists.faqs = state.faqs.filter((f) => f.question.trim() && f.answer.trim()).map((f) => ({
        question: f.question.trim(), answer: f.answer.trim(),
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      }));
    if (state.listsEnabled.checkout)
      lists.checkout = state.checkout.filter((c) => c.label.trim()).map((c) => ({ label: c.label.trim() }));

    if (Object.keys(patch).length === 0 && Object.keys(lists).length === 0) {
      toast.error("Marque ao menos um campo para aplicar");
      return;
    }

    setSaving(true);
    try {
      const r = await apply({ data: { ids, patch, lists: Object.keys(lists).length ? lists : undefined, mode } });
      toast.success(`${r.updated} ${r.updated === 1 ? "guia atualizado" : "guias atualizados"}`);
      reset();
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar {ids.length} {ids.length === 1 ? "guia" : "guias"}</DialogTitle>
          <DialogDescription>
            {loading ? "Carregando dados dos guias selecionados…" : "Ative os campos que deseja aplicar. Ao salvar, você escolhe se sobrescreve ou apenas preenche os guias que ainda não têm a informação."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 grid place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
        <Tabs defaultValue="basics" className="w-full">
          <TabsList className="w-full grid grid-cols-5 h-auto">
            {TEXT_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs whitespace-nowrap">{t.label}</TabsTrigger>
            ))}
          </TabsList>

          {TEXT_TABS.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="space-y-3 pt-3">
              {tab.fields.map((f) => {
                const enabled = !!state.enabled[f.key];
                const value = state.values[f.key];
                const s = fieldSummary(f.key);
                return (
                  <div key={f.key} className={`rounded-xl border p-3 transition-colors ${enabled ? "border-accent/50 bg-accent/5" : "border-border bg-card/40"}`}>
                    <div className="flex items-center justify-between mb-2 gap-3">
                      <div className="min-w-0 flex-1">
                        <label className="text-sm font-medium whitespace-nowrap truncate block">{f.label}</label>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {s.filled > 0 && s.empty === 0 && s.distinct.length === 1 && `Atual: ${s.distinct[0]}`}
                          {s.filled > 0 && s.empty === 0 && s.distinct.length > 1 && `${s.filled} guias · ${s.distinct.length} valores distintos`}
                          {s.filled > 0 && s.empty > 0 && `${s.filled} preenchido${s.filled > 1 ? "s" : ""} · ${s.empty} vazio${s.empty > 1 ? "s" : ""}`}
                          {s.filled === 0 && `${s.empty} guia${s.empty > 1 ? "s" : ""} sem valor`}
                        </div>
                      </div>
                      <Switch checked={enabled} onCheckedChange={(v) => toggle(f.key, v)} />
                    </div>
                    {enabled && renderField(f, value, (v) => setValue(f.key, v))}
                  </div>
                );
              })}

              {(TAB_LISTS[tab.id] ?? []).map((lk) => {
                const ls = listSummary(lk);
                const titles: Record<ListKey, string> = {
                  manual: "Manual da casa", checkout: "Checklist de checkout",
                  emergency: "Contatos de emergência", faqs: "Perguntas frequentes",
                };
                return (
                  <div key={lk}>
                    <ListToggle
                      enabled={!!state.listsEnabled[lk]}
                      onChange={(v) => toggleList(lk, v)}
                      title={titles[lk]}
                      hint={`Atual: ${ls.withItems} guia${ls.withItems === 1 ? "" : "s"} com itens · ${ls.empty} sem itens.`}
                    />
                    {state.listsEnabled[lk] && renderList(lk, state, setState)}
                  </div>
                );
              })}
            </TabsContent>
          ))}
        </Tabs>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={() => setConfirmMode("ask")} disabled={saving || loading || !hasAnySelected}>
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            Aplicar a {ids.length} {ids.length === 1 ? "guia" : "guias"}
          </Button>
        </DialogFooter>

        {confirmMode === "ask" && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => !saving && setConfirmMode(null)}>
            <div className="max-w-md w-full rounded-2xl border border-border bg-card p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="text-lg font-medium">Como aplicar as informações?</div>
              <p className="text-sm text-muted-foreground">
                Alguns dos guias selecionados já podem ter esses campos preenchidos. Escolha como proceder:
              </p>
              <div className="space-y-2">
                <Button className="w-full justify-start h-auto py-3" variant="outline" onClick={() => performSave("fill-empty")} disabled={saving}>
                  <div className="text-left">
                    <div className="text-sm font-medium">Preencher só onde estiver vazio</div>
                    <div className="text-[11px] text-muted-foreground">Mantém as informações existentes nos guias que já as têm.</div>
                  </div>
                </Button>
                <Button className="w-full justify-start h-auto py-3" onClick={() => performSave("overwrite")} disabled={saving}>
                  <div className="text-left">
                    <div className="text-sm font-medium">Substituir em todos</div>
                    <div className="text-[11px] opacity-80">Sobrescreve os valores atuais em todos os guias selecionados.</div>
                  </div>
                </Button>
              </div>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setConfirmMode(null)} disabled={saving}>Voltar</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListToggle({ enabled, onChange, title, hint }: { enabled: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <div className={`rounded-xl border p-3 flex items-center justify-between ${enabled ? "border-accent/50 bg-accent/5" : "border-border bg-card/40"}`}>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={enabled} onCheckedChange={onChange} />
    </div>
  );
}

function renderList(k: ListKey, state: State, setState: React.Dispatch<React.SetStateAction<State>>) {
  if (k === "manual") {
    return (
      <div className="space-y-2 mt-2">
        {state.manual.map((m, i) => (
          <div key={i} className="rounded-lg border border-border p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <Input value={m.title} placeholder="Título" className="h-8 text-sm"
                onChange={(e) => setState((s) => ({ ...s, manual: s.manual.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))} />
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setState((s) => ({ ...s, manual: s.manual.filter((_, j) => j !== i) }))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <Input value={m.description} placeholder="Descrição curta (opcional)" className="h-8 text-xs"
              onChange={(e) => setState((s) => ({ ...s, manual: s.manual.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))} />
            <Textarea value={m.body} placeholder="Instruções detalhadas (opcional)" rows={2} className="text-xs"
              onChange={(e) => setState((s) => ({ ...s, manual: s.manual.map((x, j) => j === i ? { ...x, body: e.target.value } : x) }))} />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, manual: [...s.manual, { title: "", description: "", body: "" }] }))}>
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
              onChange={(e) => setState((s) => ({ ...s, checkout: s.checkout.map((x, j) => j === i ? { label: e.target.value } : x) }))} />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setState((s) => ({ ...s, checkout: s.checkout.filter((_, j) => j !== i) }))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, checkout: [...s.checkout, { label: "" }] }))}>
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
              onChange={(e) => setState((s) => ({ ...s, emergency: s.emergency.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
            <Input value={c.number} placeholder="Número" className="h-8 text-sm max-w-[160px]"
              onChange={(e) => setState((s) => ({ ...s, emergency: s.emergency.map((x, j) => j === i ? { ...x, number: e.target.value } : x) }))} />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setState((s) => ({ ...s, emergency: s.emergency.filter((_, j) => j !== i) }))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, emergency: [...s.emergency, { label: "", number: "" }] }))}>
          <Plus className="size-3.5 mr-1" /> Adicionar contato
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 mt-2">
      {state.faqs.map((f, i) => (
        <div key={i} className="rounded-lg border border-border p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <Input value={f.question} placeholder="Pergunta" className="h-8 text-sm"
              onChange={(e) => setState((s) => ({ ...s, faqs: s.faqs.map((x, j) => j === i ? { ...x, question: e.target.value } : x) }))} />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setState((s) => ({ ...s, faqs: s.faqs.filter((_, j) => j !== i) }))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Textarea value={f.answer} placeholder="Resposta" rows={2} className="text-xs"
            onChange={(e) => setState((s) => ({ ...s, faqs: s.faqs.map((x, j) => j === i ? { ...x, answer: e.target.value } : x) }))} />
          <Input value={f.tags} placeholder="Tags separadas por vírgula" className="h-7 text-[11px]"
            onChange={(e) => setState((s) => ({ ...s, faqs: s.faqs.map((x, j) => j === i ? { ...x, tags: e.target.value } : x) }))} />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, faqs: [...s.faqs, { question: "", answer: "", tags: "" }] }))}>
        <Plus className="size-3.5 mr-1" /> Adicionar pergunta
      </Button>
    </div>
  );
}

function renderField(f: FieldDef, value: string | boolean | number | undefined, onChange: (v: string | boolean | number) => void) {
  if (f.kind === "textarea") {
    return <Textarea value={(value as string) ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} rows={3} />;
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
    return <Input type="number" min={0} max={10} value={(value as number | undefined) ?? ""} onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)} />;
  }
  return <Input value={(value as string) ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Pills({ value, onChange, options }: { value: string | undefined; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`px-3 py-1.5 rounded-full text-xs border ${value === v ? "bg-accent text-accent-foreground border-accent" : "border-border"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
