import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import { getAiDivergences, getRecentLearnings } from "@/lib/admin-ia-telemetry.functions";
import { undoLearningEntry, updateLearningEntryScope } from "@/lib/guest-ai-learning.functions";
import { SCOPE_LABEL, type LearningScope } from "@/lib/guest-ai-learning/qualify";
import { TELEMETRY_WINDOW_DAYS } from "@/lib/admin-ia-telemetry";
import { friendlyErrorMessage } from "@/lib/friendly-error";

const CARD = "rounded-[14px] bg-card shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)]";
const SECONDARY_BTN =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] px-4 text-[14px] font-medium text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] hover:bg-secondary disabled:opacity-50";
const SCOPES: LearningScope[] = ["property", "city", "account"];

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "dd/MM · HH:mm");
}

/**
 * Governança por exceção (mockup aprovado em 10/11/2026): divergências com o Dossiê e aprendidos recentemente,
 * com "Reverter ao Dossiê", "Desfazer" e escopo Imóvel/Cidade/Conta em 1 clique. Nada aqui espera aprovação.
 */
export function TelemetryLearningPanels() {
  const qc = useQueryClient();
  const divFn = useServerFn(getAiDivergences);
  const recFn = useServerFn(getRecentLearnings);
  const undoFn = useServerFn(undoLearningEntry);
  const scopeFn = useServerFn(updateLearningEntryScope);
  const [error, setError] = useState<string | null>(null);
  const div = useQuery({ queryKey: ["ai-divergences"], queryFn: () => divFn() });
  const rec = useQuery({ queryKey: ["ai-recent-learnings"], queryFn: () => recFn() });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["ai-divergences"] });
    void qc.invalidateQueries({ queryKey: ["ai-recent-learnings"] });
    void qc.invalidateQueries({ queryKey: ["admin-ia-telemetry"] });
  };
  const undo = useMutation({
    mutationFn: (id: string) => undoFn({ data: { id } }),
    onSuccess: refresh,
    onError: (e) => setError(friendlyErrorMessage(e, "Não foi possível desfazer.")),
  });
  const scope = useMutation({
    mutationFn: (v: { id: string; scope: LearningScope }) => scopeFn({ data: v }),
    onSuccess: refresh,
    onError: (e) => setError(friendlyErrorMessage(e, "Não foi possível ajustar o escopo.")),
  });

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded-[14px] bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section className="space-y-3" aria-labelledby="ia-divergences-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="ia-divergences-title" className="ds-eyebrow">
            Divergências com o Dossiê
          </h2>
          {div.data ? (
            <span className="text-[12px] text-muted-foreground">
              {div.data.length === 0 ? "nenhuma" : `${new Set(div.data.map((d) => d.propertyName)).size} imóveis`}
            </span>
          ) : null}
        </div>
        {div.isLoading ? (
          <Loading />
        ) : !div.data || div.data.length === 0 ? (
          <Empty text="Nenhum aprendizado ativo diverge do cadastro dos imóveis." />
        ) : (
          div.data.map((d) => (
            <article key={d.entryId} className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`}>
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="ds-card-title break-words">{d.propertyName}</p>
                  <OwnerLine name={d.ownerName} phone={d.ownerPhone} country={d.ownerPhoneCountry} phonePosition="adjacent" className="mt-1" />
                </div>
                <span className="text-[12px] text-muted-foreground">
                  {d.decidedByName ?? "Equipe"} · {formatWhen(d.decidedAt)}
                </span>
              </div>
              <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-secondary px-3 py-2.5">
                  <span className="ds-eyebrow">Dossiê (original) · {d.dossierLabel}</span>
                  <span className="break-words text-[14px] leading-relaxed text-muted-foreground">{d.dossierExcerpt}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-secondary px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_22%,transparent)]">
                  <span className="ds-eyebrow">Documento Vivo (respondendo agora)</span>
                  <span className="break-words text-[14px] leading-relaxed text-foreground">{d.livingStatement}</span>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className={SECONDARY_BTN}
                  disabled={undo.isPending}
                  onClick={() => undo.mutate(d.entryId)}
                >
                  {undo.isPending && undo.variables === d.entryId ? <Loader2 className="size-4 animate-spin" /> : null}
                  Reverter ao Dossiê
                </button>
              </div>
            </article>
          ))
        )}
      </section>

      <section className="space-y-3" aria-labelledby="ia-recent-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="ia-recent-title" className="ds-eyebrow">
            Aprendidos recentemente
          </h2>
          <span className="text-[12px] text-muted-foreground">últimos {TELEMETRY_WINDOW_DAYS} dias</span>
        </div>
        {rec.isLoading ? (
          <Loading />
        ) : !rec.data || rec.data.length === 0 ? (
          <Empty text="A IA ainda não aprendeu nada novo neste período." />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rec.data.map((r) => (
              <li key={r.entryId} className={`${CARD} flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3.5`}>
                <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
                  <span className="break-words text-[14px] leading-relaxed">{r.statement}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {r.propertyName}
                    {r.replicas > 0 ? ` · réplica em ${r.replicas} ${r.replicas === 1 ? "imóvel" : "imóveis"}` : ""} ·{" "}
                    {r.decidedByName ?? "Equipe"} {formatWhen(r.decidedAt)}
                  </span>
                  <OwnerLine name={r.ownerName} phone={r.ownerPhone} country={r.ownerPhoneCountry} phonePosition="adjacent" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div role="group" aria-label="Escopo" className="flex gap-0.5 rounded-[10px] bg-secondary p-[3px]">
                    {SCOPES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={r.scope === s}
                        disabled={scope.isPending || r.scope === s}
                        onClick={() => scope.mutate({ id: r.entryId, scope: s })}
                        className={`min-h-9 rounded-[8px] px-3 text-[13px] font-medium ${
                          r.scope === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {SCOPE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  <button type="button" className={SECONDARY_BTN} disabled={undo.isPending} onClick={() => undo.mutate(r.entryId)}>
                    Desfazer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Loading() {
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Carregando…
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return <p className={`${CARD} px-4 py-4 text-[13px] text-muted-foreground`}>{text}</p>;
}
