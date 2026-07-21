import { useState } from "react";
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
import { bulkUpdateProperties } from "@/lib/properties.functions";
import { toast } from "sonner";

type FieldKey =
  | "checkin_time"
  | "checkin_time_max"
  | "checkin_note"
  | "checkout_time"
  | "checkout_time_min"
  | "checkout_note"
  | "address_note"
  | "checkin_instructions"
  | "checkout_instructions"
  | "gate_code"
  | "gate_label"
  | "gate_instructions"
  | "lock_code"
  | "lock_label"
  | "lock_instructions"
  | "access_codes_pin"
  | "wifi_ssid"
  | "wifi_password"
  | "host_name"
  | "host_phone"
  | "brand_name"
  | "brand_logo_url"
  | "guide_theme"
  | "house_rules"
  | "address"
  | "maps_url"
  | "garage_maps_url"
  | "city"
  | "state"
  | "country"
  | "default_language"
  | "published"
  | "access_mode"
  | "pin_code"
  | "require_access_gate";

type FieldKind = "text" | "textarea" | "theme" | "language" | "access_mode" | "boolean";
type FieldDef = { key: FieldKey; label: string; kind: FieldKind; placeholder?: string };

type ListKey = "manual" | "checkout" | "emergency" | "faqs";

const TEXT_TABS: { id: string; label: string; fields: FieldDef[] }[] = [
  {
    id: "basics",
    label: "Básico",
    fields: [
      { key: "brand_name", label: "Nome da marca", kind: "text" },
      { key: "brand_logo_url", label: "URL do logo (https://)", kind: "text" },
      { key: "guide_theme", label: "Tema do guia", kind: "theme" },
      { key: "default_language", label: "Idioma padrão", kind: "language" },
      { key: "published", label: "Publicado", kind: "boolean" },
      { key: "host_name", label: "Nome do anfitrião", kind: "text" },
      { key: "host_phone", label: "Telefone do anfitrião", kind: "text" },
      { key: "address", label: "Endereço completo", kind: "textarea", placeholder: "Rua, número, bairro…" },
      { key: "maps_url", label: "Link do Google Maps (https://)", kind: "text" },
      { key: "garage_maps_url", label: "Link do Maps para a garagem", kind: "text" },
      { key: "city", label: "Cidade", kind: "text" },
      { key: "state", label: "Estado", kind: "text" },
      { key: "country", label: "País", kind: "text" },
    ],
  },
  {
    id: "access",
    label: "Acesso",
    fields: [
      { key: "access_mode", label: "Modo de acesso do guia", kind: "access_mode" },
      { key: "pin_code", label: "PIN (usado quando modo = PIN)", kind: "text" },
      { key: "require_access_gate", label: "Exigir formulário de primeiro acesso", kind: "boolean" },
      { key: "gate_code", label: "Código do portão", kind: "text" },
      { key: "gate_label", label: "Nome do portão", kind: "text", placeholder: "Portão" },
      { key: "gate_instructions", label: "Instruções do portão", kind: "textarea" },
      { key: "lock_code", label: "Código da fechadura", kind: "text" },
      { key: "lock_label", label: "Nome da fechadura", kind: "text", placeholder: "Fechadura" },
      { key: "lock_instructions", label: "Instruções da fechadura", kind: "textarea" },
      { key: "access_codes_pin", label: "Senha para liberar códigos e Wi-Fi", kind: "text" },
      { key: "wifi_ssid", label: "Rede Wi-Fi", kind: "text" },
      { key: "wifi_password", label: "Senha do Wi-Fi", kind: "text" },
    ],
  },
  {
    id: "house",
    label: "A casa",
    fields: [
      { key: "checkin_time", label: "Horário de check-in", kind: "text", placeholder: "15:00" },
      { key: "checkin_time_max", label: "Check-in até", kind: "text", placeholder: "20:00" },
      { key: "checkin_note", label: "Observação sobre o check-in", kind: "textarea" },
      { key: "address_note", label: "Como chegar", kind: "textarea" },
      { key: "checkin_instructions", label: "Instruções de check-in", kind: "textarea" },
      { key: "checkout_time", label: "Check-out até", kind: "text", placeholder: "11:00" },
      { key: "checkout_time_min", label: "Check-out a partir", kind: "text" },
      { key: "checkout_note", label: "Observação sobre o check-out", kind: "textarea" },
      { key: "checkout_instructions", label: "Instruções de check-out", kind: "textarea" },
      { key: "house_rules", label: "Regras do espaço", kind: "textarea" },
    ],
  },
  {
    id: "extras",
    label: "Extras",
    fields: [],
  },
];

// Listas atreladas a cada aba
const TAB_LISTS: Record<string, ListKey[]> = {
  house: ["manual", "checkout"],
  extras: ["emergency", "faqs"],
};


type State = {
  enabled: Partial<Record<FieldKey, boolean>>;
  values: Partial<Record<FieldKey, string | boolean>>;
  listsEnabled: Partial<Record<ListKey, boolean>>;
  manual: Array<{ title: string; description: string; body: string }>;
  emergency: Array<{ label: string; number: string }>;
  faqs: Array<{ question: string; answer: string; tags: string }>;
  checkout: Array<{ label: string }>;
};

const emptyState: State = {
  enabled: {},
  values: {},
  listsEnabled: {},
  manual: [],
  emergency: [],
  faqs: [],
  checkout: [],
};

export function BulkEditDialog({
  open,
  onOpenChange,
  ids,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ids: string[];
  onSaved?: () => void;
}) {
  const apply = useServerFn(bulkUpdateProperties);
  const [state, setState] = useState<State>(emptyState);
  const [saving, setSaving] = useState(false);

  function reset() {
    setState(emptyState);
  }

  function toggle(field: FieldKey, v: boolean) {
    setState((s) => ({
      ...s,
      enabled: { ...s.enabled, [field]: v },
      values: v ? s.values : { ...s.values, [field]: undefined },
    }));
  }
  function setValue(field: FieldKey, value: string | boolean) {
    setState((s) => ({ ...s, values: { ...s.values, [field]: value } }));
  }
  function toggleList(k: ListKey, v: boolean) {
    setState((s) => ({ ...s, listsEnabled: { ...s.listsEnabled, [k]: v } }));
  }

  async function handleSave() {
    const patch: Record<string, unknown> = {};
    for (const tab of TEXT_TABS) {
      for (const f of tab.fields) {
        if (state.enabled[f.key]) {
          const v = state.values[f.key];
          if (f.kind === "boolean") {
            patch[f.key] = v === true;
          } else if (f.kind === "theme") {
            patch[f.key] = v === "light" ? "light" : "dark";
          } else if (f.kind === "language") {
            patch[f.key] = v === "en" ? "en" : "pt";
          } else if (f.kind === "access_mode") {
            patch[f.key] = v === "pin" ? "pin" : "public";
          } else {
            patch[f.key] = v === undefined ? "" : v;
          }
        }
      }
    }
    const lists: Record<string, unknown> = {};
    if (state.listsEnabled.manual)
      lists.manual = state.manual
        .filter((m) => m.title.trim())
        .map((m) => ({
          title: m.title.trim(),
          description: m.description.trim() || null,
          body: m.body.trim() || null,
        }));
    if (state.listsEnabled.emergency)
      lists.emergency = state.emergency
        .filter((e) => e.label.trim() && e.number.trim())
        .map((e) => ({ label: e.label.trim(), number: e.number.trim() }));
    if (state.listsEnabled.faqs)
      lists.faqs = state.faqs
        .filter((f) => f.question.trim() && f.answer.trim())
        .map((f) => ({
          question: f.question.trim(),
          answer: f.answer.trim(),
          tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }));
    if (state.listsEnabled.checkout)
      lists.checkout = state.checkout
        .filter((c) => c.label.trim())
        .map((c) => ({ label: c.label.trim() }));

    if (Object.keys(patch).length === 0 && Object.keys(lists).length === 0) {
      toast.error("Marque ao menos um campo para aplicar");
      return;
    }

    setSaving(true);
    try {
      const r = await apply({
        data: {
          ids,
          patch,
          lists: Object.keys(lists).length ? lists : undefined,
        },
      });
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
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar {ids.length} {ids.length === 1 ? "guia" : "guias"}</DialogTitle>
          <DialogDescription>
            Ative apenas os campos que deseja aplicar. Campos de lista (manual, checklist, emergências, FAQ) substituem todo o conteúdo atual dos guias selecionados.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basics" className="w-full">
          <TabsList className="w-full grid grid-cols-4 h-auto">
            {TEXT_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs whitespace-nowrap">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {TEXT_TABS.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="space-y-3 pt-3">
              {tab.fields.map((f) => {
                const enabled = !!state.enabled[f.key];
                const value = state.values[f.key];
                return (
                  <div
                    key={f.key}
                    className={`rounded-xl border p-3 transition-colors ${enabled ? "border-accent/50 bg-accent/5" : "border-border bg-card/40"}`}
                  >
                    <div className="flex items-center justify-between mb-2 gap-3">
                      <label className="text-sm font-medium whitespace-nowrap truncate">{f.label}</label>
                      <Switch checked={enabled} onCheckedChange={(v) => toggle(f.key, v)} />
                    </div>
                    {enabled && renderField(f, value, (v) => setValue(f.key, v))}
                    {enabled && f.kind !== "boolean" && (
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Deixe em branco para limpar este campo nos guias selecionados.
                      </p>
                    )}
                  </div>
                );
              })}

              {(TAB_LISTS[tab.id] ?? []).includes("manual") && (
                <>
                  <ListToggle
                    enabled={!!state.listsEnabled.manual}
                    onChange={(v) => toggleList("manual", v)}
                    title="Manual da casa"
                    hint="Substitui todo o manual atual dos guias selecionados."
                  />
                  {state.listsEnabled.manual && (
                    <div className="space-y-2">
                      {state.manual.map((m, i) => (
                        <div key={i} className="rounded-lg border border-border p-2 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Input
                              value={m.title}
                              placeholder="Título"
                              className="h-8 text-sm"
                              onChange={(e) => setState((s) => ({ ...s, manual: s.manual.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))}
                            />
                            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setState((s) => ({ ...s, manual: s.manual.filter((_, j) => j !== i) }))}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <Input
                            value={m.description}
                            placeholder="Descrição curta (opcional)"
                            className="h-8 text-xs"
                            onChange={(e) => setState((s) => ({ ...s, manual: s.manual.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))}
                          />
                          <Textarea
                            value={m.body}
                            placeholder="Instruções detalhadas (opcional)"
                            rows={2}
                            className="text-xs"
                            onChange={(e) => setState((s) => ({ ...s, manual: s.manual.map((x, j) => j === i ? { ...x, body: e.target.value } : x) }))}
                          />
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, manual: [...s.manual, { title: "", description: "", body: "" }] }))}>
                        <Plus className="size-3.5 mr-1" /> Adicionar item
                      </Button>
                    </div>
                  )}
                </>
              )}

              {(TAB_LISTS[tab.id] ?? []).includes("checkout") && (
                <>
                  <ListToggle
                    enabled={!!state.listsEnabled.checkout}
                    onChange={(v) => toggleList("checkout", v)}
                    title="Checklist de checkout"
                    hint="Substitui todo o checklist atual dos guias selecionados."
                  />
                  {state.listsEnabled.checkout && (
                    <div className="space-y-2">
                      {state.checkout.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            value={c.label}
                            placeholder="Ex.: Deixar as chaves na fechadura"
                            className="h-8 text-sm"
                            onChange={(e) => setState((s) => ({ ...s, checkout: s.checkout.map((x, j) => j === i ? { label: e.target.value } : x) }))}
                          />
                          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setState((s) => ({ ...s, checkout: s.checkout.filter((_, j) => j !== i) }))}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, checkout: [...s.checkout, { label: "" }] }))}>
                        <Plus className="size-3.5 mr-1" /> Adicionar item
                      </Button>
                    </div>
                  )}
                </>
              )}

              {(TAB_LISTS[tab.id] ?? []).includes("emergency") && (
                <>
                  <ListToggle
                    enabled={!!state.listsEnabled.emergency}
                    onChange={(v) => toggleList("emergency", v)}
                    title="Contatos de emergência"
                    hint="Substitui todos os contatos de emergência atuais dos guias selecionados."
                  />
                  {state.listsEnabled.emergency && (
                    <div className="space-y-2">
                      {state.emergency.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            value={c.label}
                            placeholder="Ex.: SAMU"
                            className="h-8 text-sm"
                            onChange={(e) => setState((s) => ({ ...s, emergency: s.emergency.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))}
                          />
                          <Input
                            value={c.number}
                            placeholder="Número"
                            className="h-8 text-sm max-w-[160px]"
                            onChange={(e) => setState((s) => ({ ...s, emergency: s.emergency.map((x, j) => j === i ? { ...x, number: e.target.value } : x) }))}
                          />
                          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setState((s) => ({ ...s, emergency: s.emergency.filter((_, j) => j !== i) }))}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, emergency: [...s.emergency, { label: "", number: "" }] }))}>
                        <Plus className="size-3.5 mr-1" /> Adicionar contato
                      </Button>
                    </div>
                  )}
                </>
              )}

              {(TAB_LISTS[tab.id] ?? []).includes("faqs") && (
                <>
                  <ListToggle
                    enabled={!!state.listsEnabled.faqs}
                    onChange={(v) => toggleList("faqs", v)}
                    title="Perguntas frequentes"
                    hint="Substitui todas as perguntas atuais dos guias selecionados."
                  />
                  {state.listsEnabled.faqs && (
                    <div className="space-y-2">
                      {state.faqs.map((f, i) => (
                        <div key={i} className="rounded-lg border border-border p-2 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Input
                              value={f.question}
                              placeholder="Pergunta"
                              className="h-8 text-sm"
                              onChange={(e) => setState((s) => ({ ...s, faqs: s.faqs.map((x, j) => j === i ? { ...x, question: e.target.value } : x) }))}
                            />
                            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setState((s) => ({ ...s, faqs: s.faqs.filter((_, j) => j !== i) }))}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <Textarea
                            value={f.answer}
                            placeholder="Resposta"
                            rows={2}
                            className="text-xs"
                            onChange={(e) => setState((s) => ({ ...s, faqs: s.faqs.map((x, j) => j === i ? { ...x, answer: e.target.value } : x) }))}
                          />
                          <Input
                            value={f.tags}
                            placeholder="Tags separadas por vírgula (chegada, saida…)"
                            className="h-7 text-[11px]"
                            onChange={(e) => setState((s) => ({ ...s, faqs: s.faqs.map((x, j) => j === i ? { ...x, tags: e.target.value } : x) }))}
                          />
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, faqs: [...s.faqs, { question: "", answer: "", tags: "" }] }))}>
                        <Plus className="size-3.5 mr-1" /> Adicionar pergunta
                      </Button>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            Aplicar a {ids.length} {ids.length === 1 ? "guia" : "guias"}
          </Button>
        </DialogFooter>
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

function renderField(f: FieldDef, value: string | boolean | undefined, onChange: (v: string | boolean) => void) {
  if (f.kind === "textarea") {
    return (
      <Textarea
        value={(value as string) ?? ""}
        placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    );
  }
  if (f.kind === "theme") {
    return (
      <div className="flex gap-2">
        {(["dark", "light"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 rounded-full text-xs border ${value === opt ? "bg-accent text-accent-foreground border-accent" : "border-border"}`}
          >
            {opt === "dark" ? "Escuro" : "Claro"}
          </button>
        ))}
      </div>
    );
  }
  if (f.kind === "language") {
    return (
      <div className="flex gap-2">
        {(["pt", "en"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 rounded-full text-xs border ${value === opt ? "bg-accent text-accent-foreground border-accent" : "border-border"}`}
          >
            {opt === "pt" ? "Português" : "Inglês"}
          </button>
        ))}
      </div>
    );
  }
  if (f.kind === "access_mode") {
    return (
      <div className="flex gap-2">
        {(["public", "pin"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 rounded-full text-xs border ${value === opt ? "bg-accent text-accent-foreground border-accent" : "border-border"}`}
          >
            {opt === "public" ? "Público" : "PIN"}
          </button>
        ))}
      </div>
    );
  }
  if (f.kind === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Switch checked={!!value} onCheckedChange={(v) => onChange(v)} />
        <span className="text-xs text-muted-foreground">{value ? "Sim" : "Não"}</span>
      </div>
    );
  }
  return (
    <Input
      value={(value as string) ?? ""}
      placeholder={f.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
