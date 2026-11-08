import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  previewClicksignStakeholders,
  importClicksignStakeholders,
  type ImportCandidate,
} from "@/lib/clicksign-import.functions";
import { DocPreviewDialog, type PreviewTarget } from "@/components/stakeholders/DocPreviewDialog";
import {
  INTEGRATION_WINDOW_CLASS,
  IntegrationShell,
  PrimaryAction,
  StatusTag,
} from "@/components/admin-pages/integration-window";
import { cn } from "@/lib/utils";

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

const KIND: Record<"owner" | "provider", string> = { owner: "Proprietário", provider: "Prestador" };

/**
 * NOVOS CADASTROS (mockup aprovado, 08/11/2026): aberta pelo "Atualizar Dados" do ClickSign quando
 * algum contratante dos contratos ainda não tem cadastro. Um cartão por contratante (só o
 * contratante do documento, nunca sócios/testemunhas): nome + olho (abre o contrato no leitor) e
 * etiqueta Novo / Possível Duplicata; possíveis duplicatas sugerem o vínculo ao cadastro existente.
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
  const [doc, setDoc] = useState<PreviewTarget>(null);

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
            : {
                action: "link",
                type: c.suggestedType,
                targetType: c.matches[0]?.type,
                targetId: c.matches[0]?.id,
              };
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
      toast.success("Cadastros Atualizados", {
        className: "!rounded-[16px]",
        description: `${r.created} ${r.created === 1 ? "cadastro criado" : "cadastros criados"} · ${r.linked} ${
          r.linked === 1 ? "vinculado" : "vinculados"
        }.`,
      });
      qc.invalidateQueries({ queryKey: ["stakeholders"] });
      qc.invalidateQueries({ queryKey: ["clicksign-docs"] });
      qc.invalidateQueries({ queryKey: ["clicksign-import-preview"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (key: string, patch: Partial<Decision>) =>
    setDecisions((prev) => ({ ...prev, [key]: { ...(prev[key] as Decision), ...patch } }));

  const n = candidates.length;
  const subtitle = preview.isLoading
    ? "ClickSign · Analisando Contratos…"
    : `ClickSign · ${n} ${n === 1 ? "Contratante Sem Cadastro" : "Contratantes Sem Cadastro"}`;

  const pill = (active: boolean) =>
    cn(
      "h-7 min-w-0 flex-1 truncate rounded-[7px] border px-1.5 text-[11.5px] transition-colors",
      active
        ? "border-foreground/[0.12] bg-foreground/10 font-bold text-foreground"
        : "border-foreground/5 bg-foreground/[0.04] font-semibold text-muted-foreground hover:text-foreground",
    );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className={INTEGRATION_WINDOW_CLASS}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <IntegrationShell
            inWindow
            title="Novos Cadastros"
            subtitle={subtitle}
            bodyDeps={[n, preview.isLoading, decisions]}
            footer={
              n > 0 ? (
                <PrimaryAction
                  icon={
                    run.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Check strokeWidth={2.2} />
                    )
                  }
                  onClick={() => run.mutate()}
                  disabled={run.isPending}
                >
                  Confirmar
                </PrimaryAction>
              ) : null
            }
          >
            {preview.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Analisando contratos…
              </div>
            ) : n === 0 ? (
              <p className="py-8 text-center text-[12px] text-muted-foreground">
                Nada novo para cadastrar
                {alreadyLinked > 0
                  ? ` — ${alreadyLinked} ${alreadyLinked === 1 ? "contratante já tem" : "contratantes já têm"} cadastro.`
                  : "."}
              </p>
            ) : (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
                <div className="rounded-[12px] bg-foreground/[0.04] px-3 py-2.5 text-[12px] leading-[1.45] text-foreground/85">
                  Encontramos{" "}
                  <b className="font-semibold text-foreground">
                    {n} {n === 1 ? "contratante" : "contratantes"}
                  </b>{" "}
                  nos contratos do ClickSign que ainda não {n === 1 ? "tem" : "têm"} cadastro.
                  Escolha o que fazer com {n === 1 ? "ele" : "cada um"}.
                </div>
                {candidates.map((c: ImportCandidate) => {
                  const d = decisions[c.key];
                  const dup = c.status === "duplicate";
                  return (
                    <div
                      key={c.key}
                      data-clip-row
                      className="overflow-hidden rounded-[12px] border border-border bg-[var(--card-surface)]"
                    >
                      <div className="flex min-w-0 items-center gap-2 px-3 pt-2.5">
                        <span className="min-w-0 truncate text-[13px] font-bold" title={c.name}>
                          {c.name}
                        </span>
                        {c.sampleDocumentId ? (
                          <button
                            type="button"
                            aria-label="Ver Contrato"
                            title="Ver Contrato"
                            onClick={() =>
                              setDoc({ name: c.sampleDocument, docId: c.sampleDocumentId! })
                            }
                            className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--action-sq-bg)] text-foreground/80 transition-colors hover:text-foreground"
                          >
                            <Eye className="size-[13px]" strokeWidth={1.8} />
                          </button>
                        ) : null}
                        <span className="flex-1" />
                        <StatusTag tone={dup ? "warn" : "ok"}>
                          {dup ? "Possível Duplicata" : "Novo"}
                        </StatusTag>
                      </div>
                      {c.matches.length > 0 ? (
                        <div className="grid gap-1.5 px-3 pt-2.5">
                          {c.matches.slice(0, 3).map((m) => {
                            const on = d?.action === "link" && d.targetId === m.id;
                            return (
                              <button
                                key={`${m.type}:${m.id}`}
                                type="button"
                                onClick={() =>
                                  set(c.key, { action: "link", targetType: m.type, targetId: m.id })
                                }
                                className={cn(
                                  "flex h-[34px] min-w-0 items-center gap-2 rounded-[9px] border px-2.5 text-left text-[11.5px] transition-colors",
                                  on
                                    ? "border-[#7fb79a]/30 bg-[#7fb79a]/10"
                                    : "border-foreground/[0.07] hover:bg-foreground/[0.04]",
                                )}
                              >
                                <span
                                  className={cn(
                                    "grid size-4 shrink-0 place-items-center rounded-[4px]",
                                    on
                                      ? "bg-[#7fb79a] text-[#14110f]"
                                      : "border border-foreground/25",
                                  )}
                                >
                                  {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                  Vincular a <b className="font-semibold">{m.label}</b>{" "}
                                  <span className="text-muted-foreground">
                                    · {KIND[m.type]} · {REASON[m.reason]}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <div className="flex gap-1.5 px-3 pb-3 pt-2.5">
                        <button
                          type="button"
                          onClick={() => set(c.key, { action: "create", type: "owner" })}
                          className={pill(d?.action === "create" && d.type === "owner")}
                        >
                          Proprietário
                        </button>
                        <button
                          type="button"
                          onClick={() => set(c.key, { action: "create", type: "provider" })}
                          className={pill(d?.action === "create" && d.type === "provider")}
                        >
                          Prestador
                        </button>
                        <button
                          type="button"
                          onClick={() => set(c.key, { action: "skip" })}
                          className={pill(d?.action === "skip")}
                        >
                          Ignorar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </IntegrationShell>
        </DialogContent>
      </Dialog>
      <DocPreviewDialog doc={doc} onClose={() => setDoc(null)} />
    </>
  );
}

export type { ImportCandidate };
