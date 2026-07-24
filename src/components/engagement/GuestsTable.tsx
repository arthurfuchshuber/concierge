import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle, Phone, MessageSquare, Clock, Layers, Search, Calendar, CalendarCheck,
  MousePointerClick, Timer, Award, Star, ArrowUp, ArrowDown, ChevronsUpDown, Building2, Hash,
} from "lucide-react";
import type { GuestListItem } from "@/lib/engagement-guests.functions";
import { toWhatsappNumber, formatIntlPhone } from "@/lib/masks";

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

type SortKey =
  | "guestName" | "accountName" | "propertyName" | "checkinDate" | "lastActivity"
  | "accessesCount" | "sessionsCount" | "totalSeconds" | "avgSessionSeconds"
  | "maxSessionSeconds" | "topSection" | "messagesCount";

type SortState = { key: SortKey; dir: "asc" | "desc" };

function SortIndicator({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="size-3 opacity-40" />;
  return dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />;
}

export function GuestsTable({
  guests, onSelect,
}: {
  guests: GuestListItem[];
  onSelect: (guestKey: string) => void;
}) {
  const [sort, setSort] = useState<SortState>({ key: "lastActivity", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return guests;
    const digits = term.replace(/\D+/g, "");
    return guests.filter((g) => {
      const hay = [
        g.guestName,
        g.propertyName,
        g.accountName,
        g.reservationCode ?? "",
        g.topSection ?? "",
        g.propertyCity ?? "",
        g.checkinDate ?? "",
        g.checkinDate ? new Date(g.checkinDate).toLocaleDateString("pt-BR") : "",
      ].join(" ").toLowerCase();
      if (hay.includes(term)) return true;
      if (digits && g.phone && g.phone.includes(digits)) return true;
      return false;
    });
  }, [guests, q]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sort.dir === "asc" ? 1 : -1;
    const cmpStr = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
    arr.sort((a, b) => {
      switch (sort.key) {
        case "guestName":     return dir * cmpStr(a.guestName || "", b.guestName || "");
        case "accountName":   return dir * cmpStr(a.accountName || "", b.accountName || "");
        case "propertyName":  return dir * cmpStr(a.propertyName || "", b.propertyName || "");
        case "topSection":    return dir * cmpStr(a.topSection || "", b.topSection || "");
        case "checkinDate":   return dir * (a.checkinDate || "").localeCompare(b.checkinDate || "");
        case "lastActivity":  return dir * (a.lastActivity || "").localeCompare(b.lastActivity || "");
        default:              return dir * ((a[sort.key] as number) - (b[sort.key] as number));
      }
    });
    return arr;
  }, [filtered, sort]);


  function toggle(key: SortKey, defaultDir: "asc" | "desc" = "desc") {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultDir }
    );
  }

  const active = (k: SortKey) => sort.key === k;

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-border">
        <div className="flex-1 min-w-0 pr-14 sm:pr-0">
          <h3 className="text-sm font-semibold">Hóspedes</h3>
          <p className="text-xs text-muted-foreground">
            Um hóspede por telefone (ou nome, quando não há telefone). Clique em uma linha para ver detalhes.
          </p>
        </div>
        <div className="relative w-full sm:w-72 shrink-0">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Nome, telefone, guia, check-in, reserva…"
            className="h-8 pl-8 text-xs"

          />
        </div>
      </header>

      {sorted.length === 0 ? (
        <div className="p-10 text-center text-xs text-muted-foreground">
          Nenhum hóspede encontrado no período/filtro.
        </div>
      ) : (
        <div className="overflow-x-auto sg-elegant-scroll">
          <table className="w-full text-sm min-w-[1320px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground select-none">
              <tr>
                <th
                  onClick={() => toggle("guestName", "asc")}
                  className="text-left px-4 py-2 pr-6 font-medium whitespace-nowrap sticky left-0 bg-muted/60 backdrop-blur z-10 cursor-pointer hover:text-foreground transition-colors w-[150px] max-w-[150px] sm:w-[170px] sm:max-w-[170px]"
                >
                  <span className="inline-flex items-center gap-1">
                    Hóspede <SortIndicator active={active("guestName")} dir={sort.dir} />
                  </span>
                </th>
                <ThSort onClick={() => toggle("accountName", "asc")} active={active("accountName")} dir={sort.dir} icon={Building2} align="left">Conta</ThSort>
                <ThSort onClick={() => toggle("propertyName", "asc")} active={active("propertyName")} dir={sort.dir} align="left">Imóvel</ThSort>
                <ThSort onClick={() => toggle("checkinDate", "desc")} active={active("checkinDate")} dir={sort.dir} icon={Calendar} align="left">Check-in</ThSort>
                <ThSort onClick={() => toggle("lastActivity", "desc")} active={active("lastActivity")} dir={sort.dir} icon={CalendarCheck} align="left">Último acesso</ThSort>
                <ThSort onClick={() => toggle("accessesCount", "desc")} active={active("accessesCount")} dir={sort.dir} icon={MousePointerClick} align="left">Acessos</ThSort>
                <ThSort onClick={() => toggle("sessionsCount", "desc")} active={active("sessionsCount")} dir={sort.dir} icon={Layers} align="left">Sessões</ThSort>
                <ThSort onClick={() => toggle("totalSeconds", "desc")} active={active("totalSeconds")} dir={sort.dir} icon={Clock} align="left">Tempo total</ThSort>
                <ThSort onClick={() => toggle("avgSessionSeconds", "desc")} active={active("avgSessionSeconds")} dir={sort.dir} icon={Timer} align="left">Tempo médio</ThSort>
                <ThSort onClick={() => toggle("maxSessionSeconds", "desc")} active={active("maxSessionSeconds")} dir={sort.dir} icon={Award} align="left">Maior sessão</ThSort>
                <ThSort onClick={() => toggle("topSection", "asc")} active={active("topSection")} dir={sort.dir} icon={Star} align="left">Seção top</ThSort>
                <ThSort onClick={() => toggle("messagesCount", "desc")} active={active("messagesCount")} dir={sort.dir} icon={MessageSquare} align="left">Chat</ThSort>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((g) => {
                const waNum = g.phone ? toWhatsappNumber(g.phone, g.phoneCountry) : "";
                const phoneLabel = g.phone ? formatIntlPhone(g.phone, g.phoneCountry) : "";
                return (
                <tr
                  key={g.key}
                  onClick={() => onSelect(g.key)}
                  className="border-t border-border cursor-pointer hover:bg-muted/40 transition-colors"
                >
                  <td className="px-4 py-3 pr-6 sticky left-0 bg-card z-10 w-[150px] max-w-[150px] sm:w-[170px] sm:max-w-[170px]">
                    <div className="font-medium truncate" title={g.guestName}>{g.guestName || "—"}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap overflow-hidden">
                      {g.phone ? (
                        <>
                          <Phone className="size-3 shrink-0" />
                          <a
                            href={`https://wa.me/${waNum}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="tabular-nums truncate hover:text-emerald-500 hover:underline"
                            title="Abrir no WhatsApp"
                          >
                            {phoneLabel}
                          </a>
                        </>
                      ) : <span>sem telefone</span>}
                      {g.reservationCode && <span className="ml-1 truncate">· {g.reservationCode}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-left text-xs text-muted-foreground truncate max-w-[160px]" title={g.accountName}>
                    {g.accountName || "—"}
                  </td>
                  <td className="px-3 py-3 text-left text-xs text-muted-foreground truncate max-w-[200px]" title={g.propertyName}>
                    {g.propertyName}
                  </td>
                  <td className="px-3 py-3 text-left text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {fmtDate(g.checkinDate)}
                  </td>
                  <td className="px-3 py-3 text-left text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {fmtDateTime(g.lastActivity)}
                  </td>
                  <td className="px-3 py-3 text-center tabular-nums">{g.accessesCount}</td>
                  <td className="px-3 py-3 text-center tabular-nums">{g.sessionsCount}</td>
                  <td className="px-3 py-3 text-left tabular-nums whitespace-nowrap">
                    <div>{fmtCompact(g.totalSeconds)}</div>
                    <div className="text-[10px] text-muted-foreground">{g.sessionsCount} sess</div>
                  </td>
                  <td className="px-3 py-3 text-left tabular-nums whitespace-nowrap">{fmtCompact(g.avgSessionSeconds)}</td>
                  <td className="px-3 py-3 text-left tabular-nums whitespace-nowrap">{fmtCompact(g.maxSessionSeconds)}</td>
                  <td className="px-3 py-3 text-left whitespace-nowrap">
                    {g.topSection ? (
                      <div>
                        <div className="truncate max-w-[140px]" title={g.topSection}>{g.topSection}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">{fmtCompact(g.topSectionSeconds)}</div>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-3 text-left tabular-nums">
                    <div className="flex items-center gap-1.5">
                      {g.hasUnresolvedFeedback && <AlertCircle className="size-3 text-rose-500" />}
                      {g.messagesCount > 0
                        ? <Badge variant="secondary" className="text-[10px]">{g.messagesCount} msg</Badge>
                        : <span className="text-muted-foreground">—</span>}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      )}
      {sorted.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-t border-border text-xs text-muted-foreground">
          <div>
            {pageStart + 1}–{Math.min(pageStart + pageSize, sorted.length)} de {sorted.length}
          </div>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5">
              <span>Por página</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
              >
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="h-7 px-2 rounded-md border border-border bg-background disabled:opacity-40 hover:bg-muted/40"
              >Anterior</button>
              <span className="tabular-nums">{currentPage}/{totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="h-7 px-2 rounded-md border border-border bg-background disabled:opacity-40 hover:bg-muted/40"
              >Próxima</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ThSort({
  children, onClick, active, dir, icon: Icon, align = "right",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: "asc" | "desc";
  icon?: React.ComponentType<{ className?: string }>;
  align?: "left" | "right";
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 font-medium whitespace-nowrap cursor-pointer hover:text-foreground transition-colors ${align === "left" ? "text-left" : "text-right"}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === "left" ? "" : "justify-end"}`}>
        {Icon && <Icon className="size-3 shrink-0" />}
        <span>{children}</span>
        <SortIndicator active={active} dir={dir} />
      </span>
    </th>
  );
}
