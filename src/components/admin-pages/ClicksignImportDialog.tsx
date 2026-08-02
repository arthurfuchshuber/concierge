import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  previewClicksignStakeholders,
  importClicksignStakeholders,
  type ImportCandidate,
} from "@/lib/clicksign-import.functions";

type Decision = {
  action: "create" | "link" | "skip";
  type: "owner" | "provider";
  targetType?: "owner" | "provider";
  targetId?: string;
};

const REASON: Record<string, string> = {
  doc: "mesmo CPF/CNPJ",
  email: "mesmo e-mail",
  name: "nome parecido",
};

/**
 * Importação automática de cadastros a partir dos contratos do ClickSign.
 * Novos entram marcados para criação; possíveis duplicados exigem decisão
 * explícita do usuário (vincular ao existente, criar mesmo assim ou ignorar).
 */
export function ClicksignImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const previewFn = useServerFn(previewClicksignStakeholders);
  const importFn = useServerFn(importClicksignStakeholders);
  const qc = useQueryClient();

  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const preview = useQuery({
    queryKey: ["clicksign-import-preview"],
    queryFn: () => previewFn(),
    enabled: open,
    retry: false,
  });

  const candidates = useMemo(
    () => (preview.data?.candidates ?? []).filter((c) => c.status !== "linked"),
    [preview.data],
  );
  const alreadyLinked = (preview.data?.candidates ?? []).length - candidates.length;

  useEffect(() => {
    if (!candidates.length) return;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const c of candidates) {
        if (next[c.key]) continue;
        next[c.key] =
          c.status === "new"
            ? { action: "create", type: c.suggestedType }
            : { action: "link", type: c.suggestedType, targetType: c.matches[0]?.type, targetId: c.matches[0]?.id };
      }
      return next;
    });
  }, [candidates]);

  const run = useMutation({
    mutationFn: async () => {
      const payload = candidates.map((c) => {
        const d = decisions[c.key] ?? { action: "skip" as const, type: c.suggestedType };
        return {
          key: c.key,
          name: c.name,
          doc: c.doc,
          email: c.email,
          phone: c.phone,
          action: d.action,
          type: d.type,
          targetType: d.targetType,
          targetId: d.targetId,
        };
      });
      return importFn({ data: { decisions: payload } });
    },
    onSuccess: (r) => {
      toast.success(`${r.created} cadastro(s) criado(s) · ${r.linked} vinculado(s).`);
      qc.invalidateQueries({ queryKey: ["stakeholders"] });
      qc.invalidateQueries({ queryKey: ["clicksign-docs"] });
      qc.invalidateQueries({ queryKey: ["clicksign-import-preview"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (key: string, patch: Partial<Decision>) =>
    setDecisions((prev) => ({ ...prev, [key]: { ...(prev[key] as Decision), ...patch } }));

  const toCreate = candidates.filter((c) => decisions[c.key]?.action === "create").length;
  const toLink = candidates.filter((c) => decisions[c.key]?.action === "link").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Importar cadastros do ClickSign</DialogTitle>
          <DialogDescription className="text-xs">
            Identificamos os signatários dos contratos. Confirme o que deve virar cadastro — possíveis duplicados
            precisam da sua decisão.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Analisando contratos…
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Nada novo para importar
            {alreadyLinked > 0 ? ` — ${alreadyLinked} signatário(s) já têm cadastro.` : "."}
          </p>
        ) : (
          <>
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {candidates.map((c) => {
                const d = decisions[c.key];
                return (
                  <div key={c.key} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {[c.doc, c.email, `${c.documents} contrato(s)`].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {c.status === "duplicate" ? (
                        <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                          <AlertTriangle className="size-3" /> Possível duplicado
                        </Badge>
                      ) : null}

                    </div>

                    {c.matches.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {c.matches.slice(0, 3).map((m) => (
                          <button
                            key={`${m.type}:${m.id}`}
                            type="button"
                            onClick={() => set(c.key, { action: "link", targetType: m.type, targetId: m.id })}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                              d?.action === "link" && d.targetId === m.id
                                ? "border-primary bg-primary/10"
                                : "border-border hover:bg-muted/60"
                            }`}
                          >
                            <span className="min-w-0 truncate">
                              Vincular a <strong>{m.label}</strong>{" "}
                              <span className="text-muted-foreground">
                                ({m.type === "owner" ? "proprietário" : "prestador"} · {REASON[m.reason]})
                              </span>
                            </span>
                            {d?.action === "link" && d.targetId === m.id ? (
                              <Check className="size-3.5 shrink-0 text-primary" />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => set(c.key, { action: "create", type: "owner" })}
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          d?.action === "create" && d.type === "owner"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Criar como proprietário
                      </button>
                      <button
                        type="button"
                        onClick={() => set(c.key, { action: "create", type: "provider" })}
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          d?.action === "create" && d.type === "provider"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Criar como prestador
                      </button>
                      <button
                        type="button"
                        onClick={() => set(c.key, { action: "skip" })}
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          d?.action === "skip"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Ignorar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-[11px] text-muted-foreground">
                {toCreate} para criar · {toLink} para vincular
                {alreadyLinked > 0 ? ` · ${alreadyLinked} já cadastrados` : ""}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button size="sm" className="h-8 text-xs" disabled={run.isPending} onClick={() => run.mutate()}>
                  {run.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                  Confirmar importação
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export type { ImportCandidate };
