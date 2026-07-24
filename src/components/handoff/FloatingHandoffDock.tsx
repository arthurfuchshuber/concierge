import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listHandoffConversations, countPendingHandoffs, getAtendimentoAccess } from "@/lib/handoff.functions";
import { ConversationList, ConversationView, useMyUserId } from "@/components/handoff/ConversationView";
import { listenToPushMessages } from "@/lib/push-client";
import { Headphones, X, Minimize2, Maximize2 } from "lucide-react";

const DOCK_STATE_KEY = "handoff-dock-state-v1";

type DockState = { open: boolean; minimized: boolean };

function loadState(): DockState {
  if (typeof window === "undefined") return { open: false, minimized: true };
  try {
    const raw = localStorage.getItem(DOCK_STATE_KEY);
    if (raw) return JSON.parse(raw) as DockState;
  } catch {}
  return { open: false, minimized: true };
}
function saveState(s: DockState) {
  try { localStorage.setItem(DOCK_STATE_KEY, JSON.stringify(s)); } catch {}
}

let notifSound: HTMLAudioElement | null = null;
function playBeep() {
  try {
    // Web Audio beep — não depende de asset
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch {}
}

export function FloatingHandoffDock() {
  const accessFn = useServerFn(getAtendimentoAccess);
  const listFn = useServerFn(listHandoffConversations);
  const countFn = useServerFn(countPendingHandoffs);
  const qc = useQueryClient();
  const myUserId = useMyUserId();
  const [mounted, setMounted] = useState(false);

  const access = useQuery({
    queryKey: ["handoff-access"],
    queryFn: async () => {
      try { return await accessFn(); } catch { return { allowed: false as const, as: null, plan: null }; }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const allowed = access.data?.allowed === true;

  const [state, setState] = useState<DockState>(() => loadState());
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    if (isMobile) setState({ open: false, minimized: false });
  }, []);

  useEffect(() => { saveState(state); }, [state]);

  const pendingQ = useQuery({
    queryKey: ["handoff-pending-count"],
    queryFn: async () => {
      try { return await countFn(); } catch { return { count: 0 }; }
    },
    enabled: allowed,
    refetchInterval: 15_000,
    retry: false,
  });
  const list = useQuery({
    queryKey: ["handoff-list", "dock"],
    queryFn: async () => {
      try { return await listFn({ data: { queue: "needs_human", limit: 30 } }); }
      catch { return { conversations: [], details: {} }; }
    },
    enabled: allowed,
    refetchInterval: 15_000,
    retry: false,
  });


  const lastCountRef = useRef<number>(-1);
  useEffect(() => {
    const n = pendingQ.data?.count ?? 0;
    if (lastCountRef.current === -1) { lastCountRef.current = n; return; }
    if (n > lastCountRef.current) {
      // Novo handoff!
      playBeep();
      setState((s) => ({ open: true, minimized: false }));
      try { if ("setAppBadge" in navigator) (navigator as any).setAppBadge(n); } catch {}
    }
    if (n === 0) {
      try { if ("clearAppBadge" in navigator) (navigator as any).clearAppBadge(); } catch {}
    }
    lastCountRef.current = n;
  }, [pendingQ.data?.count]);

  // Realtime: novo status = needs_human → refresh
  useEffect(() => {
    if (!allowed) return;
    const ch = supabase
      .channel("handoff-dock-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "property_chat_conversations" }, () => {
        qc.invalidateQueries({ queryKey: ["handoff-pending-count"] });
        qc.invalidateQueries({ queryKey: ["handoff-list"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [allowed, qc]);

  // Escuta mensagens do SW de push
  useEffect(() => {
    return listenToPushMessages((msg) => {
      if (msg.type === "handoff-push" || msg.type === "handoff-focus") {
        playBeep();
        setState({ open: true, minimized: false });
        if (msg.conversationId) setActiveId(msg.conversationId);
        qc.invalidateQueries({ queryKey: ["handoff-pending-count"] });
        qc.invalidateQueries({ queryKey: ["handoff-list"] });
      }
    });
  }, [qc]);

  if (!allowed || !mounted || typeof document === "undefined") return null;

  const count = pendingQ.data?.count ?? 0;
  const convs = list.data?.conversations ?? [];
  const details = list.data?.details ?? {};
  const assignedNames = list.data?.assignedNames ?? {};
  const reservations = list.data?.reservations ?? {};


  const dock = (
    <>
      {/* Botão flutuante fechado */}
      {!state.open && (
        <button
          onClick={() => setState({ open: true, minimized: false })}
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+88px)] lg:bottom-6 lg:right-6 size-14 rounded-full bg-primary text-primary-foreground shadow-xl grid place-items-center hover:scale-105 transition-transform"
          style={{ zIndex: 2147483000 }}
          aria-label="Central de atendimento"
        >
          <Headphones className="size-6" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center">
              {count}
            </span>
          )}
        </button>
      )}

      {/* Widget desktop */}
      {state.open && (
        <div
          className={`hidden lg:flex fixed bottom-6 right-6 flex-col bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden ${state.minimized ? "w-80 h-14" : "w-[520px] h-[560px]"}`}
          style={{ zIndex: 2147483000 }}
        >
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 h-12 border-b border-border bg-secondary/40">
            <div className="flex items-center gap-2 min-w-0">
              <Headphones className="size-4 text-primary shrink-0" />
              <span className="text-sm font-medium truncate">
                Atendimento {count > 0 && <span className="ml-1 text-red-500">({count})</span>}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Link
                to="/admin/atendimento"
                className="text-[11px] px-2 py-1 rounded-md hover:bg-secondary"
                onClick={() => setState((s) => ({ ...s, open: false }))}
              >
                Central completa
              </Link>
              <button
                onClick={() => setState((s) => ({ ...s, minimized: !s.minimized }))}
                className="size-7 grid place-items-center rounded-md hover:bg-secondary"
                aria-label={state.minimized ? "Expandir" : "Minimizar"}
              >
                {state.minimized ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
              </button>
              <button
                onClick={() => setState({ open: false, minimized: false })}
                className="size-7 grid place-items-center rounded-md hover:bg-secondary"
                aria-label="Fechar"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {!state.minimized && (
            <div className="flex-1 min-h-0 flex">
              <div className="w-[180px] border-r border-border overflow-y-auto shrink-0">
                <ConversationList
                  conversations={convs as any}
                  details={details}
                  activeId={activeId}
                  onSelect={setActiveId}
                />
              </div>
              <div className="flex-1 min-w-0">
                {activeId ? (
                  <ConversationView conversationId={activeId} compact myUserId={myUserId} />
                ) : (
                  <div className="h-full grid place-items-center text-xs text-muted-foreground p-4 text-center">
                    Selecione uma conversa que precisa de atendimento humano.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Widget mobile */}
      {state.open && (
        <div className="lg:hidden fixed inset-0" style={{ zIndex: 2147483000 }}>
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={() => setState({ open: false, minimized: false })}
            aria-label="Fechar central de atendimento"
          />
          <section
            className="absolute inset-x-3 bottom-3 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            style={{ top: "max(5rem, calc(env(safe-area-inset-top, 0px) + 1rem))" }}
            role="dialog"
            aria-modal="true"
            aria-label="Central de atendimento"
          >
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 h-12 border-b border-border bg-secondary/40">
              <div className="flex items-center gap-2 min-w-0">
                <Headphones className="size-4 text-primary shrink-0" />
                <span className="text-sm font-medium truncate">
                  Atendimento {count > 0 && <span className="ml-1 text-red-500">({count})</span>}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Link
                  to="/admin/atendimento"
                  className="text-[11px] px-2 py-1 rounded-md hover:bg-secondary"
                  onClick={() => setState({ open: false, minimized: false })}
                >
                  Central completa
                </Link>
                <button
                  type="button"
                  onClick={() => setState({ open: false, minimized: false })}
                  className="size-8 grid place-items-center rounded-md hover:bg-secondary"
                  aria-label="Fechar"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              {activeId ? (
                <ConversationView conversationId={activeId} compact myUserId={myUserId} />
              ) : (
                <>
                  <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                    Conversas aguardando atendimento
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <ConversationList
                      conversations={convs as any}
                      details={details}
                      activeId={activeId}
                      onSelect={setActiveId}
                    />
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );

  return createPortal(dock, document.body);
}
