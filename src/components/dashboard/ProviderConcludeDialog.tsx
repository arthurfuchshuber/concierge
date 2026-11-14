import { useEffect, useState } from "react";
import { Check, CircleX, Info, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CoverImage } from "@/components/ui/cover-image";
import { MoneyInput } from "@/components/ui/money-input";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { AttachmentPicker, type PendingAttachment } from "@/components/dashboard/TaskAttachments";
import type { TaskRow } from "@/lib/tasks-types";
import { cn } from "@/lib/utils";

export type ProviderReportValues = {
  outcome: "resolved" | "failed";
  amountCents: number | null;
  note: string | null;
  files: PendingAttachment[];
};

const LABEL = "text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const AMBER = "#e2b45a";

function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * "CONCLUIR PENDÊNCIA" DO PRESTADOR (mockups DECIDIR · C1, aprovados em 13/11/2026).
 *
 * Quem resolve na ponta (o prestador) não vê a parte financeira: diz se resolveu ou não, quanto quer
 * receber, como resolveu e anexa a prova. "Resolvido" deixa a pendência "Aguardando aprovação" — o
 * anfitrião aprova na janela financeira, que mostra este relato no topo. Valor diferente do original
 * avisa que vai para aprovação interna. "Não consegui" pede o motivo, não tem valor e mantém a pendência
 * aberta no checklist do próximo checkout.
 */
export function ProviderConcludeDialog({
  task,
  covers,
  onOpenChange,
  onConfirm,
}: {
  task: TaskRow | null;
  covers: string[];
  onOpenChange: (v: boolean) => void;
  onConfirm: (v: ProviderReportValues) => Promise<void>;
}) {
  const original = task?.amountSpentCents ?? null;
  const [outcome, setOutcome] = useState<"resolved" | "failed">("resolved");
  const [cents, setCents] = useState<number | null>(original);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!task) return;
    setOutcome("resolved");
    setCents(task.amountSpentCents ?? null);
    setEditing(false);
    setNote("");
    setReason("");
    setFiles([]);
    setSaving(false);
  }, [task?.id]);

  const changed = outcome === "resolved" && original != null && cents != null && cents !== original;
  const title = task ? task.title.replace(/^(Objeto esquecido|Dano|Incidente|Manutenção|Limpeza|Auditoria de Limpeza): /, "") : "";

  async function submit() {
    if (saving) return;
    if (outcome === "failed" && !reason.trim()) {
      toast.error("Conte por que não deu para resolver.");
      return;
    }
    setSaving(true);
    try {
      await onConfirm({
        outcome,
        amountCents: outcome === "resolved" ? cents : null,
        note: outcome === "failed" ? reason.trim() : note.trim() || null,
        files,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para salvar agora.");
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!task} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent
        cover
        aria-describedby={undefined}
        className="flex max-h-[min(96dvh,calc(100dvh_-_var(--kb-inset,0px)_-_1rem))] w-[min(358px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
      >
        <div className="relative h-[140px] shrink-0 overflow-hidden bg-secondary/60">
          <div className="absolute inset-0 origin-center scale-[1.04] [filter:blur(1.5px)_brightness(.9)]">
            <CoverImage urls={covers} empty={false} />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(34,30,27,0)_25%,rgba(34,30,27,.82)_100%)]" />
          <div className="absolute inset-x-4 bottom-2.5 min-w-0 pr-8">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/90">Concluir pendência</div>
            <DialogTitle className="mt-1 block truncate text-sm font-bold leading-[18px] text-white">
              {task?.propertyName ?? "Imóvel"}
            </DialogTitle>
            {task?.ownerName && (
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-white">
                <span className="truncate">{task.ownerName}</span>
                <span className="-my-1.5 shrink-0">
                  <PhoneActionButton phone={task.ownerPhone} country={task.ownerPhoneCountry} size={13} alwaysShow />
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="sg-elegant-scroll flex min-h-0 flex-auto flex-col gap-2 overflow-y-auto px-4 pb-3.5 pt-2.5">
          <div className="rounded-[3px] border border-border/60 bg-foreground/[0.04] px-2.5 py-[7px]">
            <div className={LABEL}>Situação</div>
            <div className="mt-0.5 text-[12.5px] font-bold leading-[1.35]">{title}</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["resolved", "Resolvido", Check],
                ["failed", "Não consegui", CircleX],
              ] as const
            ).map(([k, label, Icon]) => {
              const on = outcome === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setOutcome(k)}
                  className={cn(
                    "flex h-8 min-h-0 items-center justify-center gap-1.5 rounded-lg text-[12.5px]",
                    on
                      ? "bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] font-bold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_60%,transparent)]"
                      : "font-semibold text-muted-foreground",
                  )}
                >
                  <Icon className={cn("size-3.5", on && "text-[var(--accent)]")} strokeWidth={on && k === "resolved" ? 3 : 2} />
                  {label}
                </button>
              );
            })}
          </div>

          {outcome === "resolved" ? (
            <>
              <div>
                <label
                  className="flex h-11 min-w-0 items-center justify-between gap-2 rounded-[3px] border bg-background px-2.5"
                  style={{ borderColor: changed || editing ? AMBER : undefined }}
                >
                  <div className="min-w-0 flex-1">
                    <span className={cn("block", LABEL)}>Valor a receber</span>
                    {editing ? (
                      <MoneyInput
                        cents={cents}
                        onChange={setCents}
                        placeholder="0,00"
                        className="h-5 w-full border-0 bg-transparent p-0 text-[12.5px] font-bold shadow-none focus-visible:ring-0"
                      />
                    ) : (
                      <span className="block truncate text-[12.5px] font-bold">{money(cents)}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Editar valor"
                    onClick={() => setEditing(true)}
                    className="inline-flex flex-none"
                    style={{ color: AMBER }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </label>
                {changed && (
                  <div
                    className="mt-1.5 flex items-start gap-2 rounded-[3px] px-2.5 py-2"
                    style={{
                      background: `color-mix(in oklab, ${AMBER} 12%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${AMBER} 35%, transparent)`,
                    }}
                  >
                    <Info className="mt-px size-3.5 flex-none" style={{ color: AMBER }} />
                    <div className="text-[11px] leading-[1.4]">
                      <span className="font-bold" style={{ color: AMBER }}>
                        Vai para aprovação interna.
                      </span>{" "}
                      <span className="text-muted-foreground">
                        Valor original: {money(original)}. O novo valor não entra no financeiro até alguém aprovar ou editar.
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-input bg-background px-2.5 py-2">
                <div className={LABEL}>Como foi resolvido</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="O que você fez"
                  className="mt-1 block min-h-[17.5px] w-full resize-none bg-transparent text-[12.5px] leading-[1.4] outline-none placeholder:text-muted-foreground"
                />
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-input bg-background px-2.5 py-2">
                <div className={LABEL}>
                  Por que não deu <span className="normal-case tracking-normal text-destructive">(obrigatório)</span>
                </div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="O que faltou para resolver"
                  className="mt-1 block min-h-[17.5px] w-full resize-none bg-transparent text-[12.5px] leading-[1.4] outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-foreground/[0.04] px-2.5 py-2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_9%,transparent)]">
                <Info className="mt-px size-3.5 flex-none text-muted-foreground" />
                <div className="text-[11px] leading-[1.4] text-muted-foreground">
                  <b className="text-foreground">Continua aberta.</b> Volta para o checklist do próximo checkout e o
                  anfitrião vê o motivo. Sem valor a receber.
                </div>
              </div>
            </>
          )}

          <div className="rounded-lg border border-dashed border-input bg-background px-2.5 pb-1.5 pt-2">
            <div className={LABEL}>
              Anexos <span className="font-normal normal-case tracking-normal">(opcional)</span>
            </div>
            <div className="mt-2">
              <AttachmentPicker files={files} onChange={setFiles} disabled={saving} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-4 py-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-[5px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          >
            {saving ? "Salvando…" : outcome === "failed" ? "Salvar" : "Concluir"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
