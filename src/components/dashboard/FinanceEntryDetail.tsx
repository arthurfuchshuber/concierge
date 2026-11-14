// Detalhe de UM lançamento, na MESMA janela da lista (mockup de 11/11/2026):
// o canto superior direito vira "‹ Voltar" (DialogContent `onBack`), nunca uma
// segunda janela. Serve a Financeiro, Serviços e Limpeza.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Play } from "lucide-react";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
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

function fmtShort(iso: string | null | undefined): string | null {
  const f = fmtDay(iso);
  return f ? f.slice(0, 5) : null;
}

function fmtWhenFull(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

const CAP = "text-[10.5px] font-bold uppercase tracking-[0.08em] text-[var(--faint)]";

/** Linha do mockup: rótulo pequeno em cima, valor embaixo; divisor de ponta a ponta. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-foreground/[0.08] px-[18px] py-2.5 first:border-t-0">
      <div className={CAP}>{label}</div>
      <div className="mt-0.5 min-w-0 break-words text-[13.5px] font-semibold leading-[1.35] text-foreground">{children}</div>
    </div>
  );
}

/** Limpeza completa aguardando aprovação: mesmo detalhe, com os botões de decisão no rodapé. */
export type ApprovalExtra = { normalPriceCents: number | null; footer: React.ReactNode };

export function FinanceEntryDetail({
  entry,
  onNavigate,
  approval,
}: {
  entry: FinanceEntry;
  onNavigate: () => void;
  approval?: ApprovalExtra;
}) {
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
  /** Abre os Registros já filtrados (imóvel ou hóspede) e fecha a janela. */
  const openRecords = (term: string) => {
    onNavigate();
    void navigate({ to: "/admin/dashboard/registros", search: { q: term } });
  };
  const ext = entry.kind === "extra";
  const title = ext ? entry.item.situationName : entry.item.cleaningType === "completa" ? "Limpeza completa" : "Limpeza normal";
  const subtitle = approval ? "Aguardando aprovação" : ext ? "Serviço extra · concluído" : "Limpeza · concluída";
  const stay = d?.reservation
    ? [fmtShort(d.reservation.checkin), fmtShort(d.reservation.checkout)].filter(Boolean).join(" → ")
    : null;
  const reservaTxt = d?.reservation ? [d.reservation.guestName, stay].filter(Boolean).join(" · ") : "";
  const mediaCount = d?.media.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:pt-6" aria-label={`Detalhe de ${title}`}>
      <DialogHeader className="shrink-0 border-b border-foreground/[0.08] px-[18px] pb-3 pt-[18px] pr-24 text-left sm:mx-6">
        <DialogTitle className="truncate font-display text-[17px] font-extrabold leading-[1.2] text-foreground" title={title}>
          {title}
        </DialogTitle>
        <p className="truncate text-[12.5px] text-muted-foreground">{subtitle}</p>
      </DialogHeader>
      <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain sm:mx-6 [scrollbar-gutter:stable]">
        <Field label="Imóvel">{it.propertyName}</Field>
        {it.ownerName ? (
          <Field label="Proprietário(a)">
            <OwnerLine name={it.ownerName} phone={it.ownerPhone ?? null} country={it.ownerPhoneCountry ?? null} phonePosition="adjacent" size={15} className="!text-[13.5px]" />
          </Field>
        ) : null}
        {it.concludedAt ? <Field label={ext ? "Concluído em" : "Concluída em"}>{fmtWhenFull(it.concludedAt)}</Field> : null}
        {it.doneByName ? (
          <Field label={ext ? "Executado por" : "Executada por"}>
            {[it.doneByName, ext ? entry.item.doneByRole : null].filter(Boolean).join(" · ")}
          </Field>
        ) : null}
        {reservaTxt ? (
          <button
            type="button"
            onClick={() => openRecords(d?.reservation?.guestName || it.propertyName)}
            className="flex w-full cursor-pointer items-center justify-between gap-2.5 border-t border-foreground/[0.08] px-[18px] py-2.5 text-left transition-colors active:bg-foreground/[0.05]"
          >
            <span className="min-w-0">
              <span className={`block ${CAP}`}>{ext ? "Reserva" : "Reserva (saída)"}</span>
              <span className="mt-0.5 block break-words text-[13.5px] font-semibold leading-[1.35] text-foreground">{reservaTxt}</span>
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-foreground/45" strokeWidth={2.2} aria-hidden />
          </button>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-foreground/[0.08] px-[18px] pb-2.5 pt-[11px]">
          <span className={CAP}>{approval ? "Valor pedido" : "Valor"}</span>
          <span className="font-display text-[19px] font-extrabold tabular-nums text-foreground">{brl(it.priceCents)}</span>
        </div>
        {approval?.normalPriceCents != null ? (
          <div className="flex items-baseline justify-between gap-3 px-[18px] pb-2.5 pt-0.5">
            <span className={CAP}>Se foi normal</span>
            <span className="text-[13.5px] font-bold tabular-nums text-muted-foreground">{brl(approval.normalPriceCents)}</span>
          </div>
        ) : null}
        {d?.description ? (
          <div className="border-t border-foreground/[0.08] px-[18px] pt-2.5">
            <div className={CAP}>O que aconteceu</div>
            <p className="mt-[5px] whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-foreground/[0.88]">{d.description}</p>
          </div>
        ) : null}
        {q.isLoading ? <p className="px-4 py-3 text-xs text-muted-foreground">Carregando…</p> : null}
        {q.isError ? <p className="px-4 py-3 text-xs text-muted-foreground">Não foi possível carregar os detalhes.</p> : null}
        {mediaCount > 0 ? (
          <div className="mt-2.5 border-t border-foreground/[0.08] px-[18px] pb-1.5 pt-3">
            <div className={`mb-[7px] ${CAP}`}>{ext ? "Fotos e vídeos" : "Fotos da conferência"} · {mediaCount}</div>
            <div className="flex gap-2 overflow-x-auto">
              {d!.media.map((m) =>
                m.url ? (
                  <a
                    key={m.id}
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="relative grid h-[72px] w-[88px] flex-none place-items-center overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--foreground)_14%,transparent),color-mix(in_oklab,var(--foreground)_6%,transparent))] text-foreground/45 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)]"
                  >
                    {m.kind === "photo" ? (
                      <img src={m.url} alt={m.fileName ?? "Foto"} loading="lazy" className="size-full object-cover" />
                    ) : (
                      <Play className="size-4" />
                    )}
                  </a>
                ) : null,
              )}
            </div>
          </div>
        ) : null}
      </div>
      <div className={approval ? "shrink-0 border-t border-border/60 px-4 py-3 sm:mx-6" : "shrink-0 px-[18px] pb-[18px] pt-2 sm:mx-6"}>
        {approval ? (
          approval.footer
        ) : (
          /* Mockup det-lanc-b: botão discreto de 40px, sem ícone, sem divisória em cima. */
          <button
            type="button"
            onClick={() => openRecords(it.propertyName)}
            className="flex h-10 w-full cursor-pointer items-center justify-center rounded-lg bg-foreground/[0.04] text-[12.5px] font-bold text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)] transition-colors hover:bg-foreground/[0.07]"
          >
            Abrir registro completo
          </button>
        )}
      </div>
    </div>
  );
}
