import { BookCheck, BookX, Hourglass, Percent, Wrench } from "lucide-react";
import { StatCard } from "@/components/ds/StatCard";
import {
  LEARNING_SOURCE_LABEL,
  TELEMETRY_WINDOW_DAYS,
  formatPct,
  type LearningKpis,
  type LearningSourceKey,
  type ToolKpis,
} from "@/lib/admin-ia-telemetry";

const CHIP =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]";

/**
 * Aprendizado contínuo e ferramentas externas (Etapa 4, 10/11/2026) — mesmo cartão de número padrão
 * (Limpeza) da barra de cima. Somente leitura. Sem dado (`null`/sem registro) a página nunca quebra.
 */
export function TelemetryLearningTools({
  learning,
  tools,
  loading,
}: {
  learning: LearningKpis | null;
  tools: ToolKpis | null;
  loading: boolean;
}) {
  const l = learning;
  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-labelledby="ia-learning-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="ia-learning-title" className="ds-eyebrow">
            Aprendizado contínuo
          </h2>
          <span className="min-w-0 text-[12px] text-muted-foreground">
            {l
              ? `${l.proposedWindow} propostas nos últimos ${TELEMETRY_WINDOW_DAYS} dias · total ${l.total}`
              : loading
                ? ""
                : "sem leitura do aprendizado no momento"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard
            label="Pendentes de revisão"
            icon={Hourglass}
            loading={loading}
            value={l ? l.pending : "—"}
            note="aguardando a equipe"
          />
          <StatCard
            label="Aprovadas"
            icon={BookCheck}
            loading={loading}
            value={l ? l.approved : "—"}
            note="no Documento Vivo"
          />
          <StatCard
            label="Rejeitadas / revogadas"
            icon={BookX}
            loading={loading}
            value={l ? `${l.rejected} / ${l.revoked}` : "—"}
            note="fora do prompt"
          />
          <StatCard
            label="Taxa de aprovação"
            icon={Percent}
            loading={loading}
            value={l ? formatPct(l.approvalPct) : "—"}
            note="aprovadas ÷ decididas"
          />
        </div>
        {l ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="ds-eyebrow mr-1">Por origem</span>
            {(Object.keys(LEARNING_SOURCE_LABEL) as LearningSourceKey[]).map((s) => (
              <span key={s} className={CHIP}>
                <b className="tabular-nums">{l.bySource[s] ?? 0}</b> {LEARNING_SOURCE_LABEL[s]}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby="ia-tools-title">
        <h2 id="ia-tools-title" className="ds-eyebrow">
          Ferramentas externas
        </h2>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-[14px] bg-card px-5 py-4 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)]">
          <div className="flex min-w-0 max-w-[680px] items-start gap-3">
            <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="text-[15px] font-semibold text-foreground">Clima, voos, lugares e rotas</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {tools === null || !tools.available
                  ? "Ainda sem registro: as consultas acontecem em memória durante a geração e não são gravadas. Os números aparecem aqui quando o registro for ativado."
                  : null}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            {["Chamadas", "Latência", "Tempo esgotado"].map((t) => (
              <span key={t} className={`${CHIP} text-muted-foreground`}>
                {t} —
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
