import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setStakeholderStatus } from "@/lib/stakeholders.functions";
import {
  effectiveStatus,
  isFutureDate,
  statusChip,
  statusDateLabel,
  statusDot,
  statusLabel,
  statusStyle,
} from "@/lib/stakeholder-status";
import type { StakeholderKind } from "./constants";

export type StakeholderStatusValue =
  | "active"
  | "documentation"
  | "contract"
  | "signature"
  | "paused"
  | "canceled";
type StageValue = "documentation" | "contract" | "signature";

/**
 * O usuário só tem 2 ações reais aqui: reativar o cadastro, ou definir a
 * data final do contrato (o que agenda o cancelamento). "Cancelando" e
 * "Cancelado" nunca são escolhidos diretamente — são derivados dessa data
 * pela mesma regra de data futura que já promove o cadastro sozinho quando
 * o dia chega (`setStakeholderStatus` / `promoteDueStages`). Os estágios
 * antigos (Documentação/Contrato/Assinatura/Pausado) saíram daqui; ainda são
 * reconhecidos em cadastros antigos (rótulo/cor em stakeholder-status.ts),
 * só não são mais oferecidos como opção.
 */
const ACTION_OPTIONS: Array<{ value: "active" | "canceled"; label: string }> = [
  { value: "active", label: "Marcar como Ativo" },
  { value: "canceled", label: "Definir data final do contrato" },
];

const STAGE_OPTIONS: Array<{ value: StageValue; label: string; hint: string }> = [
  { value: "signature", label: "Assinatura", hint: "O contrato já foi enviado" },
  { value: "contract", label: "Contrato", hint: "Contrato pendente de envio" },
  { value: "documentation", label: "Documentação", hint: "Cliente pendente de documentação" },
];

/**
 * Controle de situação do stakeholder — mesma regra em qualquer lugar que o
 * usa (card compacto da lista/Kanban ou cabeçalho da ficha de detalhes):
 * qualquer mudança de status exige a data real da efetivação, e "Ativo" com
 * data futura pede o estágio real (Documentação/Contrato/Assinatura) até lá.
 */
export function StakeholderStatusControl({
  kind,
  id,
  accountOwnerId,
  status,
  statusChangedAt,
  variant = "pill",
  invalidateQueryKeys,
  onChanged,
}: {
  kind: StakeholderKind;
  id: string;
  accountOwnerId?: string | null;
  status: string | null | undefined;
  statusChangedAt?: string | null;
  /** "pill" = selo arredondado (ficha de detalhes); "compact" = texto + ponto (card da lista). */
  variant?: "pill" | "compact";
  /** Query keys extras a invalidar além de ["stakeholders", kind] e ["pending-cancellations"]. */
  invalidateQueryKeys?: unknown[][];
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const statusFn = useServerFn(setStakeholderStatus);
  const [busy, setBusy] = useState(false);
  const [statusDraft, setStatusDraft] = useState<{
    status: StakeholderStatusValue;
    date: string;
    stage: StageValue | null;
  } | null>(null);

  function openStatusDialog(next: StakeholderStatusValue) {
    setStatusDraft({ status: next, date: new Date().toISOString().slice(0, 10), stage: null });
  }

  // "Ativo" com data futura exige escolher o estágio real (Assinatura/Contrato/Documentação).
  const needsStage =
    !!statusDraft &&
    statusDraft.status === "active" &&
    !!statusDraft.date &&
    isFutureDate(statusDraft.date) &&
    !statusDraft.stage;

  async function confirmStatus() {
    if (!statusDraft || needsStage) return;
    setBusy(true);
    try {
      const finalStatus =
        statusDraft.status === "active" && statusDraft.stage ? statusDraft.stage : statusDraft.status;
      await statusFn({
        data: { kind, id, accountOwnerId: accountOwnerId ?? null, status: finalStatus, changed_at: statusDraft.date },
      });
      setStatusDraft(null);
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
      qc.invalidateQueries({ queryKey: ["pending-cancellations"] });
      for (const key of invalidateQueryKeys ?? []) qc.invalidateQueries({ queryKey: key });
      toast.success("Situação atualizada.");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar a situação.");
    } finally {
      setBusy(false);
    }
  }

  const eff = effectiveStatus(status, statusChangedAt);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "pill" ? (
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition hover:opacity-80 ${statusStyle(eff)}`}
            >
              {statusLabel(eff)}
              <ChevronDown className="size-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80 ${statusChip(eff)}`}
            >
              <span className={`size-1.5 shrink-0 rounded-full ${statusDot(eff)}`} />
              {statusLabel(eff)}
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          {ACTION_OPTIONS.map((opt) => (
            <DropdownMenuItem key={opt.value} onSelect={() => openStatusDialog(opt.value)}>
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {variant === "pill" && statusChangedAt && (
        <span
          onClick={(e) => e.stopPropagation()}
          className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground"
        >
          {statusDateLabel(String(statusChangedAt))}
        </span>
      )}

      <Dialog open={!!statusDraft} onOpenChange={(o) => !o && setStatusDraft(null)}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              {statusDraft?.status === "canceled" ? "Data final do contrato" : "Marcar como Ativo"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="status-date">
              {statusDraft?.status === "canceled" ? "Data final" : "Data da alteração"}
            </Label>
            <Input
              id="status-date"
              type="date"
              value={statusDraft?.date ?? ""}
              onChange={(e) =>
                setStatusDraft((d) => (d ? { ...d, date: e.target.value, stage: null } : d))
              }
            />
            <p className="text-xs text-muted-foreground">
              Pode ser uma data futura, se a mudança ainda vai acontecer.
            </p>
          </div>

          {statusDraft?.status === "active" && statusDraft.date && isFutureDate(statusDraft.date) && (
            <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-xs text-foreground">A data é futura. Qual a situação real do cliente até lá?</p>
              <div className="space-y-1.5">
                {STAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusDraft((d) => (d ? { ...d, stage: opt.value } : d))}
                    className={`w-full text-left rounded-md border px-3 py-2 transition ${
                      statusDraft.stage === opt.value
                        ? "border-amber-500/50 bg-amber-500/10"
                        : "border-border hover:bg-secondary/60"
                    }`}
                  >
                    <div className="text-xs font-medium">{opt.label}</div>
                    <div className="ds-meta">{opt.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {statusDraft?.status === "canceled" && statusDraft.date && isFutureDate(statusDraft.date) && (
            <p className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-[11px] text-yellow-600 dark:text-yellow-400">
              O cadastro ficará como <strong>Cancelando</strong> até a data informada. Nesse dia, a equipe
              será consultada para confirmar o cancelamento ou reverter para Ativo.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setStatusDraft(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmStatus} disabled={busy || !statusDraft?.date || needsStage}>
              {busy && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
