import { useEffect, useState } from "react";
import { ChevronDown, Expand, Headphones, X } from "lucide-react";
import { ConversationView } from "@/components/handoff/ConversationView";
import { ChannelLogo, channelOf } from "@/components/handoff/ChannelLogo";
import { useManualOverlayLayer } from "@/lib/global-overlay-store";

/**
 * BALÃO DE ATENDIMENTO (24/10/2026, pedido explícito).
 *
 * Conversa transferida para humano NÃO abre mais a janela inteira do Atendimento:
 * surge um balão junto ao botão flutuante. Um chamado = um balão; vários = pilha
 * em cascata. Tocar na pilha lista os chamados ali mesmo; tocar num chamado
 * expande o balão num mini-chat (lê a conversa e responde sem sair da tela).
 * "Abrir completo" leva à janela inteira, que continua igual.
 */
export type QuickChatItem = {
  id: string;
  guestName: string;
  propertyName: string;
  reason: string | null;
  sessionId: string | null;
};

export function QuickChatBubbles({
  items,
  bottom,
  myUserId,
  onOpenFull,
  onDismiss,
  onOpenChatChange,
}: {
  items: QuickChatItem[];
  /** Distância (CSS) do rodapé, já acima do botão flutuante. */
  bottom: string;
  myUserId: string | null;
  onOpenFull: (id: string) => void;
  onDismiss: (id: string | "all") => void;
  /** Informa qual chamado está aberto no mini-chat (null = nenhum). */
  onOpenChatChange?: (id: string | null) => void;
}) {
  const [mode, setMode] = useState<"bubble" | "list" | "chat">("bubble");
  const [chatId, setChatId] = useState<string | null>(null);
  const expanded = mode !== "bubble";
  const panelRef = useManualOverlayLayer<HTMLDivElement>(expanded, () => setMode("bubble"));
  const openChat = mode === "chat" ? chatId : null;
  useEffect(() => {
    onOpenChatChange?.(openChat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChat]);

  if (items.length === 0) return null;
  const top = items[0];
  const chatItem = chatId ? items.find((i) => i.id === chatId) ?? null : null;
  const base = "fixed right-3 lg:right-6 w-[min(380px,calc(100vw-24px))] rounded-2xl border border-border bg-surface shadow-2xl";

  if (mode === "chat" && chatItem) {
    return (
      <div
        ref={panelRef}
        className={`${base} flex flex-col overflow-hidden`}
        style={{ bottom, height: "min(520px, 72dvh)", zIndex: 2147483000, pointerEvents: "auto" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <ChannelLogo channel={channelOf(null, chatItem.sessionId)} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight text-foreground break-words">{chatItem.guestName}</div>
            <div className="text-[11px] leading-tight text-muted-foreground break-words">{chatItem.propertyName}</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenFull(chatItem.id)}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Abrir completo"
            title="Abrir completo"
          >
            <Expand className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setMode(items.length > 1 ? "list" : "bubble")}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Recolher"
            title="Recolher"
          >
            <ChevronDown className="size-4" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <ConversationView conversationId={chatItem.id} compact myUserId={myUserId} />
        </div>
      </div>
    );
  }

  if (mode === "list") {
    return (
      <div
        ref={panelRef}
        className={`${base} overflow-hidden`}
        style={{ bottom, maxHeight: "min(480px, 72dvh)", zIndex: 2147483000, pointerEvents: "auto" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Headphones className="size-4 text-primary" />
          <span className="flex-1 text-sm font-semibold text-foreground">{items.length} hóspedes aguardando</span>
          <button
            type="button"
            onClick={() => setMode("bubble")}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
            aria-label="Recolher"
          >
            <ChevronDown className="size-4" />
          </button>
        </header>
        <div className="max-h-[min(420px,64dvh)] overflow-y-auto overscroll-contain">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                setChatId(it.id);
                setMode("chat");
              }}
              className="flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-secondary/50"
            >
              <ChannelLogo channel={channelOf(null, it.sessionId)} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-foreground break-words">{it.guestName}</span>
                <span className="block text-[11px] text-muted-foreground break-words">{it.propertyName}</span>
                {it.reason ? <span className="mt-0.5 block text-xs text-foreground/80 line-clamp-2">{it.reason}</span> : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Balão recolhido (um card ou pilha em cascata).
  const stacked = items.length > 1;
  return (
    <div className="fixed right-3 lg:right-6 w-[min(320px,calc(100vw-24px))]" style={{ bottom, zIndex: 2147483000, pointerEvents: "auto" }}>
      {stacked ? (
        <>
          <div aria-hidden className="absolute inset-x-4 -top-3 h-full rounded-2xl border border-border bg-surface/70 shadow-lg" />
          <div aria-hidden className="absolute inset-x-2 -top-1.5 h-full rounded-2xl border border-border bg-surface/90 shadow-lg" />
        </>
      ) : null}
      <div className="relative rounded-2xl border border-border bg-surface shadow-2xl">
        <button
          type="button"
          onClick={() => {
            if (stacked) setMode("list");
            else {
              setChatId(top.id);
              setMode("chat");
            }
          }}
          className="flex w-full items-start gap-2.5 px-3 py-2.5 pr-9 text-left"
        >
          <ChannelLogo channel={channelOf(null, top.sessionId)} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-foreground break-words">{top.guestName}</span>
            <span className="block text-[11px] text-muted-foreground break-words">{top.propertyName}</span>
            <span className="mt-0.5 block text-xs text-foreground/80 line-clamp-2">
              {top.reason || "Precisa de atendimento humano."}
            </span>
            {stacked ? (
              <span className="mt-1 block text-[11px] font-semibold text-primary">+{items.length - 1} aguardando · toque para ver</span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onDismiss("all")}
          className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
          aria-label="Dispensar aviso"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
