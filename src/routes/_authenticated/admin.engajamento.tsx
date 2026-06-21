import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Activity, MessageSquare, Users, BarChart3, Loader2, Bot, User as UserIcon,
  ExternalLink, Phone, Sparkles, AlertTriangle, BookOpen, Library, Home as HomeIcon,
  ThumbsDown, RotateCcw, TrendingUp,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { getEngagementOverview } from "@/lib/engagement-admin.functions";
import { checkIsAdmin } from "@/lib/admin-subs.functions";
import { getConversationMessages } from "@/lib/chat-admin.functions";
import {
  markMessageIneffective, unmarkMessageIneffective, listMyFeedback,
} from "@/lib/chat-feedback.functions";
import { useSubscription } from "@/hooks/useSubscription";
import { AiPlanLock } from "@/components/admin/AiPlanLock";
import { TeachAiDialog } from "@/components/admin/TeachAiDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/engajamento")({
  beforeLoad: async () => {
    try {
      const res = await checkIsAdmin();
      if (!res.isAdmin) throw redirect({ to: "/admin" });
    } catch (e: any) {
      if (e?.isRedirect) throw e;
      throw redirect({ to: "/admin" });
    }
  },
  component: EngagementPage,
});

function fmt(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; }
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  try { const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; } catch { return d; }
}
function normPhone(p: string | null | undefined) {
  return (p ?? "").replace(/\D+/g, "");
}
// Stable identity key per property: ONLY unifies when phone AND checkin match.
// Without both, each row stays distinct (uses log id as key).
function identityKey(propertyId: string, phone: string | null, checkin: string | null, fallbackId: string) {
  const ph = normPhone(phone);
  if (ph && checkin) return `${propertyId}|pc:${ph}|${checkin}`;
  return `${propertyId}|id:${fallbackId}`;
}

function BigNumber({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="text-2xl font-serif">{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function MetricCell({ label, value, tone }: { label: string; value: number | string; tone?: "amber" }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-sm font-semibold tabular-nums mt-0.5 ${tone === "amber" ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</div>
    </div>
  );
}

function EngagementPage() {
  const fn = useServerFn(getEngagementOverview);
  const fbFn = useServerFn(listMyFeedback);
  const { info: sub } = useSubscription();
  const aiLocked = !sub.features.ai;

  const { data, isLoading, refetch } = useQuery({ queryKey: ["admin-engagement"], queryFn: () => fn() });
  const fbQuery = useQuery({ queryKey: ["admin-feedback"], queryFn: () => fbFn() });

  const [filterProp, setFilterProp] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [onlyIneffective, setOnlyIneffective] = useState(false);

  const feedbackByMsg = useMemo(() => {
    const m = new Map<string, { resolved: boolean; reason: string | null }>();
    (fbQuery.data ?? []).forEach((f) => m.set(f.message_id, { resolved: !!f.resolved, reason: f.reason ?? null }));
    return m;
  }, [fbQuery.data]);

  // Unified guest groups: same phone (or same name+checkin) within a property
  // collapses every access + conversation into one entry.
  type GuestGroup = {
    key: string;
    property_id: string;
    property_name: string;
    guest_name: string | null;
    guest_phone: string | null;
    checkin_date: string | null;
    reservation_code: string | null;
    access_count: number;
    first_access: string | null;
    last_access: string | null;
    conversation_ids: string[];
  };

  const guestGroups = useMemo<GuestGroup[]>(() => {
    if (!data) return [];
    const map = new Map<string, GuestGroup>();
    for (const l of data.logs) {
      const key = identityKey(l.property_id, l.guest_phone, l.checkin_date, l.id);
      const g = map.get(key);
      if (!g) {
        map.set(key, {
          key,
          property_id: l.property_id,
          property_name: l.property_name,
          guest_name: l.guest_name,
          guest_phone: l.guest_phone,
          checkin_date: l.checkin_date,
          reservation_code: l.reservation_code,
          access_count: 1,
          first_access: l.created_at,
          last_access: l.created_at,
          conversation_ids: [],
        });
      } else {
        g.access_count++;
        if (l.created_at && (!g.last_access || l.created_at > g.last_access)) g.last_access = l.created_at;
        if (l.created_at && (!g.first_access || l.created_at < g.first_access)) g.first_access = l.created_at;
        g.guest_phone = g.guest_phone || l.guest_phone;
        g.reservation_code = g.reservation_code || l.reservation_code;
        g.guest_name = g.guest_name || l.guest_name;
      }
    }
    const groups = Array.from(map.values());
    return groups
      .filter((g) => {
        if (filterProp !== "all" && g.property_id !== filterProp) return false;
        if (search) {
          const s = search.toLowerCase();
          const hay = `${g.guest_name ?? ""} ${g.reservation_code ?? ""} ${g.guest_phone ?? ""} ${g.property_name}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.last_access ?? "").localeCompare(a.last_access ?? ""));
  }, [data, filterProp, search]);


  // Map property_id + normalized guest name → most recent checkin_date from access logs
  const checkinByGuest = useMemo(() => {
    const m = new Map<string, string>();
    if (!data) return m;
    for (const l of data.logs) {
      if (!l.guest_name || !l.checkin_date) continue;
      const k = `${l.property_id}|${l.guest_name.trim().toLowerCase()}`;
      const prev = m.get(k);
      if (!prev || (l.checkin_date as string) > prev) m.set(k, l.checkin_date as string);
    }
    return m;
  }, [data]);

  const filteredConvs = useMemo(() => {
    if (!data) return [];
    const propFeedback = new Map<string, number>();
    (fbQuery.data ?? []).forEach((f) => {
      propFeedback.set(f.conversation_id, (propFeedback.get(f.conversation_id) ?? 0) + 1);
    });
    return data.conversations
      .map((c) => {
        const k = c.guest_name ? `${c.property_id}|${c.guest_name.trim().toLowerCase()}` : null;
        return {
          ...c,
          feedback_count: propFeedback.get(c.id) ?? 0,
          checkin_date: k ? (checkinByGuest.get(k) ?? null) : null,
        };
      })
      .filter((c) => {
        if (filterProp !== "all" && c.property_id !== filterProp) return false;
        if (onlyIneffective && c.feedback_count === 0) return false;
        if (search) {
          const s = search.toLowerCase();
          const hay = `${c.guest_name ?? ""} ${c.property_name}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      });
  }, [data, fbQuery.data, filterProp, search, onlyIneffective, checkinByGuest]);


  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando engajamento…
      </div>
    );
  }

  const totalAcc = data?.metrics.reduce((a, m) => a + m.total_accesses, 0) ?? 0;
  const totalConv = data?.metrics.reduce((a, m) => a + m.total_conversations, 0) ?? 0;
  const totalMsgs = data?.metrics.reduce((a, m) => a + (m.total_messages ?? 0), 0) ?? 0;
  const totalGuests = data?.metrics.reduce((a, m) => a + m.unique_guests, 0) ?? 0;
  const totalFeedback = (fbQuery.data ?? []).length;
  const unresolvedFeedback = (fbQuery.data ?? []).filter((f) => !f.resolved).length;
  const usageRate = totalAcc > 0 ? Math.round((totalConv / totalAcc) * 100) : 0;
  const hasProps = (data?.properties.length ?? 0) > 0;
  const usability = data?.hostUsability;

  const topProps = [...(data?.metrics ?? [])]
    .sort((a, b) => (b.total_accesses + b.total_conversations) - (a.total_accesses + a.total_conversations))
    .slice(0, 5)
    .map((m) => ({ name: m.property_name.length > 14 ? m.property_name.slice(0, 12) + "…" : m.property_name, acessos: m.total_accesses, conversas: m.total_conversations }));

  const timeseries = (data?.timeseries ?? []).map((d) => ({
    date: d.date.slice(5),
    acessos: d.accesses,
    conversas: d.conversations,
  }));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="mb-6 pb-5 border-b border-border/60">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Administração</p>
        <h1 className="font-serif text-2xl sm:text-3xl">Engajamento</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Dashboards, conversas e métricas consolidadas de todas as suas hospedagens.
        </p>
      </div>

      {!hasProps ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Nenhuma hospedagem cadastrada ainda.</p>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <Select value={filterProp} onValueChange={setFilterProp}>
              <SelectTrigger className="sm:w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as hospedagens</SelectItem>
                {data!.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Buscar por hóspede, código, telefone, hospedagem…" value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" />
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="mb-6 w-full">
              <TabsTrigger value="overview" className="gap-2"><TrendingUp className="size-4" /> Visão geral</TabsTrigger>
              <TabsTrigger value="access" className="gap-2"><Activity className="size-4" /> Acessos</TabsTrigger>
              <TabsTrigger value="chat" className="gap-2">
                <MessageSquare className="size-4" /> Conversas
                {unresolvedFeedback > 0 ? (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-medium">
                    <AlertTriangle className="size-3" /> {unresolvedFeedback}
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="metrics" className="gap-2"><BarChart3 className="size-4" /> Métricas</TabsTrigger>
            </TabsList>

            {/* OVERVIEW */}
            <TabsContent value="overview" className="space-y-6">
              {/* User-side big numbers */}
              <section>
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <Users className="size-3.5" /> Usabilidade do hóspede
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <BigNumber icon={Activity} label="Acessos" value={totalAcc} />
                  <BigNumber icon={Users} label="Hóspedes únicos" value={totalGuests} />
                  <BigNumber icon={MessageSquare} label="Conversas" value={totalConv} />
                  <BigNumber icon={Bot} label="Mensagens IA" value={totalMsgs} />
                  <BigNumber icon={Sparkles} label="Uso da IA" value={`${usageRate}%`} hint="conversas / acessos" />
                  <BigNumber icon={ThumbsDown} label="Ineficácia" value={totalFeedback} hint={`${unresolvedFeedback} sem ensino`} />
                </div>
              </section>

              {/* Evolution chart */}
              <section className="rounded-2xl border border-border bg-card p-4">
                <h3 className="text-sm font-medium mb-3">Evolução nos últimos 30 dias</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer>
                    <LineChart data={timeseries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-muted-foreground/20" />
                      <XAxis dataKey="date" fontSize={11} tickMargin={6} stroke="currentColor" className="text-muted-foreground" />
                      <YAxis fontSize={11} allowDecimals={false} stroke="currentColor" className="text-muted-foreground" />
                      <RTooltip
                        cursor={{ stroke: "#22d3ee", strokeWidth: 1, strokeOpacity: 0.4 }}
                        contentStyle={{
                          background: "rgba(15,15,20,0.92)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 8,
                          color: "#fff",
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "#fff", fontWeight: 600 }}
                        itemStyle={{ color: "#fff" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="acessos" stroke="#22d3ee" strokeWidth={2.5} dot={{ r: 3, fill: "#22d3ee" }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="conversas" stroke="#fbbf24" strokeWidth={2.5} dot={{ r: 3, fill: "#fbbf24" }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Top properties */}
              {topProps.length > 0 ? (
                <section className="rounded-2xl border border-border bg-card p-4">
                  <h3 className="text-sm font-medium mb-3">Top 5 hospedagens por engajamento</h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer>
                      <BarChart data={topProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-muted-foreground/20" />
                        <XAxis dataKey="name" fontSize={11} stroke="currentColor" className="text-muted-foreground" />
                        <YAxis fontSize={11} allowDecimals={false} stroke="currentColor" className="text-muted-foreground" />
                        <RTooltip
                          cursor={{ fill: "rgba(34,211,238,0.08)" }}
                          contentStyle={{
                            background: "rgba(15,15,20,0.92)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 8,
                            color: "#fff",
                            fontSize: 12,
                          }}
                          labelStyle={{ color: "#fff", fontWeight: 600 }}
                          itemStyle={{ color: "#fff" }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="acessos" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="conversas" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              ) : null}

              {/* Host usability */}
              {usability ? (
                <section>
                  <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <UserIcon className="size-3.5" /> Usabilidade do anfitrião
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <BigNumber icon={HomeIcon} label="Guias criados" value={usability.totalGuides} />
                    <BigNumber icon={HomeIcon} label="Publicados" value={usability.publishedGuides} />
                    <BigNumber icon={Library} label="Com FAQs" value={`${usability.guidesWithFaqs}/${usability.totalGuides}`} />
                    <BigNumber icon={BookOpen} label="Conhecimento IA" value={usability.guidesWithKnowledge} hint="blocos ativos" />
                    <BigNumber icon={Bot} label="Comportamento IA" value={usability.guidesWithBehavior} hint="regras ativas" />
                  </div>
                  {usability.lastEditedAt ? (
                    <p className="text-xs text-muted-foreground mt-3">Última edição: {fmt(usability.lastEditedAt)}</p>
                  ) : null}
                </section>
              ) : null}
            </TabsContent>

            {/* ACCESS LOGS — unified by guest identity (phone or name+checkin) */}
            <TabsContent value="access" className="space-y-3">
              {guestGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground py-10 text-center">Nenhum hóspede registrado.</p>
              ) : (
                <div className="rounded-2xl border border-border overflow-hidden">
                  <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
                    <div className="col-span-3">Hóspede</div>
                    <div className="col-span-2">Telefone</div>
                    <div className="col-span-2">Check-in</div>
                    <div className="col-span-2">Acessos</div>
                    <div className="col-span-3">Hospedagem · Último acesso</div>
                  </div>
                  {guestGroups.map((g) => (
                    <div key={g.key} className="grid md:grid-cols-12 gap-2 px-4 py-3 text-sm border-b border-border/60 last:border-b-0">
                      <div className="md:col-span-3 font-medium truncate">
                        {g.guest_name ?? "—"}
                        {g.reservation_code ? <span className="ml-1 text-[11px] text-muted-foreground">· {g.reservation_code}</span> : null}
                      </div>
                      <div className="md:col-span-2 text-muted-foreground flex items-center gap-1 truncate">
                        {g.guest_phone ? <><Phone className="size-3" />{g.guest_phone}</> : "—"}
                      </div>
                      <div className="md:col-span-2 text-muted-foreground">{fmtDate(g.checkin_date)}</div>
                      <div className="md:col-span-2 text-muted-foreground tabular-nums">
                        {g.access_count}
                      </div>
                      <div className="md:col-span-3 text-muted-foreground truncate">{g.property_name} · {fmt(g.last_access)}</div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>


            {/* CONVERSATIONS */}
            <TabsContent value="chat" className="space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={onlyIneffective} onChange={(e) => setOnlyIneffective(e.target.checked)} />
                  Somente conversas com respostas marcadas
                </label>
                {aiLocked ? <AiPlanLock locked badgeOnly>x</AiPlanLock> : null}
              </div>
              {filteredConvs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-10 text-center">Nenhuma conversa.</p>
              ) : (
                <div className="grid lg:grid-cols-2 gap-4">
                  {filteredConvs.map((c) => (
                    <ConversationCard
                      key={c.id}
                      conversationId={c.id}
                      guestName={c.guest_name}
                      propertyName={c.property_name}
                      lastMessageAt={c.last_message_at}
                      feedbackCount={c.feedback_count}
                      feedbackByMsg={feedbackByMsg}
                      aiLocked={aiLocked}
                      onChanged={() => { fbQuery.refetch(); refetch(); }}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* METRICS */}
            <TabsContent value="metrics" className="space-y-3">
              {/* Desktop table */}
              <div className="hidden md:block rounded-2xl border border-border overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
                  <div className="col-span-4">Hospedagem</div>
                  <div className="col-span-1 text-right">Acessos</div>
                  <div className="col-span-1 text-right">Conversas</div>
                  <div className="col-span-1 text-right">Mensagens</div>
                  <div className="col-span-1 text-right">Hóspedes</div>
                  <div className="col-span-1 text-right">Ineficaz</div>
                  <div className="col-span-3">Último acesso</div>
                </div>
                {data!.metrics.map((m) => (
                  <div key={m.property_id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-b border-border/60 last:border-b-0 items-center">
                    <div className="col-span-4 font-medium truncate flex items-center gap-2">
                      <Link to="/g/$slug" params={{ slug: m.property_slug }} target="_blank" className="hover:underline truncate inline-flex items-center gap-1">
                        {m.property_name} <ExternalLink className="size-3 opacity-60" />
                      </Link>
                    </div>
                    <div className="col-span-1 text-right tabular-nums">{m.total_accesses}</div>
                    <div className="col-span-1 text-right tabular-nums">{m.total_conversations}</div>
                    <div className="col-span-1 text-right tabular-nums">{m.total_messages ?? 0}</div>
                    <div className="col-span-1 text-right tabular-nums">{m.unique_guests}</div>
                    <div className="col-span-1 text-right tabular-nums">{m.feedback_count ?? 0}</div>
                    <div className="col-span-3 text-muted-foreground text-xs">{fmt(m.last_access)}</div>
                  </div>
                ))}
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {data!.metrics.map((m) => (
                  <div key={m.property_id} className="rounded-2xl border border-border bg-card p-4">
                    <Link
                      to="/g/$slug"
                      params={{ slug: m.property_slug }}
                      target="_blank"
                      className="font-medium text-sm hover:underline inline-flex items-center gap-1 leading-tight"
                    >
                      <span className="truncate">{m.property_name}</span>
                      <ExternalLink className="size-3 opacity-60 shrink-0" />
                    </Link>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <MetricCell label="Acessos" value={m.total_accesses} />
                      <MetricCell label="Conversas" value={m.total_conversations} />
                      <MetricCell label="Mensagens" value={m.total_messages ?? 0} />
                      <MetricCell label="Hóspedes" value={m.unique_guests} />
                      <MetricCell label="Ineficaz" value={m.feedback_count ?? 0} tone={(m.feedback_count ?? 0) > 0 ? "amber" : undefined} />
                      <div className="col-span-1 rounded-lg bg-secondary/40 px-2 py-1.5">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Último</div>
                        <div className="text-[11px] mt-0.5 text-muted-foreground leading-tight">
                          {m.last_access ? new Date(m.last_access).toLocaleDateString("pt-BR") : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function ConversationCard({
  conversationId, guestName, propertyName, lastMessageAt, feedbackCount, feedbackByMsg, aiLocked, onChanged,
}: {
  conversationId: string;
  guestName: string | null;
  propertyName: string;
  lastMessageAt: string | null;
  feedbackCount: number;
  feedbackByMsg: Map<string, { resolved: boolean; reason: string | null }>;
  aiLocked: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const loadMsgs = useServerFn(getConversationMessages);
  const mark = useServerFn(markMessageIneffective);
  const unmark = useServerFn(unmarkMessageIneffective);
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["conv-msgs", conversationId],
    queryFn: () => loadMsgs({ data: { conversationId } }),
    enabled: open,
  });
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachCtx, setTeachCtx] = useState<{ messageId: string; q: string; a: string } | null>(null);

  async function handleMark(messageId: string) {
    try { await mark({ data: { messageId, reason: null } }); toast.success("Resposta marcada como ineficaz."); refetch(); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }
  async function handleUnmark(messageId: string) {
    try { await unmark({ data: { messageId } }); toast.success("Marcação removida."); refetch(); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  const msgs = data?.messages ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 flex items-center justify-between hover:bg-muted/30 transition"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            {guestName ?? "Hóspede"}
            {feedbackCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-medium">
                <AlertTriangle className="size-3" /> {feedbackCount}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground truncate">{propertyName} · {fmt(lastMessageAt)}</div>
        </div>
        <span className="text-xs text-muted-foreground">{open ? "Recolher" : "Abrir"}</span>
      </button>

      {open ? (
        <div className="border-t border-border bg-background/40 p-3 space-y-3 max-h-[420px] overflow-y-auto">
          {isFetching ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Carregando…</div>
          ) : (
            msgs.map((m, idx) => {
              const isAssistant = m.role === "assistant";
              const fb = feedbackByMsg.get(m.id);
              const prevUser = isAssistant ? [...msgs.slice(0, idx)].reverse().find((x) => x.role === "user") : null;
              return (
                <div key={m.id} className={`rounded-xl p-3 text-sm ${isAssistant ? "bg-muted/50 border border-border" : "bg-primary/5 border border-primary/20"}`}>
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {isAssistant ? <><Bot className="size-3" /> IA</> : <><UserIcon className="size-3" /> Hóspede</>}
                    <span>· {fmt(m.created_at)}</span>
                    {isAssistant && fb ? (
                      <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] ${fb.resolved ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                        {fb.resolved ? <><Sparkles className="size-3" /> Ensinado</> : <><AlertTriangle className="size-3" /> Ineficaz</>}
                      </span>
                    ) : null}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  {isAssistant ? (
                    <div className="mt-2 flex items-center gap-2">
                      {fb ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={aiLocked}
                            onClick={() => { setTeachCtx({ messageId: m.id, q: prevUser?.content ?? "", a: m.content }); setTeachOpen(true); }}
                            className="h-7 text-xs"
                          >
                            <Sparkles className="size-3 mr-1" /> {fb.resolved ? "Reensinar" : "Ensinar a IA"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleUnmark(m.id)} className="h-7 text-xs">
                            <RotateCcw className="size-3 mr-1" /> Desmarcar
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={aiLocked}
                          onClick={() => handleMark(m.id)}
                          className="h-7 text-xs text-muted-foreground hover:text-amber-600"
                        >
                          <ThumbsDown className="size-3 mr-1" /> Marcar como ineficaz
                        </Button>
                      )}
                      {aiLocked ? <AiPlanLock locked badgeOnly>x</AiPlanLock> : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}

      <TeachAiDialog
        open={teachOpen}
        onOpenChange={setTeachOpen}
        messageId={teachCtx?.messageId ?? null}
        userQuestion={teachCtx?.q ?? ""}
        aiAnswer={teachCtx?.a ?? ""}
        onTaught={() => { refetch(); onChanged(); }}
      />
    </div>
  );
}
