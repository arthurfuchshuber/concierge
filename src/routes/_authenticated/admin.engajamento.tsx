import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, MessageSquare, Users, BarChart3, Loader2, Bot, User as UserIcon,
  ExternalLink, Phone, Sparkles, AlertTriangle, BookOpen, Library, Home as HomeIcon,
  ThumbsDown, RotateCcw, TrendingUp, Smartphone, Monitor, Tablet, Layers, CheckCircle2,
  Radio,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { getEngagementOverview } from "@/lib/engagement-admin.functions";
import { getLivePresence } from "@/lib/guide-analytics.functions";
import { checkIsAdmin } from "@/lib/admin-subs.functions";
import { getConversationMessages } from "@/lib/chat-admin.functions";
import {
  markMessageIneffective, unmarkMessageIneffective, listMyFeedback,
} from "@/lib/chat-feedback.functions";
import { useSubscription } from "@/hooks/useSubscription";
import { AiPlanLock } from "@/components/admin/AiPlanLock";
import { TeachAiDialog } from "@/components/admin/TeachAiDialog";
import { supabase } from "@/integrations/supabase/client";
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
      <div className="text-2xl font-display">{value}</div>
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
  const presenceFn = useServerFn(getLivePresence);
  const { info: sub } = useSubscription();
  const aiLocked = !sub.features.ai;
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({ queryKey: ["admin-engagement"], queryFn: () => fn() });
  const fbQuery = useQuery({ queryKey: ["admin-feedback"], queryFn: () => fbFn() });
  const presenceQuery = useQuery({
    queryKey: ["admin-live-presence"],
    queryFn: () => presenceFn(),
    refetchInterval: 15000,
  });

  const [filterProp, setFilterProp] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [onlyIneffective, setOnlyIneffective] = useState(false);

  // Realtime — invalida presença ao chegar novo evento de seção
  useEffect(() => {
    const ch = supabase
      .channel("admin-live-presence")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "guide_section_events" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-live-presence"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);

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

  // Sorted access logs per property for nearest-time lookup
  const logsByProperty = useMemo(() => {
    type LogRow = NonNullable<typeof data>["logs"][number];
    const out = new Map<string, LogRow[]>();
    if (!data) return out;
    for (const l of data.logs) {
      const arr = out.get(l.property_id) ?? [];
      arr.push(l);
      out.set(l.property_id, arr);
    }
    return out;
  }, [data]);

  // Enrich each conversation with name/phone/checkin (fallback to nearest log).
  const enrichedConvs = useMemo(() => {
    if (!data) return [] as Array<{
      id: string;
      property_id: string;
      property_name: string;
      guest_name: string | null;
      guest_phone: string | null;
      checkin_date: string | null;
      last_message_at: string | null;
      created_at: string;
      feedback_count: number;
    }>;
    const propFeedback = new Map<string, number>();
    (fbQuery.data ?? []).forEach((f) => {
      propFeedback.set(f.conversation_id, (propFeedback.get(f.conversation_id) ?? 0) + 1);
    });
    function nearestLog(propertyId: string, when: string | null) {
      if (!when) return null;
      const arr = logsByProperty.get(propertyId);
      if (!arr || arr.length === 0) return null;
      const t = new Date(when).getTime();
      let best = arr[0];
      let bestDiff = Math.abs(new Date(arr[0].created_at).getTime() - t);
      for (let i = 1; i < arr.length; i++) {
        const d = Math.abs(new Date(arr[i].created_at).getTime() - t);
        if (d < bestDiff) { bestDiff = d; best = arr[i]; }
      }
      return best;
    }
    return data.conversations.map((c) => {
      let name = c.guest_name?.trim() || null;
      let checkin: string | null = null;
      let phone: string | null = null;
      if (name) {
        const k = `${c.property_id}|${name.toLowerCase()}`;
        checkin = checkinByGuest.get(k) ?? null;
      }
      const log = nearestLog(c.property_id, c.last_message_at ?? c.created_at);
      if (log) {
        if (!name) name = log.guest_name?.trim() || null;
        if (!checkin) checkin = log.checkin_date ?? null;
        phone = log.guest_phone ?? null;
      }
      return {
        id: c.id,
        property_id: c.property_id,
        property_name: c.property_name,
        guest_name: name,
        guest_phone: phone,
        checkin_date: checkin,
        last_message_at: c.last_message_at,
        created_at: c.created_at,
        feedback_count: propFeedback.get(c.id) ?? 0,
      };
    });
  }, [data, fbQuery.data, checkinByGuest, logsByProperty]);

  // Group conversations by identity (property + phone + checkin), fallback to
  // (property + lowercased name + checkin), final fallback to conv.id (no merge).
  type ConvGroup = {
    key: string;
    property_id: string;
    property_name: string;
    guest_name: string | null;
    guest_phone: string | null;
    checkin_date: string | null;
    last_message_at: string | null;
    feedback_count: number;
    conversation_ids: string[];
  };

  const filteredConvs = useMemo<ConvGroup[]>(() => {
    const groups = new Map<string, ConvGroup>();
    for (const c of enrichedConvs) {
      const ph = normPhone(c.guest_phone);
      let key: string;
      if (ph && c.checkin_date) key = `${c.property_id}|pc:${ph}|${c.checkin_date}`;
      else if (c.guest_name && c.checkin_date)
        key = `${c.property_id}|nc:${c.guest_name.trim().toLowerCase()}|${c.checkin_date}`;
      else key = `${c.property_id}|id:${c.id}`;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, {
          key,
          property_id: c.property_id,
          property_name: c.property_name,
          guest_name: c.guest_name,
          guest_phone: c.guest_phone,
          checkin_date: c.checkin_date,
          last_message_at: c.last_message_at,
          feedback_count: c.feedback_count,
          conversation_ids: [c.id],
        });
      } else {
        g.conversation_ids.push(c.id);
        g.feedback_count += c.feedback_count;
        g.guest_name = g.guest_name || c.guest_name;
        g.guest_phone = g.guest_phone || c.guest_phone;
        g.checkin_date = g.checkin_date || c.checkin_date;
        if (c.last_message_at && (!g.last_message_at || c.last_message_at > g.last_message_at)) {
          g.last_message_at = c.last_message_at;
        }
      }
    }
    return Array.from(groups.values())
      .filter((g) => {
        if (filterProp !== "all" && g.property_id !== filterProp) return false;
        if (onlyIneffective && g.feedback_count === 0) return false;
        if (search) {
          const s = search.toLowerCase();
          const hay = `${g.guest_name ?? ""} ${g.guest_phone ?? ""} ${g.property_name}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
  }, [enrichedConvs, filterProp, onlyIneffective, search]);


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
        <h1 className="font-display text-2xl sm:text-3xl">Engajamento</h1>
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
            <TabsList className="mb-6 w-full flex-wrap h-auto gap-1">
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
              <TabsTrigger value="comportamento" className="gap-2"><Layers className="size-4" /> Comportamento</TabsTrigger>
              <TabsTrigger value="guias" className="gap-2"><CheckCircle2 className="size-4" /> Guias</TabsTrigger>
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
                      key={c.key}
                      conversationIds={c.conversation_ids}
                      guestName={c.guest_name}
                      checkinDate={c.checkin_date}
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

            {/* COMPORTAMENTO DO HÓSPEDE — dispositivos, seções, funil */}
            <TabsContent value="comportamento" className="space-y-6">
              {/* Device breakdown */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-2xl border border-border bg-card p-4">
                  <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                    <Smartphone className="size-4 text-muted-foreground" /> Dispositivos dos hóspedes
                  </h3>
                  {(() => {
                    const dev = data?.deviceBreakdown ?? { mobile: 0, tablet: 0, desktop: 0 };
                    const total = dev.mobile + dev.tablet + dev.desktop || 1;
                    const items = [
                      { label: "Mobile", value: dev.mobile, icon: Smartphone, color: "#22d3ee" },
                      { label: "Desktop", value: dev.desktop, icon: Monitor, color: "#fbbf24" },
                      { label: "Tablet", value: dev.tablet, icon: Tablet, color: "#a78bfa" },
                    ];
                    return (
                      <div className="space-y-3">
                        {items.map((it) => {
                          const pct = Math.round((it.value / total) * 100);
                          const Icon = it.icon;
                          return (
                            <div key={it.label} className="flex items-center gap-3">
                              <Icon className="size-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="font-medium">{it.label}</span>
                                  <span className="text-muted-foreground tabular-nums">{it.value} ({pct}%)</span>
                                </div>
                                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: it.color }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* AI adoption funnel */}
                <div className="rounded-2xl border border-border bg-card p-4">
                  <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                    <Bot className="size-4 text-muted-foreground" /> Funil de engajamento com IA
                  </h3>
                  <div className="space-y-3">
                    {[
                      { label: "Acessaram o guia", value: totalAcc, color: "bg-accent/30" },
                      { label: "Iniciaram conversa", value: totalConv, color: "bg-accent/60" },
                      { label: "Enviaram mensagens", value: totalMsgs, color: "bg-accent" },
                    ].map((step, i) => {
                      const pct = totalAcc > 0 ? Math.round((step.value / totalAcc) * 100) : 0;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-[11px] text-muted-foreground w-5 tabular-nums shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="font-medium">{step.label}</span>
                              <span className="text-muted-foreground tabular-nums">{step.value.toLocaleString("pt-BR")} {i > 0 ? `(${pct}%)` : ""}</span>
                            </div>
                            <div className="h-2 rounded-full bg-secondary overflow-hidden">
                              <div className={`h-full rounded-full ${step.color} transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Sections accessed */}
              {(data?.sectionEvents?.length ?? 0) > 0 && (
                <section className="rounded-2xl border border-border bg-card p-4">
                  <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                    <Layers className="size-4 text-muted-foreground" /> Seções mais acessadas do guia
                  </h3>
                  <div className="space-y-2">
                    {(data?.sectionEvents ?? []).slice(0, 10).map((s, i) => {
                      const max = data!.sectionEvents[0]?.count ?? 1;
                      const pct = Math.round((s.count / max) * 100);
                      return (
                        <div key={s.section} className="flex items-center gap-3">
                          <span className="text-[11px] text-muted-foreground w-4 tabular-nums shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="font-medium capitalize">{s.section}</span>
                              <span className="text-muted-foreground tabular-nums">{s.count}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div className="h-full rounded-full bg-accent/70 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </TabsContent>

            {/* GUIAS — completude e saúde de cada guia */}
            <TabsContent value="guias" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Score de completude de cada guia — baseado em: publicado, foto de capa, tagline, Wi-Fi, instruções de check-in, regras e senha do Wi-Fi.
              </p>
              <div className="rounded-2xl border border-border overflow-hidden">
                <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
                  <div className="col-span-4">Guia</div>
                  <div className="col-span-2">Status</div>
                  <div className="col-span-4">Completude</div>
                  <div className="col-span-2 text-right">Score</div>
                </div>
                {(data?.hostUsability?.guideCompleteness ?? [])
                  .sort((a, b) => a.score - b.score)
                  .map((g) => (
                    <div key={g.id} className="grid md:grid-cols-12 gap-2 px-4 py-3 border-b border-border/60 last:border-b-0 items-center">
                      <div className="md:col-span-4 font-medium text-sm truncate">{g.name}</div>
                      <div className="md:col-span-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${g.published ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                          {g.published ? "Publicado" : "Rascunho"}
                        </span>
                      </div>
                      <div className="md:col-span-4">
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${g.score >= 80 ? "bg-emerald-500" : g.score >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${g.score}%` }}
                          />
                        </div>
                      </div>
                      <div className={`md:col-span-2 text-right text-sm font-semibold tabular-nums ${g.score >= 80 ? "text-emerald-600 dark:text-emerald-400" : g.score >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                        {g.score}%
                      </div>
                    </div>
                  ))}
              </div>
            </TabsContent>

            {/* METRICS */}
            <TabsContent value="metrics" className="space-y-3">
              {/* Desktop table */}
              <div className="hidden md:block rounded-2xl border border-border overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
                  <div className="col-span-3">Hospedagem</div>
                  <div className="col-span-1 text-right">Acessos</div>
                  <div className="col-span-1 text-right">Conversas</div>
                  <div className="col-span-1 text-right">Mensagens</div>
                  <div className="col-span-1 text-right">Hóspedes</div>
                  <div className="col-span-1 text-right">IA %</div>
                  <div className="col-span-1 text-right">Ineficaz</div>
                  <div className="col-span-3">Último acesso</div>
                </div>
                {data!.metrics.map((m) => (
                  <div key={m.property_id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-b border-border/60 last:border-b-0 items-center">
                    <div className="col-span-3 font-medium truncate flex items-center gap-2">
                      <Link to="/g/$slug" params={{ slug: m.property_slug }} target="_blank" className="hover:underline truncate inline-flex items-center gap-1">
                        {m.property_name} <ExternalLink className="size-3 opacity-60" />
                      </Link>
                    </div>
                    <div className="col-span-1 text-right tabular-nums">{m.total_accesses}</div>
                    <div className="col-span-1 text-right tabular-nums">{m.total_conversations}</div>
                    <div className="col-span-1 text-right tabular-nums">{m.total_messages ?? 0}</div>
                    <div className="col-span-1 text-right tabular-nums">{m.unique_guests}</div>
                    <div className={`col-span-1 text-right tabular-nums font-medium ${(m.ai_adoption_rate ?? 0) >= 30 ? "text-emerald-600 dark:text-emerald-400" : (m.ai_adoption_rate ?? 0) >= 10 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {m.ai_adoption_rate ?? 0}%
                    </div>
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
  conversationIds, guestName, checkinDate, propertyName, lastMessageAt, feedbackCount, feedbackByMsg, aiLocked, onChanged,
}: {
  conversationIds: string[];
  guestName: string | null;
  checkinDate: string | null;
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
  const ids = useMemo(() => [...conversationIds].sort(), [conversationIds]);
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["conv-msgs-group", ids],
    queryFn: async () => {
      const all = await Promise.all(ids.map((id) => loadMsgs({ data: { conversationId: id } })));
      const merged = all.flatMap((r) => r.messages ?? []);
      merged.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
      return { messages: merged };
    },
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
  const nameLabel = guestName?.trim() || "Hóspede";
  const checkinLabel = checkinDate ? fmtDate(checkinDate) : null;
  const title = checkinLabel ? `${nameLabel} — ${checkinLabel}` : nameLabel;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-muted/30 transition"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium flex items-center gap-2 min-w-0">
            <span className="truncate">{title}</span>
            {ids.length > 1 ? (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {ids.length} conversas
              </span>
            ) : null}
            {feedbackCount > 0 ? (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-medium">
                <AlertTriangle className="size-3" /> {feedbackCount}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground truncate">{propertyName} · {fmt(lastMessageAt)}</div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{open ? "Recolher" : "Abrir"}</span>
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
