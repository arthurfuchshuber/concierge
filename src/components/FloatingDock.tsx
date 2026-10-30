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
import { useLockBodyScroll, useVisualViewport, viewportOverlayStyle } from "@/hooks/useVisualViewport";
import { useAnyWindowOpen, useManualOverlayLayer } from "@/lib/global-overlay-store";

const POSITION_KEY = "handoff-dock-position-v1";

/** Altura do menu "Atendimento / Assistente" (2 linhas de 44px + divisória) e folga em volta. */
const MENU_HEIGHT = 90;
const MENU_GAP = 8;
const SCREEN_EDGE = 12;
const FAB = 48;

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
  // Uma janela aberta (ex.: "Nova situação") esconde o botão: ele cobria o
  // botão de enviar no celular.
  const windowOpen = useAnyWindowOpen();
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [dockBottom, setDockBottom] = useState(88);
  const [dragY, setDragY] = useState<number | null>(null);
  const viewport = useVisualViewport();
  // Com o chat aberto a página atrás não rola — ver useLockBodyScroll.
  useLockBodyScroll(assistantOpen);
  const justDraggedRef = useRef(false);
  const menuRef = useManualOverlayLayer<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  useEffect(() => {
    setMounted(true);
    setDockBottom(loadDockBottom());
  }, []);

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

  // NUNCA EM CIMA DE UM RODAPÉ FIXO (01/10/2026, mockup "Editar guia"
  // aprovado): uma tela com rodapé fixo (ex.: Anterior | Próximo do editor de
  // guia) publica a altura dele em `--page-footer-h`, e o botão fica pelo
  // menos 12px acima — sem mexer na posição que a pessoa escolheu arrastando
  // nas telas sem rodapé.
  const dockBottomCss = (extra: number) =>
    `max(calc(env(safe-area-inset-bottom,0px) + ${dockBottom + extra}px), calc(var(--page-footer-h, 0px) + ${12 + extra}px))`;
  const anchor: CSSProperties = {
    zIndex: 2147483000,
    pointerEvents: "auto",
    bottom: dockBottomCss(0),
  };
  // O MENU NUNCA FICA ESCONDIDO (pedido explícito, 29/10/2026): por padrão abre ACIMA do
  // botão; se o botão foi arrastado para o alto e não sobra espaço em cima, abre do lado
  // oposto (ABAIXO dele). Medido na hora da abertura, com a posição real do botão.
  const spaceAbove = typeof window === "undefined" ? Infinity : window.innerHeight - dockBottom - FAB;
  const menuBelow = spaceAbove < MENU_HEIGHT + MENU_GAP + SCREEN_EDGE;
  const menuOffset = menuBelow ? -(MENU_HEIGHT + MENU_GAP) : FAB + MENU_GAP;

  const node = (
    <>
      {!assistantOpen && !windowOpen && (
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
          aria-label={
            handoffAvailable && pendingCount > 0
              ? `Abrir ajuda e atendimento, ${pendingCount} aguardando`
              : "Abrir ajuda e atendimento"
          }
          title="Atendimento e assistente · arraste para cima ou para baixo"
          className="fixed right-[19px] grid size-12 cursor-grab touch-none select-none place-items-center rounded-full transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing lg:right-6"
          style={{
            ...anchor,
            transform: dragY === null ? undefined : `translateY(${dragY}px)`,
            transition: dragY === null ? undefined : "none",
          }}
        >
          {/* BOTÃO DA IA (mockup "Playbook atual" aprovado, 27/10/2026): esfera de 48px no degradê da marca,
              com leve flutuação (parada para quem pediu menos movimento) e o total de chamados no selo claro.
              A flutuação mora na esfera, não no botão, para não brigar com o arrasto vertical. */}
          <span
            className="fab-float relative grid size-12 place-items-center rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.45),inset_0_-6px_10px_rgba(60,0,110,0.35),0_8px_24px_rgba(124,26,216,0.55),0_2px_6px_rgba(0,0,0,0.5)]"
            style={{ background: "radial-gradient(120% 120% at 25% 15%, #b04af0 0%, #7c1ad8 48%, #c2269a 100%)" }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9.5 4l1.8 4.7L16 10.5l-4.7 1.8L9.5 17l-1.8-4.7L3 10.5l4.7-1.8z" />
              <path d="M18 3v4M16 5h4M18.5 15v3.5M16.7 16.7h3.6" />
            </svg>
            {handoffAvailable && pendingCount > 0 && (
              <span className="absolute -right-[3px] -top-[3px] grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[10px] font-extrabold leading-none text-background shadow-[0_0_0_2px_var(--background)]">
                {pendingCount > 99 ? "99+" : pendingCount}
              </span>
            )}
          </span>
        </button>
      )}

      {menuOpen && !assistantOpen && (
        <div
          ref={menuRef}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed right-[19px] w-56 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl lg:right-6"
          style={{ ...anchor, bottom: dockBottomCss(menuOffset) }}
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
          <div
            className="lg:hidden"
            // Mesma âncora do Atendimento (ver useVisualViewport).
            style={{ ...viewportOverlayStyle(viewport), zIndex: 2147483000, pointerEvents: "auto" }}
          >
            <button
              aria-label="Fechar"
              onClick={() => setAssistantOpen(false)}
              className="absolute inset-0 bg-black/40"
            >
              <X className="sr-only" />
            </button>
            {/* Com o teclado aberto o painel encolhe pelo rodapé em vez de
                escorregar para cima — é o que mantém o cabeçalho visível
                (mesmo tratamento do chat do hóspede, ver useVisualViewport). */}
            <div
              className="absolute inset-x-3 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
              style={{ top: viewport.keyboardOpen ? "0.5rem" : "3rem", bottom: "0.75rem" }}
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
