import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listHandoffConversations, countPendingHandoffs, getAtendimentoAccess, resolveConversationForGuest } from "@/lib/handoff.functions";
import { ConversationList, ConversationView, useMyUserId } from "@/components/handoff/ConversationView";
import { listenToPushMessages } from "@/lib/push-client";
import { HANDOFF_DOCK_OPEN_EVENT, type HandoffDockOpenDetail } from "@/lib/handoff-dock";
import { Headphones, X, Minimize2, Maximize2, Expand, Shrink } from "lucide-react";
import { QUEUES, type Queue } from "@/lib/handoff-queues";

const DOCK_STATE_KEY = "handoff-dock-state-v1";
const DOCK_POSITION_KEY = "handoff-dock-position-v1";

type DockState = { open: boolean; minimized: boolean };

// A janela sempre inicia fechada: só abre quando o usuário clica no ícone.
function loadState(): DockState {
  return { open: false, minimized: false };
}
function saveState(s: DockState) {
  try { localStorage.setItem(DOCK_STATE_KEY, JSON.stringify({ ...s, open: false })); } catch {}
}

function loadDockBottom(): number {
  if (typeof window === "undefined") return 88;
  try {
    const raw = localStorage.getItem(DOCK_POSITION_KEY);
    if (!raw) return 88;
    const parsed = JSON.parse(raw) as { bottom?: number };
    if (typeof parsed.bottom === "number" && Number.isFinite(parsed.bottom)) return parsed.bottom;
  } catch {}
  return 88;
}

function saveDockBottom(bottom: number) {
  try { localStorage.setItem(DOCK_POSITION_KEY, JSON.stringify({ bottom })); } catch {}
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
  const resolveFn = useServerFn(resolveConversationForGuest);
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
  const [enlarged, setEnlarged] = useState(false);
  const [dockBottom, setDockBottom] = useState(() => loadDockBottom());
  const [dragY, setDragY] = useState<number | null>(null);
  const justDraggedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    moved: boolean;
    rect: DOMRect;
    move: (ev: PointerEvent) => void;
    up: (ev: PointerEvent) => void;
  } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    if (isMobile) setState({ open: false, minimized: false });
  }, []);

  useEffect(() => { saveState(state); }, [state]);

  function onClosedButtonPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const button = e.currentTarget;
    const rect = button.getBoundingClientRect();
    const drag = {
      pointerId: e.pointerId,
      startY: e.clientY,
      moved: false,
      rect,
      move: (ev: PointerEvent) => {
        if (ev.pointerId !== drag.pointerId) return;
        const dy = ev.clientY - drag.startY;
        if (!drag.moved && Math.abs(dy) > 5) drag.moved = true;
        if (!drag.moved) return;
        ev.preventDefault();
        setDragY(dy);
      },
      up: (ev: PointerEvent) => {
        if (ev.pointerId !== drag.pointerId) return;
        window.removeEventListener("pointermove", drag.move);
        window.removeEventListener("pointerup", drag.up);
        window.removeEventListener("pointercancel", drag.up);
        dragRef.current = null;
        if (drag.moved) {
          const dy = ev.clientY - drag.startY;
          const nextTop = drag.rect.top + dy;
          const nextBottom = Math.max(24, Math.min(
            window.innerHeight - drag.rect.height - 24,
            window.innerHeight - (nextTop + drag.rect.height),
          ));
          setDockBottom(nextBottom);
          saveDockBottom(nextBottom);
          justDraggedRef.current = true;
          window.setTimeout(() => { justDraggedRef.current = false; }, 120);
        }
        setDragY(null);
      },
    };
    dragRef.current = drag;
    try { button.setPointerCapture(e.pointerId); } catch {}
    window.addEventListener("pointermove", drag.move, { passive: false });
    window.addEventListener("pointerup", drag.up);
    window.addEventListener("pointercancel", drag.up);
  }

  const pendingQ = useQuery({
    queryKey: ["handoff-pending-count"],
    queryFn: async () => {
      try { return await countFn(); } catch { return { count: 0 }; }
    },
    enabled: allowed,
    refetchInterval: 15_000,
    retry: false,
  });
  const [queue, setQueue] = useState<Queue>("needs_human");
  const list = useQuery({
    queryKey: ["handoff-list", "dock", queue],
    queryFn: async () => {
      try { return await listFn({ data: { queue, limit: 30 } }); }
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

  // Proactive-contact entry: any card can dispatch `handoff-dock:open` with a
  // guest hint. We open the dock and try to focus the matching conversation so
  // the existing chat surface (which already routes to WhatsApp when the
  // Sinch integration is configured) becomes the single entry point.
  useEffect(() => {
    if (!allowed) return;
    const handler = async (ev: Event) => {
      const detail = ((ev as CustomEvent<HandoffDockOpenDetail>).detail ?? {}) as HandoffDockOpenDetail;
      setState({ open: true, minimized: false });
      if (detail.conversationId) { setActiveId(detail.conversationId); return; }
      if (!detail.propertyId) return;
      try {
        const res = await resolveFn({ data: {
          propertyId: detail.propertyId,
          phone: detail.phone ?? null,
          reservationCode: detail.reservationCode ?? null,
          guestName: detail.guestName ?? null,
        } });
        if (res.conversationId) setActiveId(res.conversationId);
      } catch { /* silent — dock stays on list */ }
    };
    window.addEventListener(HANDOFF_DOCK_OPEN_EVENT, handler as EventListener);
    return () => window.removeEventListener(HANDOFF_DOCK_OPEN_EVENT, handler as EventListener);
  }, [allowed, resolveFn]);

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
          onPointerDown={onClosedButtonPointerDown}
          onClick={() => {
            if (justDraggedRef.current) return;
            setState({ open: true, minimized: false });
          }}
          className="fixed right-4 lg:right-6 size-14 rounded-full bg-primary text-primary-foreground shadow-xl grid place-items-center hover:scale-105 transition-transform cursor-grab active:cursor-grabbing touch-none select-none"
          style={{
            zIndex: 2147483000,
            pointerEvents: "auto",
            bottom: `calc(env(safe-area-inset-bottom,0px) + ${dockBottom}px)`,
            transform: dragY === null ? undefined : `translateY(${dragY}px)`,
            transition: dragY === null ? undefined : "none",
          } satisfies CSSProperties}
          aria-label="Central de atendimento"
          title="Central de atendimento · arraste para cima ou para baixo"
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
          className={`hidden lg:flex fixed bottom-6 right-6 flex-col bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden ${
            state.minimized ? "w-80 h-14" : enlarged ? "w-[820px] h-[76vh]" : "w-[520px] h-[560px]"
          }`}
          style={{ zIndex: 2147483000, pointerEvents: "auto" }}
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
              {!state.minimized && (
                <button
                  onClick={() => setEnlarged((v) => !v)}
                  className="size-7 grid place-items-center rounded-md hover:bg-secondary"
                  aria-label={enlarged ? "Reduzir janela" : "Aumentar janela"}
                  title={enlarged ? "Reduzir janela" : "Aumentar janela"}
                >
                  {enlarged ? <Shrink className="size-3.5" /> : <Expand className="size-3.5" />}
                </button>
              )}
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
            <>
              {/* Abas ocupam toda a largura da janela — sem rolagem lateral */}
              <div className="shrink-0 px-2 py-1.5 border-b border-border">
                <div className="flex w-full items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
                  {QUEUES.map((q) => {
                    const Icon = q.icon;
                    const active = queue === q.key;
                    return (
                      <button
                        key={q.key}
                        onClick={() => setQueue(q.key)}
                        title={q.label}
                        className={`inline-flex flex-1 min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium transition-all ${
                          active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon className="size-3 shrink-0" /> <span className="truncate">{q.short}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 min-h-0 flex">
                <div className="w-[200px] border-r border-border shrink-0 flex flex-col min-h-0">
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <ConversationList
                      conversations={convs as any}
                      details={details} assignedNames={assignedNames} reservations={reservations}
                      activeId={activeId}
                      onSelect={setActiveId}
                    />
                  </div>
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
            </>
          )}

        </div>
      )}

      {/* Widget mobile */}
      {state.open && (
        <div className="lg:hidden fixed inset-0" style={{ zIndex: 2147483000, pointerEvents: "auto" }}>
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
                  <div className="px-2 py-2 border-b border-border">
                    <div className="flex w-full items-center gap-1 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-muted/40 p-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                      {QUEUES.map((q) => {
                        const Icon = q.icon;
                        const active = queue === q.key;
                        return (
                          <button
                            key={q.key}
                            onClick={() => setQueue(q.key)}
                            className={`inline-flex flex-1 min-w-fit items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-all ${
                              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Icon className="size-3" /> {q.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <ConversationList
                      conversations={convs as any}
                      details={details} assignedNames={assignedNames} reservations={reservations}
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
