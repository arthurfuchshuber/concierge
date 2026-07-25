import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ShieldCheck, Loader2, Users } from "lucide-react";
import { listGuideAccessLogs } from "@/lib/guide-access-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/properties/$id_/acessos")({
  component: AccessLogsPage,
});

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function fmtDate(d: string) {
  try {
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  } catch {
    return d;
  }
}

function AccessLogsPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const listFn = useServerFn(listGuideAccessLogs);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-access-logs", id],
    queryFn: () => listFn({ data: { propertyId: id } }),
  });

  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full">
      <button
        onClick={() => navigate({ to: "/admin/properties/$id", params: { id } })}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors"
      >
        <ArrowLeft className="size-3.5" /> Voltar para o guia
      </button>

      <div className="mb-6 pb-5 border-b border-border/60">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">
          Auditoria de acessos
        </p>
        <h1 className="font-display text-2xl sm:text-3xl">{data?.property.name ?? "Carregando…"}</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Registros de quem abriu o guia público (nome, código da reserva e data de check-in informados).
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : !data || data.logs.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <ShieldCheck className="size-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum acesso registrado ainda.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            {data.logs.length} {data.logs.length === 1 ? "registro" : "registros"}
          </div>
          {(() => {
            const showRes = data.logs.some((l) => !!l.reservation_code);
            const gridCols = showRes
              ? "sm:grid-cols-[1.3fr_1fr_0.9fr_1fr_auto]"
              : "sm:grid-cols-[1.3fr_1fr_1fr_auto]";
            return (
              <div className="divide-y divide-border/60">
                {data.logs.map((log) => (
                  <div key={log.id} className={`px-4 py-3 sm:grid ${gridCols} sm:gap-4 sm:items-center`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{log.guest_name}</div>
                      <div className="text-[11px] text-muted-foreground sm:hidden mt-0.5 space-y-0.5">
                        {log.guest_phone && <div>Tel.: {log.guest_phone}</div>}
                        <div>{log.reservation_code ? `Reserva ${log.reservation_code} · ` : ""}Check-in {fmtDate(log.checkin_date)}</div>
                      </div>
                    </div>
                    <div className="hidden sm:block text-xs text-muted-foreground truncate">
                      {log.guest_phone ? <>Tel. <span className="text-foreground">{log.guest_phone}</span></> : <span>—</span>}
                    </div>
                    {showRes && (
                      <div className="hidden sm:block text-xs text-muted-foreground truncate">
                        {log.reservation_code ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted/60 border border-border/60 text-foreground">
                              {log.reservation_code}
                            </span>
                            <CopyButton value={log.reservation_code} size={11} />
                          </span>
                        ) : <span>—</span>}
                      </div>
                    )}
                    <div className="hidden sm:block text-xs text-muted-foreground">
                      Check-in <span className="text-foreground">{fmtDate(log.checkin_date)}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 sm:mt-0 sm:text-right whitespace-nowrap">
                      {fmt(log.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      <div className="mt-6">
        <Link
          to="/admin/properties/$id"
          params={{ id }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Voltar para edição
        </Link>
      </div>
    </div>
  );
}
