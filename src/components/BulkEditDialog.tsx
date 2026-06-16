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
import { Loader2 } from "lucide-react";
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
  | "guide_theme";

type FieldKind = "text" | "textarea" | "theme";
type FieldDef = { key: FieldKey; label: string; kind: FieldKind; placeholder?: string };

const TABS: { id: string; label: string; fields: FieldDef[] }[] = [
  {
    id: "chegada",
    label: "Chegada",
    fields: [
      { key: "checkin_time", label: "Horário de check-in", kind: "text", placeholder: "15:00" },
      { key: "checkin_time_max", label: "Check-in até", kind: "text", placeholder: "20:00" },
      { key: "checkin_note", label: "Observação sobre o check-in", kind: "textarea" },
      { key: "address_note", label: "Como chegar", kind: "textarea" },
      { key: "checkin_instructions", label: "Instruções de check-in", kind: "textarea" },
    ],
  },
  {
    id: "saida",
    label: "Saída",
    fields: [
      { key: "checkout_time", label: "Check-out até", kind: "text", placeholder: "11:00" },
      { key: "checkout_time_min", label: "Check-out a partir", kind: "text" },
      { key: "checkout_note", label: "Observação sobre o check-out", kind: "textarea" },
      { key: "checkout_instructions", label: "Instruções de check-out", kind: "textarea" },
    ],
  },
  {
    id: "acesso",
    label: "Acesso",
    fields: [
      { key: "gate_code", label: "Código do portão", kind: "text" },
      { key: "gate_label", label: "Nome do portão", kind: "text", placeholder: "Portão" },
      { key: "gate_instructions", label: "Instruções do portão", kind: "textarea" },
      { key: "lock_code", label: "Código da fechadura", kind: "text" },
      { key: "lock_label", label: "Nome da fechadura", kind: "text", placeholder: "Fechadura" },
      { key: "lock_instructions", label: "Instruções da fechadura", kind: "textarea" },
      { key: "access_codes_pin", label: "Senha para liberar códigos e Wi-Fi", kind: "text" },
    ],
  },
  {
    id: "wifi",
    label: "Wi-Fi",
    fields: [
      { key: "wifi_ssid", label: "Rede", kind: "text" },
      { key: "wifi_password", label: "Senha", kind: "text" },
    ],
  },
  {
    id: "anfitriao",
    label: "Anfitrião",
    fields: [
      { key: "host_name", label: "Nome", kind: "text" },
      { key: "host_phone", label: "Telefone", kind: "text" },
    ],
  },
  {
    id: "marca",
    label: "Marca",
    fields: [
      { key: "brand_name", label: "Nome da marca", kind: "text" },
      { key: "brand_logo_url", label: "URL do logo (https://)", kind: "text" },
      { key: "guide_theme", label: "Tema do guia", kind: "theme" },
    ],
  },
];

type State = {
  enabled: Partial<Record<FieldKey, boolean>>;
  values: Partial<Record<FieldKey, string>>;
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
  const [state, setState] = useState<State>({ enabled: {}, values: {} });
  const [saving, setSaving] = useState(false);

  function reset() {
    setState({ enabled: {}, values: {} });
  }

  function toggle(field: FieldKey, v: boolean) {
    setState((s) => ({
      ...s,
      enabled: { ...s.enabled, [field]: v },
      values: v ? s.values : { ...s.values, [field]: undefined },
    }));
  }
  function setValue(field: FieldKey, value: string) {
    setState((s) => ({ ...s, values: { ...s.values, [field]: value } }));
  }

  async function handleSave() {
    const patch: Record<string, string> = {};
    for (const tab of TABS) {
      for (const f of tab.fields) {
        if (state.enabled[f.key]) {
          patch[f.key] = state.values[f.key] ?? "";
        }
      }
    }
    if (Object.keys(patch).length === 0) {
      toast.error("Marque ao menos um campo para aplicar");
      return;
    }
    setSaving(true);
    try {
      const r = await apply({ data: { ids, patch } });
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
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar {ids.length} {ids.length === 1 ? "guia" : "guias"}</DialogTitle>
          <DialogDescription>
            Ative apenas os campos que deseja aplicar. Os demais ficam intocados.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="chegada" className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {TABS.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="space-y-3 pt-3">
              {tab.fields.map((f) => {
                const enabled = !!state.enabled[f.key];
                const value = state.values[f.key] ?? "";
                return (
                  <div
                    key={f.key}
                    className={`rounded-xl border p-3 transition-colors ${enabled ? "border-accent/50 bg-accent/5" : "border-border bg-card/40"}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium">{f.label}</label>
                      <Switch checked={enabled} onCheckedChange={(v) => toggle(f.key, v)} />
                    </div>
                    {enabled &&
                      (f.kind === "textarea" ? (
                        <Textarea
                          value={value}
                          placeholder={f.placeholder}
                          onChange={(e) => setValue(f.key, e.target.value)}
                          rows={3}
                        />
                      ) : f.kind === "theme" ? (
                        <div className="flex gap-2">
                          {(["dark", "light"] as const).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setValue(f.key, opt)}
                              className={`px-3 py-1.5 rounded-full text-xs border ${value === opt ? "bg-accent text-accent-foreground border-accent" : "border-border"}`}
                            >
                              {opt === "dark" ? "Escuro" : "Claro"}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Input
                          value={value}
                          placeholder={f.placeholder}
                          onChange={(e) => setValue(f.key, e.target.value)}
                        />
                      ))}
                    {enabled && (
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Deixe em branco para limpar este campo nos guias selecionados.
                      </p>
                    )}
                  </div>
                );
              })}
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
