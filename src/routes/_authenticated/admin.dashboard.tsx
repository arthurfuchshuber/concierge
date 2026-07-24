import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  CalendarCheck, CalendarX, LogIn, LogOut, MessageCircle, StickyNote, Check,
  AlertTriangle, Clock, Loader2, Home,
} from "lucide-react";
import { toast } from "sonner";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
  getDashboardKpis, getGuideEngagement, listDashboardArrivals, upsertArrivalStatus,
  type ArrivalRow,
} from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard operacional — ConciergeIA" },
      { name: "description", content: "Painel operacional diário do anfitrião: check-ins, check-outs e engajamento do guia." },
    ],
  }),
  component: DashboardPage,
});

function fmtDateBR(iso: string) {
  try { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; } catch { return iso; }
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function waLink(phone: string | null, country: string | null): string | null {
  if (!phone) return null;
  const raw = `${country ?? ""}${phone}`.replace(/[^\d+]/g, "");
  const p = parsePhoneNumberFromString(raw.startsWith("+") ? raw : `+${raw}`);
  if (p && p.isValid()) return `https://wa.me/${p.number.replace("+", "")}`;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

function DashboardPage() {
  const kpisFn = useServerFn(getDashboardKpis);
  const engFn = useServerFn(getGuideEngagement);
  const listFn = useServerFn(listDashboardArrivals);
  const upsertFn = useServerFn(upsertArrivalStatus);
  const qc = useQueryClient();

  const [kind, setKind] = useState<"checkin" | "checkout">("checkin");
  const [range, setRange] = useState<"today" | "tomorrow" | "7d" | "all">("today");
  const [engRange, setEngRange] = useState<"today" | "7d" | "30d">("7d");

  const kpisQ = useQuery({ queryKey: ["dash-kpis"], queryFn: () => kpisFn(), staleTime: 60_000 });
  const engQ = useQuery({
    queryKey: ["dash-eng", engRange],
    queryFn: () => engFn({ data: { range: engRange } }),
    staleTime: 60_000,
  });
  const listQ = useQuery({
    queryKey: ["dash-list", kind, range],
    queryFn: () => listFn({ data: { kind, range } }),
    staleTime: 30_000,
  });

  const upsert = useMutation({
    mutationFn: (v: Parameters<typeof upsertFn>[0]["data"]) => upsertFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dash-list"] });
      qc.invalidateQueries({ queryKey: ["dash-kpis"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar."),
  });

  const rows = listQ.data?.rows ?? [];
  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const done = useMemo(() => rows.filter((r) => r.status === "done"), [rows]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl">Dashboard operacional</h1>
        <p className="text-sm text-muted-foreground">Sua rotina diária: check-ins, check-outs e engajamento do guia.</p>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Check-ins hoje" value={kpisQ.data?.checkinsToday} icon={LogIn} tone="primary" loading={kpisQ.isLoading} />
        <KpiCard label="Check-ins amanhã" value={kpisQ.data?.checkinsTomorrow} icon={LogIn} tone="primary-soft" loading={kpisQ.isLoading} />
        <KpiCard label="Check-outs hoje" value={kpisQ.data?.checkoutsToday} icon={LogOut} tone="primary" loading={kpisQ.isLoading} />
        <KpiCard label="Check-outs amanhã" value={kpisQ.data?.checkoutsTomorrow} icon={LogOut} tone="primary-soft" loading={kpisQ.isLoading} />
      </section>

      {/* Engagement */}
      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Engajamento do guia</div>
            <div className="text-xs text-muted-foreground">Comparativo com os check-ins do período</div>
          </div>
          <RangeSelect value={engRange} onChange={setEngRange} options={[["today", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"]]} />
        </div>
        <EngagementBars
          loading={engQ.isLoading}
          checkins={engQ.data?.checkinsInPeriod ?? 0}
          guideOpens={engQ.data?.guideOpens ?? 0}
          checkinTabOpens={engQ.data?.checkinTabOpens ?? 0}
        />
      </section>

      {/* Arrivals */}
      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
            <TabBtn active={kind === "checkin"} onClick={() => setKind("checkin")} icon={CalendarCheck}>Check-ins</TabBtn>
            <TabBtn active={kind === "checkout"} onClick={() => setKind("checkout")} icon={CalendarX}>Check-outs</TabBtn>
          </div>
          <RangeSelect
            value={range}
            onChange={setRange}
            options={[["today", "Hoje"], ["tomorrow", "Amanhã"], ["7d", "7 dias"], ["all", "Todos"]]}
          />
        </div>

        {listQ.isLoading ? (
          <div className="py-12 grid place-items-center text-muted-foreground text-sm">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum {kind === "checkin" ? "check-in" : "check-out"} no período.
          </div>
        ) : (
          <div className="space-y-6">
            <ArrivalGroup
              title={`Pendentes (${pending.length})`}
              rows={pending}
              kind={kind}
              onMark={(row) => upsert.mutate({ logId: row.logId, kind, status: "done" })}
              onSyncIcal={(row) => {
                const t = kind === "checkin" ? "15:00" : "11:00";
                upsert.mutate({ logId: row.logId, kind, arrivalTimeOverride: t });
                toast.success(`Horário alinhado ao iCal (${t}).`);
              }}
              onNote={(row, note) => upsert.mutate({ logId: row.logId, kind, note })}
              busy={upsert.isPending}
            />
            {done.length > 0 && (
              <ArrivalGroup
                title={`Realizados (${done.length})`}
                rows={done}
                kind={kind}
                onMark={(row) => upsert.mutate({ logId: row.logId, kind, status: "pending" })}
                onSyncIcal={() => {}}
                onNote={(row, note) => upsert.mutate({ logId: row.logId, kind, note })}
                busy={upsert.isPending}
                muted
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------- UI Building Blocks ------------------------- */

function KpiCard({ label, value, icon: Icon, tone, loading }: {
  label: string; value: number | undefined; icon: React.ElementType; tone: "primary" | "primary-soft"; loading: boolean;
}) {
  const toneClass = tone === "primary"
    ? "bg-primary text-primary-foreground border-primary/30"
    : "bg-primary/10 text-primary border-primary/20";
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80">
        <Icon className="size-4" /> {label}
      </div>
      <div className="mt-2 text-3xl sm:text-4xl font-display leading-none tabular-nums">
        {loading ? "—" : value ?? 0}
      </div>
    </div>
  );
}

function RangeSelect<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: Array<[T, string]>;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 transition-colors ${value === v ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
        >{label}</button>
      ))}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 inline-flex items-center gap-2 transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
    >
      <Icon className="size-4" /> {children}
    </button>
  );
}

function EngagementBars({ loading, checkins, guideOpens, checkinTabOpens }: {
  loading: boolean; checkins: number; guideOpens: number; checkinTabOpens: number;
}) {
  const base = Math.max(checkins, 1);
  const bar = (num: number) => Math.min(100, Math.round((num / base) * 100));
  if (loading) return <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="size-4 inline animate-spin" /></div>;
  return (
    <div className="space-y-4">
      <BarRow label="Acessos ao guia" value={guideOpens} total={checkins} pct={bar(guideOpens)} />
      <BarRow label="Abriram aba Check-in" value={checkinTabOpens} total={checkins} pct={bar(checkinTabOpens)} />
    </div>
  );
}
function BarRow({ label, value, total, pct }: { label: string; value: number; total: number; pct: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{value} / {total} check-ins</span>
      </div>
      <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ArrivalGroup({ title, rows, kind, onMark, onSyncIcal, onNote, busy, muted }: {
  title: string;
  rows: ArrivalRow[];
  kind: "checkin" | "checkout";
  onMark: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  busy: boolean;
  muted?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{title}</div>
      <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 ${muted ? "opacity-70" : ""}`}>
        {rows.map((r) => (
          <ArrivalCard key={r.logId} row={r} kind={kind} onMark={onMark} onSyncIcal={onSyncIcal} onNote={onNote} busy={busy} />
        ))}
      </div>
    </div>
  );
}

function ArrivalCard({ row, kind, onMark, onSyncIcal, onNote, busy }: {
  row: ArrivalRow; kind: "checkin" | "checkout";
  onMark: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  busy: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(row.note ?? "");
  const guestTime = row.arrivalTimeOverride ?? row.guestArrivalTime;
  const stdWindow = row.standardTime
    ? row.standardTimeMax ? `${row.standardTime} – ${row.standardTimeMax}` : row.standardTime
    : null;
  const divergent =
    !!guestTime && !!row.standardTime &&
    !isTimeWithin(guestTime, row.standardTime, row.standardTimeMax);
  const wa = waLink(row.guestPhone, row.guestPhoneCountry);
  const done = row.status === "done";

  return (
    <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${done ? "bg-surface/60 border-border/60" : "bg-surface border-border shadow-sm"}`}>
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center font-semibold shrink-0">
          {initials(row.guestName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{row.guestName}</div>
          <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
            <Home className="size-3" /> {row.propertyName ?? "Sem nome"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{kind === "checkin" ? "Check-in" : "Check-out"}</div>
          <div className="text-sm font-medium tabular-nums">{fmtDateBR(row.date)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-secondary/50 p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Padrão</div>
          <div className="mt-0.5 tabular-nums">{stdWindow ?? "—"}</div>
        </div>
        <div className={`rounded-lg p-2 ${divergent ? "bg-amber-500/10 border border-amber-500/30" : "bg-secondary/50"}`}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Previsto</div>
          <div className="mt-0.5 tabular-nums flex items-center gap-1">
            <Clock className="size-3" /> {guestTime ?? "—"}
          </div>
        </div>
      </div>

      {row.ical.hasIcal && (
        <div className={`text-xs rounded-lg px-2 py-1.5 flex items-center gap-2 ${row.ical.matched ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
          {row.ical.matched ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          {row.ical.matched
            ? `Confirmado no iCal Airbnb (${row.ical.icalCheckin ? fmtDateBR(row.ical.icalCheckin) : "?"} → ${row.ical.icalCheckout ? fmtDateBR(row.ical.icalCheckout) : "?"})`
            : "Sem reserva correspondente no iCal Airbnb"}
        </div>
      )}

      {divergent && (
        <div className="text-xs rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5" /> Horário divergente do padrão</span>
          <button
            onClick={() => onSyncIcal(row)}
            className="text-xs underline underline-offset-2 hover:no-underline"
            disabled={busy}
          >Alinhar</button>
        </div>
      )}

      {row.note && (
        <div className="text-xs rounded-lg bg-secondary/40 px-2 py-1.5 flex items-start gap-1.5">
          <StickyNote className="size-3.5 mt-0.5 shrink-0" /> <span className="whitespace-pre-wrap">{row.note}</span>
        </div>
      )}

      {noteOpen && (
        <div className="space-y-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Nota interna (visível só para sua equipe)"
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setNoteOpen(false)} className="text-xs px-2 py-1 rounded-md hover:bg-secondary">Cancelar</button>
            <button
              onClick={() => { onNote(row, noteText.trim() || null); setNoteOpen(false); }}
              className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground"
              disabled={busy}
            >Salvar</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() => onMark(row)}
          disabled={busy}
          className={`text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 font-medium ${done ? "bg-secondary hover:bg-secondary/80" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
        >
          <Check className="size-3.5" /> {done ? "Reabrir" : "Realizado"}
        </button>
        {wa && (
          <a
            href={wa} target="_blank" rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 inline-flex items-center gap-1.5"
          >
            <MessageCircle className="size-3.5" /> WhatsApp
          </a>
        )}
        <button
          onClick={() => setNoteOpen((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 inline-flex items-center gap-1.5"
        >
          <StickyNote className="size-3.5" /> {row.note ? "Editar nota" : "Nota"}
        </button>
      </div>
    </div>
  );
}

function isTimeWithin(t: string, min: string, max: string | null): boolean {
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const v = toMin(t);
  const a = toMin(min);
  const b = max ? toMin(max) : a + 60;
  return v >= a - 30 && v <= b + 30;
}
