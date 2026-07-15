import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Home as HomeIcon, ExternalLink, User, Clock, Layers, MessageSquare, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { EngagementAnalytics } from "@/lib/engagement-analytics.functions";
import { getGuestDetail } from "@/lib/engagement-guests.functions";
import { labelFor } from "./insights";
import { formatDur } from "./KpiStrip";

export type DetailTarget =
  | { kind: "property"; id: string }
  | { kind: "section"; section: string }
  | { kind: "guest"; guestKey: string }
  | null;

export function DetailSheet({
  target, onClose, data, accountId,
}: {
  target: DetailTarget;
  onClose: () => void;
  data: EngagementAnalytics;
  accountId?: string | null;
}) {
  const open = !!target;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        {target?.kind === "property" && <PropertyDetail data={data} id={target.id} />}
        {target?.kind === "section" && <SectionDetail data={data} section={target.section} />}
        {target?.kind === "guest" && <GuestDetail guestKey={target.guestKey} accountId={accountId ?? null} />}
      </SheetContent>
    </Sheet>
  );
}

function PropertyDetail({ data, id }: { data: EngagementAnalytics; id: string }) {
  const prop = data.perProperty.find((p) => p.id === id);
  const raw = data.properties.find((p) => p.id === id);
  if (!prop || !raw) return <div className="text-sm text-muted-foreground">Imóvel não encontrado.</div>;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2"><HomeIcon className="size-4" /> {prop.name}</SheetTitle>
        <SheetDescription>Comportamento deste imóvel no período</SheetDescription>
      </SheetHeader>
      <dl className="grid grid-cols-2 gap-3 mt-6">
        <Stat label="Sessões" value={prop.sessions} />
        <Stat label="Tempo médio" value={formatDur(prop.avgSessionSeconds)} />
        <Stat label="Acessos" value={prop.accesses} />
        <Stat label="Seções/sessão" value={prop.sectionsPerSession} />
        <Stat label="Taxa de chat" value={`${prop.chatRate}%`} />
        <Stat label="Completude" value={`${prop.completeness}/100`} />
      </dl>
      <div className="mt-6 flex gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/properties/$id" params={{ id: raw.id }}>
            Editar guia <ExternalLink className="size-3.5 ml-1" />
          </Link>
        </Button>
        {raw.published && (
          <Button asChild size="sm" variant="ghost">
            <a href={`/g/${raw.slug}`} target="_blank" rel="noopener noreferrer">
              Ver guia público <ExternalLink className="size-3.5 ml-1" />
            </a>
          </Button>
        )}
      </div>
    </>
  );
}

function SectionDetail({ data, section }: { data: EngagementAnalytics; section: string }) {
  const s = data.sections.find((x) => x.section === section);
  return (
    <>
      <SheetHeader>
        <SheetTitle>Seção · {labelFor(section)}</SheetTitle>
        <SheetDescription>Comportamento desta seção</SheetDescription>
      </SheetHeader>
      {s ? (
        <>
          <dl className="grid grid-cols-2 gap-3 mt-6">
            <Stat label="Aberturas" value={s.opens} />
            <Stat label="Sessões distintas" value={s.sessions} />
            <Stat label="Auto-resolução" value={`${s.autoResolveRate}%`} />
          </dl>
          <div className="mt-6 text-sm space-y-2">
            {s.autoResolveRate >= 80
              ? <p className="text-emerald-700 dark:text-emerald-400">Sessões que abrem essa seção raramente precisam do chat.</p>
              : s.autoResolveRate <= 40
              ? <p className="text-amber-700 dark:text-amber-400">Muitas sessões que abrem essa seção acabam recorrendo ao chat. Vale revisar o conteúdo.</p>
              : <p>Comportamento equilibrado nessa seção.</p>}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground mt-6">Sem dados dessa seção no recorte atual.</p>
      )}
      <div className="mt-6 h-24">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.timeseries}>
            <XAxis dataKey="date" hide />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }} labelFormatter={(v) => new Date(v as string).toLocaleDateString("pt-BR")} />
            <Line type="monotone" dataKey="sessions" stroke="var(--foreground)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function GuestDetail({ guestKey, accountId }: { guestKey: string; accountId: string | null }) {
  const fn = useServerFn(getGuestDetail);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["guest-detail", guestKey, accountId ?? "self"],
    queryFn: () => fn({ data: { guestKey, asUserId: accountId } }),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground mt-6">Carregando…</p>;
  if (isError || !data) return <p className="text-sm text-muted-foreground mt-6">Não foi possível carregar.</p>;
  const g = data.guest;
  return (
    <>
      <SheetHeader className="items-center text-center">
        <SheetTitle className="flex items-center justify-center gap-2"><User className="size-4" /> {g.guestName || "Hóspede"}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-col items-center gap-0.5 text-center">
            {g.phone ? (
              <span className="tabular-nums">{g.phoneCountry ?? ""} {g.phone}</span>
            ) : (
              <span>Sem telefone</span>
            )}
            <span>{g.propertyName}</span>
            {g.propertyCity && <span>{g.propertyCity}</span>}
            {g.reservationCode && <span className="text-[11px] opacity-70">Reserva {g.reservationCode}</span>}
          </div>
        </SheetDescription>
      </SheetHeader>

      <dl className="grid grid-cols-2 gap-3 mt-6">
        <Stat label="Check-in" value={new Date(g.checkinDate).toLocaleDateString("pt-BR")} />
        <Stat label="Tempo total" value={formatDur(g.totalSeconds)} icon={<Clock className="size-3" />} />
        <Stat label="Sessões" value={g.sessionsCount} />
        <Stat label="Seções distintas" value={g.sectionsCount} icon={<Layers className="size-3" />} />
        <Stat label="Msgs no chat" value={g.messagesCount} icon={<MessageSquare className="size-3" />} />
        <Stat label="Última atividade" value={new Date(g.lastActivity).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} />
      </dl>

      {/* Timeline de sessões */}
      <section className="mt-8">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Timeline de navegação</h4>
        {data.sessions.length === 0 ? (
          <div className="text-xs text-muted-foreground">Sem eventos de navegação registrados.</div>
        ) : (
          <ol className="space-y-3">
            {data.sessions.map((s, idx) => (
              <li key={s.sid} className="rounded-lg border border-border p-3 bg-muted/20">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2 gap-3">
                  <span className="font-medium text-foreground">Sessão {idx + 1}</span>
                  <span className="tabular-nums">{formatDur(s.durationSeconds)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mb-2">
                  {new Date(s.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {" · "}
                  {s.sectionsSequence.length} evento{s.sectionsSequence.length === 1 ? "" : "s"} de navegação
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {s.sectionsSequence.map((it, i) => (
                    <span key={i} className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11px]">
                      {labelFor(it.section)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Conversas com a IA */}
      <section className="mt-8">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
          Conversas com a IA {data.conversations.length > 0 && <span className="normal-case text-muted-foreground">({data.conversations.length})</span>}
        </h4>
        {data.conversations.length === 0 ? (
          <div className="text-xs text-muted-foreground">Este hóspede não recorreu ao chat.</div>
        ) : (
          <div className="space-y-4">
            {data.conversations.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-3">
                <div className="text-[11px] text-muted-foreground mb-2">
                  {new Date(c.startedAt).toLocaleString("pt-BR")} · {c.messages.length} mensagens
                </div>
                <div className="space-y-2">
                  {c.messages.map((m) => (
                    <div
                      key={m.id}
                      className={m.role === "user"
                        ? "rounded-md bg-muted/60 px-3 py-2 text-xs"
                        : "rounded-md bg-primary/5 border border-primary/10 px-3 py-2 text-xs"}
                    >
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        {m.role === "user" ? "Hóspede" : m.role === "assistant" ? "IA" : m.role}
                      </div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      {m.feedback && !m.feedback.resolved && (
                        <div className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1">
                          <AlertCircle className="size-3" /> Marcada como não útil{m.feedback.reason ? ` — ${m.feedback.reason}` : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">{icon} {label}</div>
      <div className="text-lg font-semibold tabular-nums truncate">{value}</div>
    </div>
  );
}
