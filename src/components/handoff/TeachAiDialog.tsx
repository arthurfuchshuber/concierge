import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { teachAiFromMessage, listOwnerPropertiesForTeaching } from "@/lib/teach-ai.functions";
import { Loader2, Sparkles, Check, AlertCircle } from "lucide-react";

type Scope = "current" | "global" | "select";

export function TeachAiDialog({
  open,
  onOpenChange,
  propertyId,
  propertyName,
  initialContent,
  sourceMessageId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: string;
  propertyName: string;
  initialContent: string;
  sourceMessageId?: string | null;
}) {
  const [content, setContent] = useState(initialContent);
  const [scope, setScope] = useState<Scope>("current");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setContent(initialContent);
      setScope("current");
      setSelected(new Set());
      setErr(null);
      setOkMsg(null);
    }
  }, [open, initialContent]);

  const teachFn = useServerFn(teachAiFromMessage);
  const listFn = useServerFn(listOwnerPropertiesForTeaching);

  const propsQ = useQuery({
    queryKey: ["teach-owner-properties", propertyId],
    queryFn: () => listFn({ data: { propertyId } }),
    enabled: open && scope === "select",
    staleTime: 60_000,
  });

  const properties = useMemo(() => propsQ.data?.properties ?? [], [propsQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        propertyId,
        content: content.trim(),
        scope,
        propertyIds: scope === "select" ? Array.from(selected) : undefined,
        sourceMessageId: sourceMessageId ?? null,
      };
      return teachFn({ data: payload });
    },
    onSuccess: (r) => {
      setOkMsg(`Aprendizado salvo em ${r.inserted} ${r.inserted === 1 ? "guia" : "guia(s)"}.`);
      setTimeout(() => onOpenChange(false), 900);
    },
    onError: (e) => setErr((e as Error).message),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const canSave =
    content.trim().length >= 3 &&
    !save.isPending &&
    (scope !== "select" || selected.size > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Ensinar IA
          </DialogTitle>
          <DialogDescription>
            Este conteúdo entra na base de conhecimento e passa a orientar as respostas da IA daqui em diante.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Aprendizado</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Ex.: o wi-fi da suíte 2 é 'SigmaGuest' com senha 12345678."
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Onde aplicar</label>
            <div className="mt-1 space-y-1.5">
              <ScopeRow
                active={scope === "current"}
                onSelect={() => setScope("current")}
                title={`Apenas em "${propertyName}"`}
                subtitle="Conhecimento específico deste guia."
              />
              <ScopeRow
                active={scope === "global"}
                onSelect={() => setScope("global")}
                title="Todos os meus guias"
                subtitle="Vale para todas as propriedades desta conta."
              />
              <ScopeRow
                active={scope === "select"}
                onSelect={() => setScope("select")}
                title="Selecionar guias específicos"
                subtitle="Escolha uma lista de guias abaixo."
              />
            </div>
          </div>

          {scope === "select" && (
            <div className="rounded-md border border-border bg-background/60 max-h-56 overflow-y-auto">
              {propsQ.isLoading && (
                <div className="p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" /> Carregando guias…
                </div>
              )}
              {!propsQ.isLoading && properties.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">Nenhum outro guia encontrado.</div>
              )}
              {properties.map((p) => {
                const on = selected.has(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer border-b border-border/40 last:border-b-0 ${on ? "bg-primary/5" : "hover:bg-secondary/50"}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(p.id)}
                      className="size-4"
                    />
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.city && <span className="text-[11px] text-muted-foreground">{p.city}</span>}
                  </label>
                );
              })}
            </div>
          )}

          {err && (
            <div className="text-xs px-2 py-1.5 rounded bg-destructive/10 text-destructive border border-destructive/30 inline-flex items-center gap-1">
              <AlertCircle className="size-3" /> {err}
            </div>
          )}
          {okMsg && (
            <div className="text-xs px-2 py-1.5 rounded bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 inline-flex items-center gap-1">
              <Check className="size-3" /> {okMsg}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 py-2 text-sm rounded-md border border-border hover:bg-secondary"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!canSave}
            className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground inline-flex items-center gap-2 disabled:opacity-40"
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Ensinar IA
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeRow({
  active, onSelect, title, subtitle,
}: { active: boolean; onSelect: () => void; title: string; subtitle: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
        active ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/60"
      }`}
    >
      <div className="font-medium">{title}</div>
      <div className="text-[11px] text-muted-foreground">{subtitle}</div>
    </button>
  );
}
