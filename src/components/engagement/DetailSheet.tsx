import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Home as HomeIcon, ExternalLink } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { EngagementAnalytics } from "@/lib/engagement-analytics.functions";
import { labelFor } from "./insights";

type Target =
  | { kind: "property"; id: string }
  | { kind: "section"; section: string }
  | null;

export function DetailSheet({
  target, onClose, data,
}: {
  target: Target;
  onClose: () => void;
  data: EngagementAnalytics;
}) {
  const open = !!target;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        {target?.kind === "property" && <PropertyDetail data={data} id={target.id} />}
        {target?.kind === "section" && <SectionDetail data={data} section={target.section} />}
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
        <SheetDescription>Comportamento desse imóvel no período filtrado</SheetDescription>
      </SheetHeader>

      <dl className="grid grid-cols-2 gap-3 mt-6">
        <Stat label="Acessos" value={prop.accesses} />
        <Stat label="Sessões" value={prop.sessions} />
        <Stat label="Conversas" value={prop.chats} />
        <Stat label="Taxa de conversa" value={`${prop.chatRate}%`} />
        <Stat label="Seções/sessão" value={prop.sectionsPerSession} />
        <Stat label="Completude" value={`${prop.completeness}/100`} />
      </dl>

      <div className="mt-6 space-y-2 text-sm">
        <p>
          <span className="font-medium">Leitura rápida:</span>{" "}
          {prop.chatRate >= 55
            ? "hóspedes recorrem muito ao chat — o conteúdo desse guia deixa dúvidas em aberto."
            : prop.chatRate <= 10 && prop.accesses > 5
            ? "guia auto-suficiente: hóspedes encontram o que precisam sem perguntar."
            : "comportamento equilibrado entre consulta ao guia e chat."}
        </p>
        {prop.completeness < 60 && (
          <p className="text-amber-700 dark:text-amber-400">
            Completude abaixo de 60 — vale enriquecer Wi-Fi, check-in e regras da casa.
          </p>
        )}
      </div>

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
              ? <p className="text-emerald-700 dark:text-emerald-400">Sessões que abrem essa seção raramente precisam do chat — ótimo sinal.</p>
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
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid hsl(var(--border))" }}
              labelFormatter={(v) => new Date(v as string).toLocaleDateString("pt-BR")}
            />
            <Line type="monotone" dataKey="sessions" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
