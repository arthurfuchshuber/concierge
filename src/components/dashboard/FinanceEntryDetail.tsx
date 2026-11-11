// Detalhe de UM lançamento, na MESMA janela da lista (mockup de 11/11/2026):
// o canto superior direito vira "‹ Voltar" (DialogContent `onBack`), nunca uma
// segunda janela. Serve a Financeiro, Serviços e Limpeza.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Play } from "lucide-react";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import { ClampName } from "@/components/ui/clamp-name";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getFinanceEntryDetail } from "@/lib/finance-entry.functions";

export type FinanceEntry =
  | { kind: "extra"; item: import("@/lib/service-situations").ExtraServiceItem }
  | { kind: "cleaning"; item: import("@/lib/dashboard.functions").CleaningDayItem };

function brl(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function fmtWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border/60 py-2.5 text-[12.5px] first:border-t-0">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold text-foreground">{children}</span>
    </div>
  );
}

export function FinanceEntryDetail({ entry, onNavigate }: { entry: FinanceEntry; onNavigate: () => void }) {
  const fetchDetail = useServerFn(getFinanceEntryDetail);
  const navigate = useNavigate();
  const it = entry.item;
  const q = useQuery({
    queryKey: ["finance-entry-detail", entry.kind, it.id],
    queryFn: () =>
      fetchDetail({ data: { kind: entry.kind, id: it.id, logId: it.logId ?? null, reservationId: it.reservationId ?? null } }),
    staleTime: 60_000,
  });
  const d = q.data;
  const title = entry.kind === "extra" ? entry.item.situationName : "Limpeza concluída";
  const subtitle =
    entry.kind === "extra" ? entry.item.title : entry.item.cleaningType === "completa" ? "Limpeza completa" : "Limpeza normal";
  const stay = d?.reservation
    ? [fmtDay(d.reservation.checkin), fmtDay(d.reservation.checkout)].filter(Boolean).join(" → ")
    : null;
  const done = [fmtWhen(it.concludedAt), it.doneByName].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:pt-6" aria-label={`Detalhe de ${title}`}>
      <DialogHeader className="shrink-0 border-b border-border/40 px-4 pb-2.5 pt-3 pr-24 text-left sm:mx-6">
        <DialogTitle className="truncate text-sm font-bold leading-5 text-foreground" title={title}>
          {title}
        </DialogTitle>
        <p className="truncate text-xs leading-4 text-muted-foreground">{subtitle}</p>
      </DialogHeader>
      <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-2.5 sm:mx-6 [scrollbar-gutter:stable]">
        <ClampName text={it.propertyName} className="font-bold" />
        <OwnerLine name={it.ownerName} phone={it.ownerPhone ?? null} country={it.ownerPhoneCountry ?? null} phonePosition="adjacent" />
        <div className="mt-2">
          <Row label="Valor">{brl(it.priceCents)}</Row>
          {done ? <Row label="Concluído">{done}</Row> : null}
          {d?.reservation ? (
            <Row label="Reserva">
              {[d.reservation.guestName, stay].filter(Boolean).join(" · ") || "—"}
            </Row>
          ) : null}
        </div>
        {d?.description ? (
          <p className="mt-3 whitespace-pre-wrap break-words text-[12.5px] leading-5 text-foreground/85">{d.description}</p>
        ) : null}
        {q.isLoading ? <p className="mt-3 text-xs text-muted-foreground">Carregando…</p> : null}
        {q.isError ? <p className="mt-3 text-xs text-muted-foreground">Não foi possível carregar os detalhes.</p> : null}
        {d && d.media.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {d.media.map((m) =>
              m.url ? (
                <a
                  key={m.id}
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-foreground/[0.06]"
                >
                  {m.kind === "photo" ? (
                    <img src={m.url} alt={m.fileName ?? "Foto"} loading="lazy" className="size-full object-cover" />
                  ) : (
                    <Play className="size-6 text-foreground/70" />
                  )}
                </a>
              ) : null,
            )}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-border px-4 py-3 sm:mx-6">
        <button
          type="button"
          onClick={() => {
            onNavigate();
            void navigate({ to: "/admin/dashboard/registros" });
          }}
          className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-foreground/[0.08] text-[12.5px] font-bold text-foreground transition-colors hover:bg-foreground/[0.14]"
        >
          <ExternalLink className="size-3.5" />
          Abrir registro completo
        </button>
      </div>
    </div>
  );
}
