import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Phone, MessageSquare, Clock, Layers, Search, Calendar, CalendarCheck, MousePointerClick, Timer, Award, Star } from "lucide-react";
import type { GuestListItem } from "@/lib/engagement-guests.functions";

/** Formata em uma linha compacta: 16m3s, 2h15m, 34s */
function fmtCompact(seconds: number): string {
  if (!seconds || seconds < 1) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  if (m < 60) return s > 0 ? `${m}m${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m - h * 60;
  return mm > 0 ? `${h}h${mm}m` : `${h}h`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}
function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Th({ icon: Icon, children }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 font-medium text-right whitespace-nowrap">
      <span className="inline-flex items-center justify-end gap-1">
        {Icon && <Icon className="size-3 shrink-0" />}
        <span>{children}</span>
      </span>
    </th>
  );
}

export function GuestsTable({
  guests, q, onQ, onSelect,
}: {
  guests: GuestListItem[];
  q: string;
  onQ: (v: string) => void;
  onSelect: (guestKey: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-border">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">Hóspedes</h3>
          <p className="text-xs text-muted-foreground">
            Consolidação por telefone + data de check-in. Clique em uma linha para ver detalhes.
          </p>
        </div>
        <div className="relative w-full sm:w-72 shrink-0">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Nome, telefone, reserva…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </header>

      {guests.length === 0 ? (
        <div className="p-10 text-center text-xs text-muted-foreground">
          Nenhum hóspede encontrado no período/filtro.
        </div>
      ) : (
        <div className="overflow-x-auto sg-elegant-scroll">
          <table className="w-full text-sm min-w-[1180px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium whitespace-nowrap sticky left-0 bg-muted/60 backdrop-blur z-10">Hóspede</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Imóvel</th>
                <Th icon={Calendar}>Check-in</Th>
                <Th icon={CalendarCheck}>Último acesso</Th>
                <Th icon={MousePointerClick}>Acessos</Th>
                <Th icon={Layers}>Sessões</Th>
                <Th icon={Clock}>Tempo total</Th>
                <Th icon={Timer}>Tempo médio</Th>
                <Th icon={Award}>Maior sessão</Th>
                <Th icon={Star}>Seção top</Th>
                <Th icon={MessageSquare}>Chat</Th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr
                  key={g.key}
                  onClick={() => onSelect(g.key)}
                  className="border-t border-border cursor-pointer hover:bg-muted/40 transition-colors"
                >
                  <td className="px-4 py-3 sticky left-0 bg-card z-10">
                    <div className="font-medium truncate max-w-[200px]" title={g.guestName}>{g.guestName || "—"}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                      {g.phone ? (
                        <>
                          <Phone className="size-3 shrink-0" />
                          <span className="tabular-nums">{g.phoneCountry ?? ""} {g.phone}</span>
                        </>
                      ) : <span>sem telefone</span>}
                      {g.reservationCode && <span className="ml-1">· {g.reservationCode}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground truncate max-w-[180px]" title={g.propertyName}>
                    {g.propertyName}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {fmtDate(g.checkinDate)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {fmtDateTime(g.lastActivity)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{g.accessesCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{g.sessionsCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                    <div>{fmtCompact(g.totalSeconds)}</div>
                    <div className="text-[10px] text-muted-foreground">{g.sessionsCount} sess</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{fmtCompact(g.avgSessionSeconds)}</td>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{fmtCompact(g.maxSessionSeconds)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {g.topSection ? (
                      <div>
                        <div className="truncate max-w-[140px] ml-auto" title={g.topSection}>{g.topSection}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">{fmtCompact(g.topSectionSeconds)}</div>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <div className="flex items-center justify-end gap-1.5">
                      {g.hasUnresolvedFeedback && <AlertCircle className="size-3 text-rose-500" />}
                      {g.messagesCount > 0
                        ? <Badge variant="secondary" className="text-[10px]">{g.messagesCount} msg</Badge>
                        : <span className="text-muted-foreground">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
