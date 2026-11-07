import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import { useIsMobile } from "@/hooks/use-mobile";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import {
  OPS_ACTION_LABEL,
  STAY_PHASE_LABEL,
  SURFACE_LABEL,
  formatBrl,
  formatClock,
  formatMs,
  formatUsd,
  modelLabel,
} from "@/lib/admin-ia-telemetry";
import { getAiTelemetryDetail, type TelemetryOpsView } from "@/lib/admin-ia-telemetry.functions";
import { OutcomeChip } from "./OutcomeChip";

const WELL =
  "rounded-[12px] bg-foreground/[0.025] p-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)]";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="ds-eyebrow">{title}</h3>
      {children}
    </section>
  );
}

function Kv({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{k}</span>
      <span className="truncate text-[13.5px] font-semibold tabular-nums">{v}</span>
      {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

const yesNo = (v: boolean | null) => (v === null ? "—" : v ? "Sim" : "Não");
const SENDER: Record<string, string> = {
  resolved: "Identificado",
  unavailable: "Indisponível",
  ambiguous: "Ambíguo",
  invalid: "Inválido",
  not_applicable: "Não se aplica",
  not_evaluated: "Não avaliado",
};

function OpsCard({ o }: { o: TelemetryOpsView }) {
  const head = `${OPS_ACTION_LABEL[o.action] ?? o.action} · ${
    o.outcome === "applied"
      ? "aplicada"
      : o.outcome === "refused"
        ? `recusada${o.code ? ` (${o.code})` : ""}`
        : o.outcome
  }${o.mode === "shadow" ? " · sombra" : ""}`;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12.5px] font-semibold">{head}</span>
      <div className="grid grid-cols-2 gap-2.5">
        <div className={`${WELL} flex min-w-0 flex-col gap-2`}>
          <span className="text-[11px] font-bold text-muted-foreground">Antes</span>
          {(o.before ?? [{ label: "Card", value: "Sem card" }]).map((r) => (
            <Kv key={r.label} k={r.label} v={r.value} />
          ))}
        </div>
        <div
          className={`${WELL} flex min-w-0 flex-col gap-2 ${o.after ? "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--success)_45%,transparent)]" : ""}`}
        >
          <span
            className={`text-[11px] font-bold ${o.after ? "text-success" : "text-muted-foreground"}`}
          >
            {o.appliedAt ? `Depois · ${formatClock(o.appliedAt)}` : "Depois"}
          </span>
          {(o.after ?? [{ label: "Card", value: "Sem alteração" }]).map((r) => (
            <Kv key={r.label} k={r.label} v={r.value} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Raio-X de uma inferência: painel lateral no desktop, folha de baixo no celular (teto 90dvh). */
export function TelemetryInspector({ id, onClose }: { id: string | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  const detailFn = useServerFn(getAiTelemetryDetail);
  const q = useQuery({
    queryKey: ["admin-ia-telemetry-detail", id],
    queryFn: () => detailFn({ data: { id: id! } }),
    enabled: !!id,
    staleTime: 30_000,
  });
  const d = q.data;

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
            : "flex h-auto max-h-[90dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px] md:inset-y-auto md:right-4 md:top-4 md:rounded-2xl md:border"
        }
      >
        <SheetHeader className="gap-1.5 border-b border-foreground/[0.06] px-5 pb-3.5 pt-5 text-left">
          <p className="ds-eyebrow ds-data text-[10.5px] tracking-[0.16em]">
            Raio-X{d ? ` · ${formatClock(d.row.startedAt)}` : ""}
          </p>
          <SheetTitle className="font-display text-[17px] font-bold">
            {d?.propertyName ?? "Carregando…"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Detalhes técnicos de uma resposta do Copiloto
          </SheetDescription>
          {d ? (
            <>
              <OwnerLine
                name={d.ownerName}
                phone={d.ownerPhone}
                country={d.ownerPhoneCountry}
                phonePosition="adjacent"
              />
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <span className="rounded-full bg-foreground/[0.08] px-2.5 py-[3px] text-[11px] font-bold">
                  {SURFACE_LABEL[d.row.surface]}
                </span>
                <OutcomeChip outcome={d.outcome} code={d.row.outcomeCode ?? d.row.gatewayError} />
                <span className="rounded-full bg-foreground/[0.08] px-2.5 py-[3px] text-[11px] font-bold">
                  {d.row.modelId ?? "—"}
                </span>
              </div>
            </>
          ) : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
          {q.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : q.error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {friendlyErrorMessage(q.error)}
            </p>
          ) : d ? (
            <div className="flex flex-col gap-[18px]">
              <Section title={`Mensagem do hóspede${d.guestName ? ` · ${d.guestName}` : ""}`}>
                <div
                  className={`${WELL} whitespace-pre-wrap break-words text-[13.5px] leading-relaxed`}
                >
                  {d.guestText ?? "—"}
                </div>
              </Section>

              {d.suggestedText ? (
                <Section
                  title={
                    d.row.state === "sent"
                      ? d.editedText
                        ? "Resposta sugerida · enviada com edição"
                        : "Resposta sugerida · enviada sem edição"
                      : "Resposta sugerida"
                  }
                >
                  <div
                    className={`${WELL} whitespace-pre-wrap break-words text-[13.5px] leading-relaxed`}
                  >
                    {d.suggestedText}
                  </div>
                  {d.editedText ? (
                    <div
                      className={`${WELL} whitespace-pre-wrap break-words text-[13.5px] leading-relaxed`}
                    >
                      <span className="mb-1 block text-[11px] font-bold text-muted-foreground">
                        Texto editado pela equipe
                      </span>
                      {d.editedText}
                    </div>
                  ) : null}
                </Section>
              ) : null}

              <Section title="Gateway">
                <div className={`${WELL} grid grid-cols-2 gap-x-3.5 gap-y-3 sm:grid-cols-3`}>
                  <Kv k="Tokens de entrada" v={d.row.inputTokens?.toLocaleString("pt-BR") ?? "—"} />
                  <Kv k="Tokens de saída" v={d.row.outputTokens?.toLocaleString("pt-BR") ?? "—"} />
                  <Kv k="Latência" v={formatMs(d.row.latencyMs)} />
                  <Kv
                    k="Custo exato"
                    v={formatUsd(d.row.costUsd, 8)}
                    sub={formatBrl(d.row.costUsd)}
                  />
                  <Kv k="Tentativas" v={d.row.attempts} />
                  <Kv k="Modelo" v={modelLabel(d.row.modelId)} />
                </div>
              </Section>

              <Section title="Contexto usado">
                <div className={`${WELL} grid grid-cols-2 gap-x-3.5 gap-y-3 sm:grid-cols-3`}>
                  <Kv
                    k="Fase da estadia"
                    v={
                      d.row.stayPhase ? (STAY_PHASE_LABEL[d.row.stayPhase] ?? d.row.stayPhase) : "—"
                    }
                  />
                  <Kv k="Reserva vinculada" v={yesNo(d.row.reservationLinked)} />
                  <Kv
                    k="Histórico"
                    v={d.row.historyMessages !== null ? `${d.row.historyMessages} mensagens` : "—"}
                  />
                  <Kv
                    k="Remetente"
                    v={
                      d.row.senderIdentity
                        ? (SENDER[d.row.senderIdentity] ?? d.row.senderIdentity)
                        : "—"
                    }
                  />
                  <Kv k="Humano no comando" v={yesNo(d.row.humanInCommand)} />
                  <Kv k="Canal" v={SURFACE_LABEL[d.row.surface]} />
                </div>
                <div className={`${WELL} flex items-center justify-between gap-3`}>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-foreground/[0.08] px-2.5 py-[3px] text-[11px] font-bold">
                      Fatos do Dossiê
                    </span>
                    <span className="font-display text-[15px] font-bold tabular-nums">
                      {d.row.dossierEntries ?? "—"}
                    </span>
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    Minimizado por privacidade
                  </span>
                </div>
              </Section>

              <Section title="D9 · credenciais">
                <div className={`${WELL} flex items-center justify-between gap-3`}>
                  <span className="text-[13.5px] font-semibold">
                    {d.row.credentialPolicy === "allow"
                      ? "Liberação permitida"
                      : d.row.credentialPolicy === "deny"
                        ? "Liberação negada"
                        : "Não avaliado"}
                  </span>
                  {d.row.credentialPolicy ? (
                    <span
                      className={`rounded-full px-2.5 py-[3px] text-[11px] font-bold ${
                        d.row.credentialPolicy === "allow"
                          ? "bg-success/15 text-success"
                          : "bg-warning/15 text-warning"
                      }`}
                    >
                      {d.row.credentialPolicy}
                    </span>
                  ) : null}
                </div>
              </Section>

              <Section title="Card do imóvel · antes e depois">
                {d.ops.length ? (
                  d.ops.map((o) => <OpsCard key={o.id} o={o} />)
                ) : (
                  <div className={`${WELL} text-[13px] text-muted-foreground`}>
                    Nenhuma ação nos cards nesta mensagem.
                  </div>
                )}
              </Section>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
