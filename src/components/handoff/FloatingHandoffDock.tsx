import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHasSession } from "@/hooks/useHasSession";
import { listHandoffConversations, countPendingHandoffs, getAtendimentoAccess, resolveConversationForGuest } from "@/lib/handoff.functions";
import { ConversationList, ConversationView, useMyUserId } from "@/components/handoff/ConversationView";
import { ChannelLogo, channelOf } from "@/components/handoff/ChannelLogo";
import { formatIntlPhone } from "@/lib/masks";
import { listenToPushMessages } from "@/lib/push-client";
import { HANDOFF_DOCK_OPEN_EVENT, type HandoffDockOpenDetail } from "@/lib/handoff-dock";
import { Headphones, X, Expand, Shrink, ArrowLeft } from "lucide-react";
import { QUEUES, type Queue } from "@/lib/handoff-queues";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useLockBodyScroll, useVisualViewport, viewportOverlayStyle } from "@/hooks/useVisualViewport";

/** "2026-10-15" → "15/10/2026" (data pura, sem fuso). */
function fmtDockDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

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

/** Intervalo mínimo entre bipes: rajadas de eventos nunca ficam apitando. */
const BEEP_THROTTLE_MS = 30_000;
/** Depois desse tempo sem aparecer na fila, uma conversa volta a poder alertar. */
const NOTIFIED_TTL_MS = 10 * 60_000;
let lastBeepAt = 0;
function playBeep() {
  const now = Date.now();
  if (now - lastBeepAt < BEEP_THROTTLE_MS) return;
  lastBeepAt = now;
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

export function FloatingHandoffDock({ launcher = true }: { launcher?: boolean } = {}) {
  const hasSession = useHasSession();
  const viewport = useVisualViewport();
  const accessFn = useServerFn(getAtendimentoAccess);
  const listFn = useServerFn(listHandoffConversations);
  const { impersonation } = useImpersonation();
  const activeAccountId = impersonation?.userId ?? null;
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
    enabled: hasSession === true,
  });

  const allowed = hasSession === true && access.data?.allowed === true;

  const [state, setState] = useState<DockState>(() => loadState());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  // Com o Atendimento aberto a página atrás não rola — ver useLockBodyScroll.
  useLockBodyScroll(state.open && !state.minimized);
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
    // Evita que popups abertos atrás interpretem isso como "clique fora".
    e.stopPropagation();
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
    queryKey: ["handoff-pending-count", activeAccountId ?? "self"],
    queryFn: async () => {
      try { return await countFn({ data: { accountOwnerId: activeAccountId } }); } catch { return { count: 0 }; }
    },
    enabled: allowed,
    refetchInterval: 15_000,
    retry: false,
  });
  const [queue, setQueue] = useState<Queue>("all_active");
  const list = useQuery({
    queryKey: ["handoff-list", "dock", queue, activeAccountId ?? "self"],
    queryFn: async () => {
      try { return await listFn({ data: { queue, limit: 30, accountOwnerId: activeAccountId } }); }
      catch { return { conversations: [], details: {} }; }
    },
    enabled: allowed,
    refetchInterval: 15_000,
    retry: false,
  });


  // Conversas que já acionaram alerta nesta sessão (id → última vez vista na fila).
  // A janela só abre/apita para uma conversa NOVA; atualizações da mesma conversa
  // (rajada de webhooks, refetch de 15 s) e o fechamento manual pelo "X" são respeitados.
  const notifiedRef = useRef<Map<string, number>>(new Map());
  const firstPendingRef = useRef(true);
  // Trocou a conta (impersonação): recomeça o registro, sem alertar pelo que já estava na fila.
  useEffect(() => {
    notifiedRef.current = new Map();
    firstPendingRef.current = true;
  }, [activeAccountId]);
  useEffect(() => {
    const data = pendingQ.data;
    if (!data) return;
    const n = data.count ?? 0;
    const ids = (data as { ids?: string[] }).ids;
    const now = Date.now();
    const known = notifiedRef.current;
    if (Array.isArray(ids)) {
      const fresh = ids.filter((id) => !known.has(id));
      for (const id of ids) known.set(id, now);
      for (const [id, seen] of known) if (now - seen > NOTIFIED_TTL_MS) known.delete(id);
      // Primeira leitura da sessão só registra o que já estava na fila.
      if (firstPendingRef.current) firstPendingRef.current = false;
      else if (fresh.length > 0) {
      playBeep();
        setState({ open: true, minimized: false });
    }
    }
    if (n > 0) {
      try { if ("setAppBadge" in navigator) (navigator as any).setAppBadge(n); } catch {}
    } else {
      try { if ("clearAppBadge" in navigator) (navigator as any).clearAppBadge(); } catch {}
    }
  }, [pendingQ.data]);

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

  // Escuta mensagens do SW de push.
  // A janela só abre sozinha quando o push é de uma CONVERSA (hóspede) ou
  // quando a pessoa clicou na notificação. Avisos operacionais do sistema
  // (limpeza, esteira, alertas) apenas atualizam os dados em segundo plano.
  useEffect(() => {
    return listenToPushMessages((msg) => {
      if (msg.type !== "handoff-push" && msg.type !== "handoff-focus") return;
      qc.invalidateQueries({ queryKey: ["handoff-pending-count"] });
      qc.invalidateQueries({ queryKey: ["handoff-list"] });
      const isConversation = !!msg.conversationId;
      if (!isConversation && msg.type !== "handoff-focus") return;
      // Clique na notificação = pedido explícito: sempre abre. Push de conversa já
      // avisada (nova mensagem do mesmo hóspede) só atualiza os dados em segundo plano.
      const explicit = msg.type === "handoff-focus";
      const known = notifiedRef.current;
      const already = !!msg.conversationId && known.has(msg.conversationId);
      if (msg.conversationId) known.set(msg.conversationId, Date.now());
      if (!explicit && already) return;
      if (!explicit) playBeep();
      setState({ open: true, minimized: false });
      if (msg.conversationId) setActiveId(msg.conversationId);
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
  const owners = list.data?.owners ?? {};
  const activeConv = activeId ? (convs as Array<{ id: string; guest_name: string | null; guest_session_id: string | null; properties: { name: string | null } | null }>).find((c) => c.id === activeId) ?? null : null;
  const activeDetail = activeId ? details[activeId] : undefined;
  const activeChannelLabel = activeConv
    ? { airbnb: "Airbnb", whatsapp: "WhatsApp", guide: "Guia digital" }[channelOf(null, activeConv.guest_session_id)]
    : "";


  const dock = (
    <>
      {/* Botão flutuante fechado.
          Desde 07/09/2026 o canto tem um único botão, o do FloatingDock, que
          abre um menu com "Atendimento" e "Assistente" — daí `launcher={false}`
          lá. Este botão continua aqui, e não foi apagado, porque em qualquer
          outro lugar que monte o dock sozinho ele ainda é a forma de abri-lo. */}
      {launcher && !state.open && (
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

      {/* Widget desktop — OPÇÃO E (mockup aprovado, 15/10/2026): central em
          TRÊS painéis, CENTRALIZADA na tela, com os dados da reserva ao lado.
          Mesmas regras de janela do sistema: fundo `bg-background/70` com
          desfoque (Dialog), casca em `--win-radius` com borda/fundo `--panel`
          e o fio de luz de 28px, cabeçalho de 60px com botões de 36px, X
          redondo igual ao do Dialog, abas `ds-tabs` e teto de 75% da altura.
          A lógica (filas, conversa, alertas, push) NÃO mudou — só a moldura. */}
      {state.open && (
        <div
          className="hidden lg:block fixed inset-0"
          style={{ zIndex: 2147483000, pointerEvents: "auto" }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onFocusCapture={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="absolute inset-0 bg-background/70 backdrop-blur-md"
            onClick={() => setState({ open: false, minimized: false })}
            aria-label="Fechar central de atendimento"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Central de atendimento"
            className={`absolute left-1/2 top-1/2 flex h-[75dvh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--win-radius)] border border-[var(--panel-border)] bg-[var(--panel)] text-foreground shadow-[0_30px_80px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.05)] before:pointer-events-none before:absolute before:inset-x-7 before:top-0 before:h-px before:bg-[image:var(--panel-hair)] before:content-[''] ${
              enlarged ? "w-[min(1240px,calc(100vw-2rem))]" : "w-[min(940px,calc(100vw-2rem))]"
            }`}
            style={viewport.covered ? { maxHeight: `calc(100dvh - ${viewport.covered}px - 2rem)` } : undefined}
          >
            <div className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-foreground/[0.065] px-4">
              <Headphones className="size-[18px] shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-[15px] font-bold">
                Atendimento {count > 0 && <span className="ml-1 text-red-500">({count})</span>}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <Link
                  to="/admin/atendimento"
                  className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent/10"
                  onClick={() => setState((st) => ({ ...st, open: false }))}
                >
                  Central completa
                </Link>
                <button
                  type="button"
                  onClick={() => setEnlarged((v) => !v)}
                  className="inline-grid size-9 place-items-center rounded-md border border-input bg-background shadow-sm transition-colors hover:bg-accent/10"
                  aria-label={enlarged ? "Reduzir janela" : "Aumentar janela"}
                  title={enlarged ? "Reduzir janela" : "Aumentar janela"}
                >
                  {enlarged ? <Shrink className="size-4" /> : <Expand className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setState({ open: false, minimized: false })}
                  className="grid size-8 place-items-center rounded-full bg-secondary/60 text-muted-foreground opacity-80 transition-opacity hover:opacity-100"
                  aria-label="Fechar"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Abas no padrão `ds-tabs`, na largura inteira da janela. */}
            <div className="shrink-0 border-b border-foreground/[0.065] px-4 py-2.5">
              <div className="ds-tabs flex w-full overflow-hidden">
                {QUEUES.map((q) => {
                  const active = queue === q.key;
                  return (
                    <button
                      key={q.key}
                      type="button"
                      onClick={() => setQueue(q.key)}
                      title={q.label}
                      className={`relative inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${
                        active ? "ds-tab-active text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">{q.short}</span>
                      {q.key === "all_active" && count > 0 && (
                        <span className="grid min-w-[18px] place-items-center rounded-full bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] px-1 text-[10px] font-bold leading-[18px] text-white">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 w-[240px] shrink-0 flex-col border-r border-foreground/[0.065]">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ConversationList
                    conversations={convs as any}
                    details={details} assignedNames={assignedNames} reservations={reservations} owners={owners}
                    activeId={activeId}
                    onSelect={setActiveId}
                  />
                </div>
              </div>

              <div className="min-w-0 flex-1 bg-surface">
                {activeId ? (
                  <ConversationView conversationId={activeId} compact myUserId={myUserId} />
                ) : (
                  <div className="grid h-full place-items-center p-4 text-center text-xs text-muted-foreground">
                    Selecione uma conversa que precisa de atendimento humano.
                  </div>
                )}
              </div>

              {/* Dados da reserva da conversa aberta (só leitura; vêm da própria
                  lista — nenhuma consulta nova). */}
              {activeConv && (
                <aside className="hidden w-[230px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-foreground/[0.065] bg-[var(--panel)] p-4 xl:flex">
                  <div className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground/70">
                    Reserva
                  </div>
                  {[
                    ["Hóspede", activeDetail?.name || activeConv.guest_name || null],
                    ["Telefone", activeDetail?.phone ? formatIntlPhone(activeDetail.phone, activeDetail.phoneCountry) : null],
                    ["Imóvel", activeConv.properties?.name ?? null],
                    [
                      "Período",
                      activeDetail?.checkinDate && activeDetail?.checkoutDate
                        ? `${fmtDockDate(activeDetail.checkinDate)} → ${fmtDockDate(activeDetail.checkoutDate)}`
                        : null,
                    ],
                    ["Código", activeDetail?.reservationCode ?? null],
                  ].map(([label, value]) =>
                    value ? (
                      <div key={label as string} className="flex min-w-0 flex-col gap-0.5">
                        <small className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground/70">
                          {label}
                        </small>
                        <span className="break-words text-[13px] font-bold">{value}</span>
                      </div>
                    ) : null,
                  )}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <small className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground/70">
                      Canal
                    </small>
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold">
                      <ChannelLogo channel={channelOf(null, activeConv.guest_session_id)} size={14} />
                      {activeChannelLabel}
                    </span>
                  </div>
                </aside>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Widget mobile */}
      {state.open && (
        <div
          className="lg:hidden"
          // Ancorado na visual viewport em vez de `inset-0`: com o teclado
          // aberto, `inset-0` continua sendo a janela inteira e o painel
          // escorrega para fora por cima, levando o cabeçalho junto. Funciona
          // no iOS e no Android, que tratam o teclado de formas diferentes.
          style={{ ...viewportOverlayStyle(viewport), zIndex: 2147483000, pointerEvents: "auto" }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onFocusCapture={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={() => setState({ open: false, minimized: false })}
            aria-label="Fechar central de atendimento"
          />
          <section
            className="absolute inset-x-3 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            style={{
              // Com teclado aberto não sobra espaço para respiro no topo: o
              // painel encosta e o cabeçalho fica garantido.
              top: viewport.keyboardOpen ? "0.5rem" : "max(5rem, calc(env(safe-area-inset-top, 0px) + 1rem))",
              bottom: "0.75rem",
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Central de atendimento"
          >
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 h-12 border-b border-border bg-secondary/40">
              <div className="flex items-center gap-2 min-w-0">
                {activeId ? (
                  <button
                    type="button"
                    onClick={() => setActiveId(null)}
                    className="size-7 -ml-1 grid place-items-center rounded-md hover:bg-secondary shrink-0"
                    aria-label="Voltar para a lista de conversas"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                ) : (
                  <Headphones className="size-4 text-primary shrink-0" />
                )}
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
                      details={details} assignedNames={assignedNames} reservations={reservations} owners={owners}
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
