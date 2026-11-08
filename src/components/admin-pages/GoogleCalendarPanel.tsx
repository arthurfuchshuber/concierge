import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Loader2, MessageCircle, Plug, RefreshCw, FileText, Video, X } from "lucide-react";
import { toast } from "sonner";
import {
  getMyGoogleCalendarStatus,
  startGoogleCalendarConnect,
  disconnectMyGoogleCalendar,
  listMyGoogleCalendarEvents,
} from "@/lib/google-calendar.functions";
import type { GcalEvent } from "@/lib/google-calendar.types";
import { LinkEventDialog, type LinkTarget } from "@/components/stakeholders/LinkEventDialog";
import {
  ActionSquare,
  DisconnectMenu,
  IntegrationShell,
  PrimaryAction,
  SoftToggles,
} from "@/components/admin-pages/integration-window";
import { cn } from "@/lib/utils";

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

type Tab = "sem" | "vinculados";

/** "30/10 · 13:00" (fuso da operação). */
function shortWhen(iso: string | null): string {
  if (!iso) return "Sem data";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Sem data";
  const day = d.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
  const hour = d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} · ${hour}`;
}

/** Um ícone por tipo de anexo (gravação / anotações), cada um abrindo o primeiro arquivo do tipo. */
function attachmentIcons(
  ev: GcalEvent,
): Array<{ kind: "video" | "note"; url: string; title: string }> {
  const out: Array<{ kind: "video" | "note"; url: string; title: string }> = [];
  for (const a of ev.attachments) {
    const kind = a.kind === "recording" ? "video" : "note";
    if (out.some((o) => o.kind === kind)) continue;
    out.push({
      kind,
      url: a.url,
      title:
        a.kind === "recording" ? "Gravação" : a.kind === "transcript" ? "Transcrição" : a.title,
    });
  }
  return out.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "video" ? -1 : 1));
}

const LONG_PRESS_MS = 450;

/**
 * Janela do Google Agenda (mockups aprovados, 08/11/2026): Sem Vínculo | Vinculados em botões
 * suaves, lista sem cartões (só a linha divisória), toque no evento abre no Google Agenda, ícone de
 * corrente vincula; segurar um evento entra na seleção múltipla ("Vincular N Eventos"). Depois de
 * vincular, a janela vai para "Vinculados".
 */
export function GoogleCalendarPanel({
  accountOwnerId = null,
  readOnly = false,
  inWindow = false,
}: {
  accountOwnerId?: string | null;
  readOnly?: boolean;
  /** Dentro da janela (celular): cabeçalho e recuos da janela. */
  inWindow?: boolean;
}) {
  const statusFn = useServerFn(getMyGoogleCalendarStatus);
  const startFn = useServerFn(startGoogleCalendarConnect);
  const discFn = useServerFn(disconnectMyGoogleCalendar);
  const eventsFn = useServerFn(listMyGoogleCalendarEvents);
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("sem");
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selecting = selected.size > 0;

  const status = useQuery({
    queryKey: ["gcal-status", accountOwnerId],
    queryFn: () => statusFn({ data: { ownerId: accountOwnerId } }),
    retry: false,
  });
  const connected = !!status.data?.connected;

  const events = useQuery({
    queryKey: ["gcal-events", accountOwnerId, "all"],
    queryFn: () => eventsFn({ data: { calendarId: "all", ownerId: accountOwnerId } }),
    enabled: connected,
    retry: false,
  });

  const unlinked = useMemo(() => (events.data ?? []).filter((e) => !e.link), [events.data]);
  const linked = useMemo(() => (events.data ?? []).filter((e) => !!e.link), [events.data]);
  const list = tab === "sem" ? unlinked : linked;

  // Trocar de visão (ou a lista mudar) encerra a seleção.
  useEffect(() => setSelected(new Set()), [tab]);

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

  // Abre o link do Google já na conta conectada à integração (authuser).
  const gAccount = status.data?.email ?? null;
  const gLink = (url: string) => {
    if (!gAccount) return url;
    try {
      const u = new URL(url);
      if (!/(^|\.)google\.com$/.test(u.hostname)) return url;
      u.searchParams.set("authuser", gAccount);
      return u.toString();
    } catch {
      return url;
    }
  };
  const openUrl = (url: string) => window.open(gLink(url), "_blank", "noopener");

  // Seleção por toque longo (sem caixinha no modo normal); o clique que segue o toque longo é ignorado.
  const pressTimer = useRef<number | null>(null);
  const skipClick = useRef<string | null>(null);
  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const canSelect = tab === "sem" && !readOnly;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const linkOne = (ev: GcalEvent) =>
    setLinkTarget({ eventId: ev.id, title: ev.summary, suggested: ev.suggestedAlias });
  const linkSelected = () => {
    const evs = unlinked.filter((e) => selected.has(e.id));
    if (evs.length === 0) return;
    if (evs.length === 1) return linkOne(evs[0]);
    setLinkTarget({
      eventId: evs[0].id,
      title: evs[0].summary,
      suggested: null,
      events: evs.map((e) => ({ eventId: e.id, title: e.summary })),
    });
  };

  const refresh = () => qc.invalidateQueries({ queryKey: ["gcal-events"] });

  if (status.isLoading) {
    return (
      <div
        className={
          inWindow
            ? "flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground"
            : "flex items-center gap-2 py-4 text-xs text-muted-foreground"
        }
      >
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!connected) {
    return (
      <IntegrationShell
        inWindow={inWindow}
        title="Google Agenda"
        subtitle="Operação · Não Conectado"
        bodyDeps={[connected]}
        footer={
          readOnly ? null : (
            <PrimaryAction
              icon={connect.isPending ? <Loader2 className="animate-spin" /> : <Plug />}
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
            >
              Conectar com Google
            </PrimaryAction>
          )
        }
      >
        <p className="text-[12px] leading-[1.45] text-muted-foreground">
          Conecte a conta Google desta operação para importar agendas, eventos e os arquivos de
          gravação e transcrição gerados pelo Google Meet.
        </p>
      </IntegrationShell>
    );
  }

  const loading = events.isLoading;
  const allPicked = selecting && unlinked.length > 0 && unlinked.every((e) => selected.has(e.id));

  return (
    <>
      <IntegrationShell
        inWindow={inWindow}
        title="Google Agenda"
        subtitle={`Operação · ${status.data?.email ?? "—"}`}
        bodyDeps={[tab, list.length, loading, selecting]}
        toggles={
          <SoftToggles
            items={[
              { key: "sem", label: loading ? "Sem Vínculo" : `Sem Vínculo (${unlinked.length})` },
              {
                key: "vinculados",
                label: loading ? "Vinculados" : `Vinculados (${linked.length})`,
              },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
        above={
          selecting ? (
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <span className="font-bold">
                {selected.size} {selected.size === 1 ? "Selecionado" : "Selecionados"}
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelected(allPicked ? new Set() : new Set(unlinked.map((e) => e.id)))
                }
                className="font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                {allPicked ? "Desmarcar Todos" : "Selecionar Todos"}
              </button>
            </div>
          ) : null
        }
        footer={
          selecting ? (
            <>
              <PrimaryAction icon={<Link2 />} onClick={linkSelected}>
                Vincular {selected.size} {selected.size === 1 ? "Evento" : "Eventos"}
              </PrimaryAction>
              <ActionSquare label="Cancelar Seleção" onClick={() => setSelected(new Set())}>
                <X strokeWidth={2} />
              </ActionSquare>
            </>
          ) : (
            <>
              <PrimaryAction
                icon={events.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                onClick={refresh}
                disabled={events.isFetching}
              >
                Atualizar Eventos
              </PrimaryAction>
              {readOnly ? null : (
                <DisconnectMenu
                  onDisconnect={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                />
              )}
            </>
          )
        }
      >
        {status.data?.error ? (
          <p className="pb-2 text-[11.5px] text-[#c98c8c]">{status.data.error}</p>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Carregando Eventos…
          </div>
        ) : events.error ? (
          <p className="py-6 text-center text-[12px] text-[#c98c8c]">
            {(events.error as Error).message}
          </p>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">
            {tab === "sem" ? "Nenhum evento sem vínculo." : "Nenhum evento vinculado ainda."}
          </p>
        ) : (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
            {list.map((ev, i) => {
              const on = selected.has(ev.id);
              const who = ev.link ? ev.link.label : (ev.suggestedAlias?.value ?? null);
              return (
                <div
                  key={ev.id}
                  data-clip-row
                  role="button"
                  tabIndex={0}
                  onPointerDown={() => {
                    skipClick.current = null;
                    if (!canSelect || selecting) return;
                    cancelPress();
                    pressTimer.current = window.setTimeout(() => {
                      pressTimer.current = null;
                      skipClick.current = ev.id;
                      setSelected(new Set([ev.id]));
                    }, LONG_PRESS_MS);
                  }}
                  onPointerUp={cancelPress}
                  onPointerLeave={cancelPress}
                  onPointerCancel={cancelPress}
                  onContextMenu={(e) => canSelect && e.preventDefault()}
                  onClick={() => {
                    if (skipClick.current === ev.id) {
                      skipClick.current = null;
                      return;
                    }
                    if (selecting) return toggle(ev.id);
                    if (ev.htmlLink) openUrl(ev.htmlLink);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    if (selecting) toggle(ev.id);
                    else if (ev.htmlLink) openUrl(ev.htmlLink);
                  }}
                  className={cn(
                    "min-w-0 cursor-pointer select-none [-webkit-touch-callout:none]",
                    i > 0 &&
                      !on &&
                      !selected.has(list[i - 1].id) &&
                      "border-t border-[var(--panel-div)]",
                    i > 0 && (on || selected.has(list[i - 1].id)) && "border-t border-transparent",
                  )}
                >
                  <div
                    className={cn(
                      "flex min-w-0 items-center gap-3 py-2.5",
                      selecting && "-mx-2 rounded-[10px] px-2",
                      on && "bg-[#7fb79a]/[0.08]",
                    )}
                  >
                    {selecting ? (
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-[18px] shrink-0 place-items-center rounded-[5px]",
                          on
                            ? "bg-[#7fb79a] text-[#14110f]"
                            : "border-[1.5px] border-foreground/25",
                        )}
                      >
                        {on ? <CheckMark /> : null}
                      </span>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-7"
                          title={ev.summary}
                        >
                          {ev.summary}
                        </span>
                        {tab === "sem" && !selecting && !readOnly ? (
                          <button
                            type="button"
                            aria-label="Vincular"
                            title="Vincular"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              linkOne(ev);
                            }}
                            className="-mr-1 grid size-7 shrink-0 place-items-center text-foreground/85 transition-colors hover:text-foreground"
                          >
                            <Link2 className="size-[15px]" strokeWidth={1.9} />
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        {attachmentIcons(ev).map((a) => (
                          <button
                            key={a.kind}
                            type="button"
                            aria-label={a.title}
                            title={a.title}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (selecting) return toggle(ev.id);
                              openUrl(a.url);
                            }}
                            className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-foreground/[0.06] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            {a.kind === "video" ? (
                              <Video className="size-[11px]" strokeWidth={1.9} />
                            ) : (
                              <FileText className="size-[11px]" strokeWidth={1.9} />
                            )}
                          </button>
                        ))}
                        <span className="shrink-0 tabular-nums">{shortWhen(ev.start)}</span>
                        <span aria-hidden className="shrink-0 opacity-50">
                          ·
                        </span>
                        {ev.link ? (
                          <span className="flex min-w-0 items-center gap-1">
                            <MessageCircle className="size-[11px] shrink-0" strokeWidth={1.9} />
                            <span className="truncate" title={who ?? undefined}>
                              {who}
                            </span>
                          </span>
                        ) : (
                          <span
                            className={cn("min-w-0 truncate", !who && "opacity-60")}
                            title={who ?? undefined}
                          >
                            {who ?? "Sem e-mail"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </IntegrationShell>

      <LinkEventDialog
        target={linkTarget}
        onOpenChange={(o) => !o && setLinkTarget(null)}
        onLinked={() => {
          setSelected(new Set());
          setTab("vinculados");
        }}
      />
    </>
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[11px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
