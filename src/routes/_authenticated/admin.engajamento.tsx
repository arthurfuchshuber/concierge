import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Activity, MessageSquare, Users, BarChart3, Loader2, Bot, User as UserIcon, ExternalLink, Phone } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getEngagementOverview } from "@/lib/engagement-admin.functions";
import { getConversationMessages } from "@/lib/chat-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/engajamento")({
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

function EngagementPage() {
  const fn = useServerFn(getEngagementOverview);
  const { data, isLoading } = useQuery({ queryKey: ["admin-engagement"], queryFn: () => fn() });
  const [filterProp, setFilterProp] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filteredLogs = useMemo(() => {
    if (!data) return [];
    return data.logs.filter((l) => {
      if (filterProp !== "all" && l.property_id !== filterProp) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = `${l.guest_name ?? ""} ${l.reservation_code ?? ""} ${l.guest_phone ?? ""} ${l.property_name}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [data, filterProp, search]);

  const filteredConvs = useMemo(() => {
    if (!data) return [];
    return data.conversations.filter((c) => {
      if (filterProp !== "all" && c.property_id !== filterProp) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = `${c.guest_name ?? ""} ${c.property_name}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [data, filterProp, search]);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando engajamento…
      </div>
    );
  }

  const totalAcc = data?.metrics.reduce((a, m) => a + m.total_accesses, 0) ?? 0;
  const totalConv = data?.metrics.reduce((a, m) => a + m.total_conversations, 0) ?? 0;
  const totalGuests = data?.metrics.reduce((a, m) => a + m.unique_guests, 0) ?? 0;
  const hasProps = (data?.properties.length ?? 0) > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="mb-6 pb-5 border-b border-border/60">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Administração</p>
        <h1 className="font-serif text-2xl sm:text-3xl">Engajamento</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Visão consolidada de acessos, conversas e métricas de todas as suas hospedagens.
        </p>
      </div>

      {!hasProps ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <Activity className="size-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Você ainda não tem hospedagens publicadas.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <SummaryCard icon={<Activity className="size-4" />} label="Total de acessos" value={totalAcc} />
            <SummaryCard icon={<MessageSquare className="size-4" />} label="Conversas no chat" value={totalConv} />
            <SummaryCard icon={<Users className="size-4" />} label="Hóspedes únicos" value={totalGuests} />
            <SummaryCard icon={<BarChart3 className="size-4" />} label="Hospedagens" value={data?.metrics.length ?? 0} />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <Select value={filterProp} onValueChange={setFilterProp}>
              <SelectTrigger className="sm:w-64"><SelectValue placeholder="Filtrar hospedagem" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as hospedagens</SelectItem>
                {data?.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Buscar por nome, reserva, telefone…" value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" />
          </div>

          <Tabs defaultValue="acessos" className="w-full">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="acessos" className="flex-1 sm:flex-none"><Activity className="size-3.5 mr-1.5" />Acessos</TabsTrigger>
              <TabsTrigger value="conversas" className="flex-1 sm:flex-none"><MessageSquare className="size-3.5 mr-1.5" />Conversas</TabsTrigger>
              <TabsTrigger value="metricas" className="flex-1 sm:flex-none"><BarChart3 className="size-3.5 mr-1.5" />Métricas</TabsTrigger>
            </TabsList>

            <TabsContent value="acessos" className="mt-4">
              {filteredLogs.length === 0 ? (
                <EmptyState icon={<Activity className="size-8" />} text="Nenhum registro de acesso encontrado." />
              ) : (
                <div className="rounded-xl border border-border bg-surface overflow-hidden">
                  <div className="px-4 py-3 border-b border-border/60 text-xs text-muted-foreground">
                    {filteredLogs.length} {filteredLogs.length === 1 ? "registro" : "registros"}
                  </div>
                  <div className="divide-y divide-border/60">
                    {filteredLogs.map((l) => (
                      <div key={l.id} className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[1.3fr_1.2fr_1fr_auto] gap-2 sm:gap-4 sm:items-center">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{l.guest_name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{l.property_name}</div>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                          {l.guest_phone ? (<><Phone className="size-3 shrink-0" /><span className="truncate text-foreground">{l.guest_phone}</span></>) : <span>—</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {l.reservation_code ? <>Reserva <span className="text-foreground">{l.reservation_code}</span> · </> : null}
                          Check-in <span className="text-foreground">{fmtDate(l.checkin_date)}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground sm:text-right whitespace-nowrap">{fmt(l.created_at)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="conversas" className="mt-4">
              {filteredConvs.length === 0 ? (
                <EmptyState icon={<MessageSquare className="size-8" />} text="Nenhuma conversa encontrada." />
              ) : (
                <ConversationsList convs={filteredConvs} />
              )}
            </TabsContent>

            <TabsContent value="metricas" className="mt-4">
              <div className="rounded-xl border border-border bg-surface overflow-hidden">
                <div className="grid grid-cols-[1.4fr_repeat(4,minmax(0,1fr))_auto] gap-3 px-4 py-3 border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  <div>Hospedagem</div>
                  <div className="text-right">Acessos</div>
                  <div className="text-right">Conversas</div>
                  <div className="text-right">Hóspedes únicos</div>
                  <div className="text-right">Último acesso</div>
                  <div />
                </div>
                <div className="divide-y divide-border/60">
                  {data?.metrics.map((m) => (
                    <div key={m.property_id} className="grid grid-cols-[1.4fr_repeat(4,minmax(0,1fr))_auto] gap-3 px-4 py-3 items-center text-sm">
                      <div className="font-medium truncate">{m.property_name}</div>
                      <div className="text-right">{m.total_accesses}</div>
                      <div className="text-right">{m.total_conversations}</div>
                      <div className="text-right">{m.unique_guests}</div>
                      <div className="text-right text-xs text-muted-foreground">{fmt(m.last_access)}</div>
                      <Link to="/admin/properties/$id" params={{ id: m.property_id }} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
                        Abrir <ExternalLink className="size-3" />
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">{icon}{label}</div>
      <div className="font-serif text-2xl">{value}</div>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-8 text-center">
      <div className="text-muted-foreground mx-auto mb-3 inline-flex">{icon}</div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

type Conv = { id: string; property_id: string; property_name: string; guest_name: string | null; guest_session_id: string; created_at: string; last_message_at: string };

function ConversationsList({ convs }: { convs: Conv[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const msgsFn = useServerFn(getConversationMessages);
  const { data: detail, isLoading } = useQuery({
    queryKey: ["admin-conv", selected],
    queryFn: () => msgsFn({ data: { conversationId: selected! } }),
    enabled: !!selected,
  });

  return (
    <div className="grid md:grid-cols-[300px_1fr] gap-4">
      <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
        {convs.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
              selected === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/60"
            }`}
          >
            <div className="text-sm font-medium truncate">{c.guest_name || `Hóspede ${c.guest_session_id.slice(0, 6)}`}</div>
            <div className="text-[11px] text-muted-foreground truncate">{c.property_name}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{fmt(c.last_message_at)}</div>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 sm:p-5 min-h-[300px]">
        {!selected ? (
          <div className="text-sm text-muted-foreground text-center py-10">Selecione uma conversa.</div>
        ) : isLoading || !detail ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</div>
        ) : (
          <div className="space-y-3">
            <div className="pb-3 border-b border-border/60">
              <div className="text-sm font-medium">{detail.conversation.guest_name || `Hóspede ${detail.conversation.guest_session_id.slice(0, 6)}`}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Iniciada em {fmt(detail.conversation.created_at)}</div>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {detail.messages.map((m) => (
                <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role !== "user" && <div className="size-7 shrink-0 rounded-full bg-primary/10 grid place-items-center"><Bot className="size-3.5 text-primary" /></div>}
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                    {m.content}
                    <div className={`text-[10px] mt-1 ${m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{fmt(m.created_at)}</div>
                  </div>
                  {m.role === "user" && <div className="size-7 shrink-0 rounded-full bg-accent grid place-items-center"><UserIcon className="size-3.5 text-accent-foreground" /></div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
