import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDur } from "./KpiStrip";
import { AlertCircle, Phone, MessageSquare, Clock, Layers, Search } from "lucide-react";
import type { GuestListItem } from "@/lib/engagement-guests.functions";

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
        <div className="flex-1">
          <h3 className="text-sm font-semibold">Hóspedes</h3>
          <p className="text-xs text-muted-foreground">
            Consolidação por telefone + data de check-in. Clique para ver detalhes.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Hóspede</th>
                <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Imóvel</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Check-in</th>
                <th className="text-right px-4 py-2 font-medium"><Clock className="size-3 inline" /> Tempo</th>
                <th className="text-right px-4 py-2 font-medium hidden sm:table-cell"><Layers className="size-3 inline" /> Seções</th>
                <th className="text-right px-4 py-2 font-medium"><MessageSquare className="size-3 inline" /> Chat</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr
                  key={g.key}
                  onClick={() => onSelect(g.key)}
                  className="border-t border-border cursor-pointer hover:bg-muted/40 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium truncate max-w-[180px]" title={g.guestName}>{g.guestName || "—"}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {g.phone ? (
                        <>
                          <Phone className="size-3" />
                          <span className="tabular-nums">{g.phoneCountry ?? ""} {g.phone}</span>
                        </>
                      ) : <span>sem telefone</span>}
                      {g.reservationCode && <span className="ml-1">· {g.reservationCode}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[180px] hidden sm:table-cell" title={g.propertyName}>
                    {g.propertyName}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums hidden md:table-cell">
                    {g.checkinDate ? new Date(g.checkinDate).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div>{formatDur(g.totalSeconds)}</div>
                    <div className="text-[10px] text-muted-foreground">{g.sessionsCount} sess</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">{g.sectionsCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
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
