import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Link2, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listStakeholderOptions, saveStakeholderAlias } from "@/lib/stakeholder-links.functions";

export type LinkTarget = {
  /** ID do evento na agenda. */
  eventId: string;
  title: string;
  /** E-mail/domínio sugerido, quando o convite tem participantes externos. */
  suggested: { kind: "email" | "domain"; value: string } | null;
};

type Scope = "event" | "title" | "suggested";

/**
 * Popup para vincular manualmente um evento da agenda a um proprietário/prestador.
 * Funciona inclusive para convites sem e-mail — nesse caso o vínculo é gravado
 * pelo próprio evento ou pelo título recorrente.
 */
export function LinkEventDialog({
  target,
  onOpenChange,
}: {
  target: LinkTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const optionsFn = useServerFn(listStakeholderOptions);
  const aliasFn = useServerFn(saveStakeholderAlias);
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("event");

  const options = useQuery({
    queryKey: ["stakeholder-options"],
    queryFn: () => optionsFn(),
    enabled: !!target,
    retry: false,
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = options.data ?? [];
    if (!term) return rows;
    return rows.filter((r) => `${r.label} ${r.email ?? ""} ${r.doc ?? ""}`.toLowerCase().includes(term));
  }, [options.data, q]);

  const save = useMutation({
    mutationFn: async (vars: { type: "owner" | "provider"; id: string }) => {
      if (!target) return;
      const alias =
        scope === "suggested" && target.suggested
          ? target.suggested
          : scope === "title"
            ? ({ kind: "title", value: target.title } as const)
            : ({ kind: "event", value: target.eventId } as const);
      await aliasFn({
        data: {
          aliasKind: alias.kind,
          aliasValue: alias.value,
          stakeholderType: vars.type,
          stakeholderId: vars.id,
        },
      });
    },
    onSuccess: () => {
      toast.success("Evento vinculado. Ele já aparece na ficha do cadastro.");
      qc.invalidateQueries({ queryKey: ["gcal-events"] });
      qc.invalidateQueries({ queryKey: ["stakeholder-feed"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scopes: Array<{ value: Scope; label: string; hint: string; enabled: boolean }> = [
    { value: "event", label: "Só este evento", hint: "Vincula apenas este convite.", enabled: true },
    {
      value: "title",
      label: "Todos com este título",
      hint: `Eventos chamados "${target?.title ?? ""}" entram sozinhos.`,
      enabled: true,
    },
    {
      value: "suggested",
      label: target?.suggested ? `Todos de ${target.suggested.value}` : "Por e-mail/domínio",
      hint: "Aprende pelo contato do convite.",
      enabled: !!target?.suggested,
    },
  ];

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Vincular evento a um cadastro</DialogTitle>
          <DialogDescription className="text-xs">
            {target?.title}
            {target?.suggested ? ` · ${target.suggested.value}` : " · sem participantes com e-mail"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {scopes
              .filter((s) => s.enabled)
              .map((s) => (
                <button
                  key={s.value}
                  type="button"
                  title={s.hint}
                  onClick={() => setScope(s.value)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    scope === s.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar proprietário ou prestador..."
              className="h-9 pl-8 text-xs"
            />
          </div>

          <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {options.isLoading ? (
              <p className="px-3 py-4 text-[11px] text-muted-foreground">Carregando cadastros…</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-[11px] text-muted-foreground">Nenhum cadastro encontrado.</p>
            ) : (
              filtered.map((s) => (
                <button
                  key={`${s.type}:${s.id}`}
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ type: s.type, id: s.id })}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{s.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {s.type === "owner" ? "Proprietário" : "Prestador"}
                      {s.email ? ` · ${s.email}` : ""}
                    </span>
                  </span>
                  {save.isPending ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))
            )}
          </div>

          <Button variant="ghost" size="sm" className="h-8 rounded-full text-xs" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
