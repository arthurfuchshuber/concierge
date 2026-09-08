/**
 * Botão flutuante único do painel (pedido explícito, 07/09/2026).
 *
 * Antes o canto tinha o botão do Atendimento e nada mais. Com a chegada do
 * Assistente, empilhar um segundo botão bagunçaria o canto — e o dock já é
 * arrastável, então os dois teriam que se mover juntos. A decisão foi um botão
 * só, na cor de destaque, que abre um menu com as duas opções.
 *
 * A movimentação é a mesma de antes, de propósito: arrastar na vertical, com a
 * posição guardada no aparelho. Quem já tinha o hábito de subir o botão para
 * ele não cobrir um card continua conseguindo.
 *
 * O Atendimento não é reimplementado aqui: escolher "Atendimento" dispara o
 * mesmo evento (`handoff-dock:open`) que os cards já usam para abrir uma
 * conversa, e o FloatingHandoffDock — que segue montado, só que sem botão
 * próprio — responde. Uma porta de entrada, uma implementação.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Headphones, X } from "lucide-react";
import { HANDOFF_DOCK_OPEN_EVENT } from "@/lib/handoff-dock";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

const POSITION_KEY = "handoff-dock-position-v1";

/** Mesma chave de posição do dock antigo: quem já tinha ajustado não perde. */
function loadDockBottom(): number {
  if (typeof window === "undefined") return 88;
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return 88;
    const parsed = JSON.parse(raw) as { bottom?: number };
    if (typeof parsed.bottom === "number" && Number.isFinite(parsed.bottom)) return parsed.bottom;
  } catch {
    /* posição é conveniência: valor ruim volta ao padrão */
  }
  return 88;
}
function saveDockBottom(bottom: number) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ bottom }));
  } catch {
    /* idem */
  }
}

export function FloatingDock({
  handoffAvailable,
  pendingCount = 0,
}: {
  /** false para quem não atende hóspede (prestador de limpeza, por exemplo):
   * o menu passa a ter só o Assistente. */
  handoffAvailable: boolean;
  pendingCount?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [dockBottom, setDockBottom] = useState(88);
  const [dragY, setDragY] = useState<number | null>(null);
  const keyboardInset = useKeyboardInset();
  const justDraggedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    setDockBottom(loadDockBottom());
  }, []);

  // Clicar fora fecha só o menu — o painel do assistente tem o X dele.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
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
        if (drag.moved) {
          const dy = ev.clientY - drag.startY;
          const nextTop = drag.rect.top + dy;
          const nextBottom = Math.max(
            24,
            Math.min(window.innerHeight - drag.rect.height - 24, window.innerHeight - (nextTop + drag.rect.height)),
          );
          setDockBottom(nextBottom);
          saveDockBottom(nextBottom);
          // Sem isso, soltar o arrasto contaria como clique e abriria o menu.
          justDraggedRef.current = true;
          window.setTimeout(() => {
            justDraggedRef.current = false;
          }, 120);
        }
        setDragY(null);
      },
    };
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      /* sem captura o arrasto ainda funciona pelos listeners de window */
    }
    window.addEventListener("pointermove", drag.move, { passive: false });
    window.addEventListener("pointerup", drag.up);
    window.addEventListener("pointercancel", drag.up);
  }

  if (!mounted || typeof document === "undefined") return null;

  const anchor: CSSProperties = {
    zIndex: 2147483000,
    pointerEvents: "auto",
    bottom: `calc(env(safe-area-inset-bottom,0px) + ${dockBottom}px)`,
  };

  const node = (
    <>
      {!assistantOpen && (
        <button
          onPointerDown={onPointerDown}
          onClick={() => {
            if (justDraggedRef.current) return;
            if (!handoffAvailable) {
              // Sem atendimento, um menu de uma opção só seria um clique a mais.
              setAssistantOpen(true);
              return;
            }
            setMenuOpen((v) => !v);
          }}
          aria-label="Abrir ajuda e atendimento"
          title="Atendimento e assistente · arraste para cima ou para baixo"
          className="fixed right-4 grid size-14 cursor-grab touch-none select-none place-items-center rounded-full bg-accent text-accent-foreground shadow-xl transition-transform hover:scale-105 active:cursor-grabbing lg:right-6"
          style={{
            ...anchor,
            transform: dragY === null ? undefined : `translateY(${dragY}px)`,
            transition: dragY === null ? undefined : "none",
          }}
        >
          <Sparkles className="size-6" />
          {handoffAvailable && pendingCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>
      )}

      {menuOpen && !assistantOpen && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed right-4 w-56 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl lg:right-6"
          style={{ ...anchor, bottom: `calc(env(safe-area-inset-bottom,0px) + ${dockBottom + 64}px)` }}
        >
          <button
            onClick={() => {
              setMenuOpen(false);
              window.dispatchEvent(new CustomEvent(HANDOFF_DOCK_OPEN_EVENT, { detail: {} }));
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm hover:bg-secondary/50"
          >
            <Headphones className="size-4 shrink-0 text-primary" />
            <span className="flex-1">Atendimento</span>
            {pendingCount > 0 && <span className="text-[11px] font-semibold text-red-500">{pendingCount}</span>}
          </button>
          <div className="h-px bg-border" />
          <button
            onClick={() => {
              setMenuOpen(false);
              setAssistantOpen(true);
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm hover:bg-secondary/50"
          >
            <Sparkles className="size-4 shrink-0 text-accent" />
            <span className="flex-1">Assistente</span>
          </button>
        </div>
      )}

      {assistantOpen && (
        <>
          {/* Desktop: janela do mesmo tamanho da do atendimento. */}
          <div
            className="fixed bottom-6 right-6 hidden h-[560px] w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl lg:flex"
            style={{ zIndex: 2147483000, pointerEvents: "auto" }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <AssistantPanel onClose={() => setAssistantOpen(false)} />
          </div>

          {/* Celular: ocupa a tela, que é o único jeito de a conversa caber. */}
          <div className="fixed inset-0 lg:hidden" style={{ zIndex: 2147483000, pointerEvents: "auto" }}>
            <button
              aria-label="Fechar"
              onClick={() => setAssistantOpen(false)}
              className="absolute inset-0 bg-black/40"
            >
              <X className="sr-only" />
            </button>
            {/* Com o teclado aberto o painel encolhe pelo rodapé em vez de
                escorregar para cima — é o que mantém o cabeçalho visível
                (mesmo tratamento do chat do hóspede, ver useKeyboardInset). */}
            <div
              className="absolute inset-x-3 top-12 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
              style={{ bottom: `calc(0.75rem + ${keyboardInset}px)` }}
            >
              <AssistantPanel onClose={() => setAssistantOpen(false)} />
            </div>
          </div>
        </>
      )}
    </>
  );

  return createPortal(node, document.body);
}
