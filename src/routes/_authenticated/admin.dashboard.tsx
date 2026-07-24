import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  CalendarCheck, CalendarX, LogIn, LogOut, MessageCircle, StickyNote, Check,
  AlertTriangle, Clock, Loader2, Home, Info, Sparkles, TrendingUp, Bell,
} from "lucide-react";
import { toast } from "sonner";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

/* ---------- Info tooltip ---------- */
function InfoHint({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sobre: ${title}`}
          className="inline-flex size-5 items-center justify-center rounded-full text-current/60 hover:text-current transition-colors opacity-70 hover:opacity-100"
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-64 max-w-[calc(100vw-2rem)] rounded-xl border-border/70 bg-popover/95 backdrop-blur p-3 text-xs leading-relaxed shadow-xl"
      >
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</div>
        <div className="text-foreground/90">{children}</div>
      </PopoverContent>
    </Popover>
  );
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

  type UpsertPayload = {
    logId: string;
    kind: "checkin" | "checkout";
    status?: "pending" | "done";
    note?: string | null;
    arrivalTimeOverride?: string | null;
  };
  const upsert = useMutation({
    mutationFn: (v: UpsertPayload) => upsertFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dash-list"] });
      qc.invalidateQueries({ queryKey: ["dash-kpis"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar."),
  });

  const rows = listQ.data?.rows ?? [];
  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const done = useMemo(() => rows.filter((r) => r.status === "done"), [rows]);

  /* ---------- Attention alerts ---------- */
  const alerts = useMemo(() => {
    const list: Array<{ tone: "warn" | "info" | "success"; icon: React.ElementType; text: React.ReactNode }> = [];
    const k = kpisQ.data;
    const e = engQ.data;

    if (k && k.checkinsTomorrow > 0) {
      list.push({
        tone: "info",
        icon: Bell,
        text: <>Amanhã: <b className="tabular-nums">{k.checkinsTomorrow}</b> check-in{k.checkinsTomorrow > 1 ? "s" : ""} — revise horários e mensagens.</>,
      });
    }
    if (e && e.checkinsInPeriod > 0) {
      const gap = e.checkinsInPeriod - e.checkinTabOpens;
      if (gap > 0) {
        list.push({
          tone: "warn",
          icon: AlertTriangle,
          text: <><b className="tabular-nums">{gap}</b> hóspede{gap > 1 ? "s" : ""} ainda não abriu a aba <i>Chegada</i> — considere avisar.</>,
        });
      } else {
        list.push({
          tone: "success",
          icon: Sparkles,
          text: <>Todos os hóspedes do período abriram a aba <i>Chegada</i>.</>,
        });
      }
    }
    const divergentCount = rows.filter((r) => {
      const t = r.arrivalTimeOverride ?? r.guestArrivalTime;
      return t && r.standardTime && !isTimeWithin(t, r.standardTime, r.standardTimeMax);
    }).length;
    if (divergentCount > 0) {
      list.push({
        tone: "warn",
        icon: Clock,
        text: <><b className="tabular-nums">{divergentCount}</b> horário{divergentCount > 1 ? "s" : ""} divergente{divergentCount > 1 ? "s" : ""} do padrão.</>,
      });
    }
    const icalMismatch = rows.filter((r) => r.ical.hasIcal && !r.ical.matched).length;
    if (icalMismatch > 0) {
      list.push({
        tone: "warn",
        icon: AlertTriangle,
        text: <><b className="tabular-nums">{icalMismatch}</b> sem reserva correspondente no iCal Airbnb.</>,
      });
    }
    return list;
  }, [kpisQ.data, engQ.data, rows]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl tracking-tight">Dashboard operacional</h1>
        <p className="text-sm text-muted-foreground">Sua rotina diária: check-ins, check-outs e engajamento do guia.</p>
      </header>

      {/* Attention strip */}
      {alerts.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
          {alerts.map((a, i) => {
            const tone =
              a.tone === "warn"
                ? "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25"
                : a.tone === "success"
                ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/25"
                : "bg-primary/10 text-primary border-primary/20";
            const Icon = a.icon;
            return (
              <div
                key={i}
                className={`shrink-0 snap-start inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs sm:text-sm ${tone}`}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="whitespace-nowrap">{a.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Check-ins hoje" value={kpisQ.data?.checkinsToday} icon={LogIn} tone="primary"
          loading={kpisQ.isLoading}
          hint="Hóspedes com chegada prevista para hoje, deduplicados por unidade + nome."
        />
        <KpiCard
          label="Check-ins amanhã" value={kpisQ.data?.checkinsTomorrow} icon={LogIn} tone="primary-soft"
          loading={kpisQ.isLoading}
          hint="Prepare mensagens, códigos de acesso e limpeza. Base para o alerta acima."
        />
        <KpiCard
          label="Check-outs hoje" value={kpisQ.data?.checkoutsToday} icon={LogOut} tone="primary"
          loading={kpisQ.isLoading}
          hint="Saídas previstas para hoje — considere o turno de limpeza subsequente."
        />
        <KpiCard
          label="Check-outs amanhã" value={kpisQ.data?.checkoutsTomorrow} icon={LogOut} tone="primary-soft"
          loading={kpisQ.isLoading}
          hint="Saídas previstas para amanhã — planeje a virada com sua equipe."
        />
      </section>

      {/* Engagement */}
      <section className="rounded-2xl border border-border bg-gradient-to-br from-surface to-surface/60 p-4 sm:p-6 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
              <TrendingUp className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold flex items-center gap-1">
                Engajamento do guia
                <InfoHint title="Engajamento do guia">
                  Compara quantos hóspedes com check-in no período efetivamente acessaram o guia e abriram a aba <b>Chegada</b>. Base para saber se sua comunicação está funcionando.
                </InfoHint>
              </div>
              <div className="text-xs text-muted-foreground">Comparativo com os check-ins do período</div>
            </div>
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
      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
              <TabBtn active={kind === "checkin"} onClick={() => setKind("checkin")} icon={CalendarCheck}>Check-ins</TabBtn>
              <TabBtn active={kind === "checkout"} onClick={() => setKind("checkout")} icon={CalendarX}>Check-outs</TabBtn>
            </div>
            <InfoHint title="Fila de chegadas / saídas">
              Cada card representa um hóspede. Marque <b>Realizado</b> para tirar da fila, use <b>WhatsApp</b> para falar direto, e a <b>Nota</b> fica visível só para sua equipe.
            </InfoHint>
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

function KpiCard({ label, value, icon: Icon, tone, loading, hint }: {
  label: string; value: number | undefined; icon: React.ElementType;
  tone: "primary" | "primary-soft"; loading: boolean; hint: string;
}) {
  const toneClass = tone === "primary"
    ? "bg-gradient-to-br from-primary to-primary/85 text-primary-foreground border-primary/30 shadow-md shadow-primary/10"
    : "bg-gradient-to-br from-primary/12 to-primary/5 text-primary border-primary/20";
  return (
    <div className={`relative rounded-2xl border p-4 sm:p-5 transition-transform hover:-translate-y-0.5 ${toneClass}`}>
      <div className="absolute right-2 top-2">
        <InfoHint title={label}>{hint}</InfoHint>
      </div>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-85 pr-6">
        <Icon className="size-4" /> <span className="truncate">{label}</span>
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
    <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs bg-background/60">
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
      <BarRow label="Abriram aba Chegada" value={checkinTabOpens} total={checkins} pct={bar(checkinTabOpens)} />
    </div>
  );
}
function BarRow({ label, value, total, pct }: { label: string; value: number; total: number; pct: number }) {
  const health = pct >= 80 ? "from-emerald-500 to-emerald-400" : pct >= 50 ? "from-primary to-primary/80" : "from-amber-500 to-amber-400";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground text-xs">{value} / {total} check-ins</span>
      </div>
      <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${health} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
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
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold flex items-center gap-2">
        <span className="h-px w-6 bg-border" />
        {title}
      </div>
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
    <div className={`group relative rounded-2xl border p-4 space-y-3 transition-all ${done ? "bg-surface/60 border-border/60" : "bg-gradient-to-br from-surface to-surface/70 border-border shadow-sm hover:shadow-md hover:-translate-y-0.5"}`}>
      {!done && <span aria-hidden className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r bg-primary/70" />}

      <div className="flex items-start gap-3">
        <div className="size-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary grid place-items-center font-semibold shrink-0 ring-1 ring-primary/10">
          {initials(row.guestName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{row.guestName}</div>
          <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
            <Home className="size-3 shrink-0" /> {row.propertyName ?? "Sem nome"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{kind === "checkin" ? "Check-in" : "Check-out"}</div>
          <div className="text-sm font-medium tabular-nums">{fmtDateBR(row.date)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-secondary/50 p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
            <span>Padrão</span>
            <InfoHint title="Horário padrão">Janela configurada na propriedade para chegada/saída. Base para detectar divergências.</InfoHint>
          </div>
          <div className="mt-0.5 tabular-nums">{stdWindow ?? "—"}</div>
        </div>
        <div className={`rounded-lg p-2 ${divergent ? "bg-amber-500/10 border border-amber-500/30" : "bg-secondary/50"}`}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
            <span>Previsto</span>
            <InfoHint title="Horário previsto">Horário informado pelo hóspede no formulário de acesso — ou ajustado por você ao alinhar com o iCal.</InfoHint>
          </div>
          <div className="mt-0.5 tabular-nums flex items-center gap-1">
            <Clock className="size-3" /> {guestTime ?? "—"}
          </div>
        </div>
      </div>

      {row.ical.hasIcal && (
        <div className={`text-xs rounded-lg px-2 py-1.5 flex items-center gap-2 ${row.ical.matched ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
          {row.ical.matched ? <Check className="size-3.5 shrink-0" /> : <AlertTriangle className="size-3.5 shrink-0" />}
          <span className="min-w-0 truncate">
            {row.ical.matched
              ? `Confirmado no iCal Airbnb (${row.ical.icalCheckin ? fmtDateBR(row.ical.icalCheckin) : "?"} → ${row.ical.icalCheckout ? fmtDateBR(row.ical.icalCheckout) : "?"})`
              : "Sem reserva correspondente no iCal Airbnb"}
          </span>
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
          className={`text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 font-medium transition-colors ${done ? "bg-secondary hover:bg-secondary/80" : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20"}`}
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
