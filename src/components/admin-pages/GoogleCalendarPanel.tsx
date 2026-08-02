import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Loader2, Plug, RefreshCw, Trash2, Video, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getMyGoogleCalendarStatus,
  startGoogleCalendarConnect,
  disconnectMyGoogleCalendar,
  listMyGoogleCalendars,
  listMyGoogleCalendarEvents,
} from "@/lib/google-calendar.functions";
import { listStakeholderOptions, saveStakeholderAlias } from "@/lib/stakeholder-links.functions";


const CONNECTOR_ID = "google_calendar";

function waitForOAuthCompletion(popup: Window) {
  return new Promise<void>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (
        event.origin !== window.location.origin ||
        event.data?.connectorId !== CONNECTOR_ID ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      )
        return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        resolve();
        return;
      }
      popup.close();
      reject(new Error("Não foi possível concluir a autorização."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("A janela foi fechada antes de concluir."));
    }, 500);
  });
}

export function GoogleCalendarPanel() {
  const statusFn = useServerFn(getMyGoogleCalendarStatus);
  const startFn = useServerFn(startGoogleCalendarConnect);
  const discFn = useServerFn(disconnectMyGoogleCalendar);
  const calsFn = useServerFn(listMyGoogleCalendars);
  const eventsFn = useServerFn(listMyGoogleCalendarEvents);
  const optionsFn = useServerFn(listStakeholderOptions);
  const aliasFn = useServerFn(saveStakeholderAlias);

  const qc = useQueryClient();

  const [calendarId, setCalendarId] = useState("primary");

  const status = useQuery({ queryKey: ["gcal-status"], queryFn: () => statusFn(), retry: false });
  const connected = !!status.data?.connected;

  const cals = useQuery({
    queryKey: ["gcal-calendars"],
    queryFn: () => calsFn(),
    enabled: connected,
    retry: false,
  });

  const events = useQuery({
    queryKey: ["gcal-events", calendarId],
    queryFn: () => eventsFn({ data: { calendarId } }),
    enabled: connected,
    retry: false,
  });

  const stakeholders = useQuery({
    queryKey: ["stakeholder-options"],
    queryFn: () => optionsFn(),
    enabled: connected,
    retry: false,
  });

  const link = useMutation({
    mutationFn: (vars: {
      kind: "email" | "domain";
      value: string;
      stakeholderType: "owner" | "provider";
      stakeholderId: string;
    }) =>
      aliasFn({
        data: {
          aliasKind: vars.kind,
          aliasValue: vars.value,
          stakeholderType: vars.stakeholderType,
          stakeholderId: vars.stakeholderId,
        },
      }),
    onSuccess: () => {
      toast.success("Vínculo salvo. Eventos futuros com esse contato entram sozinhos.");
      qc.invalidateQueries({ queryKey: ["gcal-events"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const connect = useMutation({
    mutationFn: async () => {
      const popup = window.open("", "gcal-oauth", "width=600,height=720");
      if (!popup) throw new Error("Pop-up bloqueado. Libere pop-ups e tente novamente.");
      try {
        const { authorizationUrl } = await startFn();
        const completion = waitForOAuthCompletion(popup);
        popup.location.href = authorizationUrl;
        await completion;
      } catch (e) {
        popup.close();
        throw e;
      }
    },
    onSuccess: () => {
      toast.success("Google Agenda conectado.");
      qc.invalidateQueries({ queryKey: ["gcal-status"] });
      qc.invalidateQueries({ queryKey: ["gcal-calendars"] });
      qc.invalidateQueries({ queryKey: ["gcal-events"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: async () => discFn(),
    onSuccess: () => {
      toast.success("Google Agenda desconectado.");
      qc.invalidateQueries({ queryKey: ["gcal-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (status.isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Conecte a conta Google desta operação para importar agendas, eventos e os arquivos de gravação e transcrição
          gerados pelo Google Meet.
        </p>
        <Button
          size="sm"
          className="h-8 rounded-full text-xs"
          onClick={() => connect.mutate()}
          disabled={connect.isPending}
        >
          {connect.isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Plug className="mr-1 size-3.5" />}
          Conectar com Google
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="gap-1 border-0 bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">
          <CalendarDays className="size-2.5" /> {status.data?.email ?? "Conta conectada"}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{status.data?.calendarsCount ?? 0} agendas</span>
      </div>

      {status.data?.error && <p className="text-[11px] text-destructive">{status.data.error}</p>}

      {(cals.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cals.data!.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCalendarId(c.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                calendarId === c.id || (calendarId === "primary" && c.primary)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.summary}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-[11px] font-medium">
            Todos os eventos {events.data ? `· ${events.data.length}` : ""}
            {events.data ? ` · ${events.data.filter((e) => !e.link).length} sem vínculo` : ""}
          </p>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 rounded-full px-2 text-[11px]"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["gcal-events"] });
              qc.invalidateQueries({ queryKey: ["gcal-calendars"] });
            }}
          >
            <RefreshCw className="mr-1 size-3" /> Atualizar
          </Button>
        </div>

        {events.isLoading ? (
          <p className="px-3 py-4 text-[11px] text-muted-foreground">Carregando eventos…</p>
        ) : events.error ? (
          <p className="px-3 py-4 text-[11px] text-destructive">{(events.error as Error).message}</p>
        ) : (events.data?.length ?? 0) === 0 ? (
          <p className="px-3 py-4 text-[11px] text-muted-foreground">Nenhum evento nesta agenda.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {events.data!.map((ev) => (
              <li key={ev.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{ev.summary}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {ev.start ? new Date(ev.start).toLocaleString("pt-BR") : "Sem data"}
                      {ev.attendees.length > 0 && ` · ${ev.attendees.length} participantes`}
                    </p>
                  </div>
                  {ev.htmlLink && (
                    <a
                      href={ev.htmlLink}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                {ev.attachments.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ev.attachments.map((a) => (
                      <a
                        key={a.url}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        {a.kind === "transcript" ? <FileText className="size-2.5" /> : <Video className="size-2.5" />}
                        {a.kind === "transcript" ? "Transcrição" : a.kind === "recording" ? "Gravação" : a.title}
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {ev.link ? (
                    <Badge className="border-0 bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">
                      {ev.link.type === "owner" ? "Proprietário" : "Prestador"}: {ev.link.label}
                    </Badge>
                  ) : ev.suggestedAlias ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">
                        Sem vínculo ({ev.suggestedAlias.value}) —
                      </span>
                      <select
                        className="h-6 rounded-full border border-border bg-card px-2 text-[10px] text-foreground"
                        defaultValue=""
                        disabled={link.isPending}
                        onChange={(e) => {
                          const [type, id] = e.target.value.split(":");
                          if (!type || !id) return;
                          link.mutate({
                            kind: ev.suggestedAlias!.kind,
                            value: ev.suggestedAlias!.value,
                            stakeholderType: type as "owner" | "provider",
                            stakeholderId: id,
                          });
                        }}
                      >
                        <option value="">vincular a…</option>
                        {(stakeholders.data ?? []).map((s) => (
                          <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>
                            {s.type === "owner" ? "🏠" : "🛠"} {s.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Sem participantes externos</span>
                  )}
                </div>
              </li>

            ))}
          </ul>
        )}
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 rounded-full px-2 text-[11px] text-destructive hover:text-destructive"
        onClick={() => disconnect.mutate()}
        disabled={disconnect.isPending}
      >
        <Trash2 className="mr-1 size-3" /> Desconectar
      </Button>
    </div>
  );
}
