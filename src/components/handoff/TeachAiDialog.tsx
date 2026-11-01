import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { teachAiFromMessage, listOwnerPropertiesForTeaching } from "@/lib/teach-ai.functions";
import { Loader2, Sparkles, Check, AlertCircle } from "lucide-react";
import { AUDIENCE_NAME, suggestAudience } from "@/lib/knowledge-audience";

type Scope = "current" | "global" | "select";
/** Quem pode receber a informação: G = Reserva Ativa · P = Público (qualquer pessoa) · I = Equipe Interna. */
type Aud = "G" | "P" | "I";

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
  // Nada vem pré-selecionado: o usuário escolhe (a IA só sugere).
  const [aud, setAud] = useState<Aud | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setContent(initialContent);
      setScope("current");
      setAud(null);
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
        audience: aud as Aud,
        propertyIds: scope === "select" ? Array.from(selected) : undefined,
        sourceMessageId: sourceMessageId ?? null,
      };
      return teachFn({ data: payload });
    },
    onSuccess: (r) => {
      setOkMsg(`Aprendizado salvo em ${r.inserted} ${r.inserted === 1 ? "imóvel" : "imóveis"}.`);
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

  const suggestion = useMemo(() => suggestAudience(content), [content]);

  const canSave =
    aud !== null &&
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
                subtitle="Conhecimento específico deste imóvel."
              />
              <ScopeRow
                active={scope === "global"}
                onSelect={() => setScope("global")}
                title="Todos os meus imóveis"
                subtitle="Vale para todos os imóveis desta conta."
              />
              <ScopeRow
                active={scope === "select"}
                onSelect={() => setScope("select")}
                title="Selecionar imóveis específicos"
                subtitle="Escolha os imóveis na lista abaixo."
              />
            </div>
          </div>

          {scope === "select" && (
            <div className="rounded-md border border-border bg-background/60 max-h-56 overflow-y-auto">
              {propsQ.isLoading && (
                <div className="p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" /> Carregando imóveis…
                </div>
              )}
              {!propsQ.isLoading && properties.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">Nenhum outro imóvel encontrado.</div>
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

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Quem pode receber esta informação</label>
            <div className="mt-1 space-y-1.5">
              <ScopeRow
                active={aud === "G"}
                onSelect={() => setAud("G")}
                title="Reserva Ativa"
                subtitle="A IA só informa a quem tem reserva ativa."
                tag={suggestion?.audience === "G" ? "Sugerido" : undefined}
              />
              <ScopeRow
                active={aud === "P"}
                onSelect={() => setAud("P")}
                title="Público"
                subtitle="A IA informa a qualquer pessoa, mesmo sem reserva."
                tag={suggestion?.audience === "P" ? "Sugerido" : undefined}
              />
              <ScopeRow
                active={aud === "I"}
                onSelect={() => setAud("I")}
                title="Equipe Interna"
                subtitle="A IA usa só com equipes e usuários internos; nunca repassa ao hóspede."
                tag={suggestion?.audience === "I" ? "Sugerido" : undefined}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {suggestion
                ? `Sugestão: ${AUDIENCE_NAME[suggestion.audience]} — ${suggestion.reason}. Escolha uma opção para salvar.`
                : "Escolha uma opção para salvar."}
            </p>
          </div>

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
  active, onSelect, title, subtitle, tag,
}: { active: boolean; onSelect: () => void; title: string; subtitle: string; tag?: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
        active ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        {tag ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{tag}</span> : null}
      </div>
      <div className="text-[11px] text-muted-foreground">{subtitle}</div>
    </button>
  );
}
