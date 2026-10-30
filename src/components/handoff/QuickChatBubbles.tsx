import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Expand, X } from "lucide-react";
import { ConversationView } from "@/components/handoff/ConversationView";
import { ChannelLogo, channelOf, type ChatChannel } from "@/components/handoff/ChannelLogo";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { useManualOverlayLayer } from "@/lib/global-overlay-store";
import {
  agoLabel,
  brDate,
  brDayMonth,
  checkinPhrase,
  ordinalLabel,
  sortByNearestCheckin,
} from "@/lib/handoff-queue-order";

/**
 * AVISO FLUTUANTE DO HÓSPEDE (mockup "Playbook atual" aprovado, 27/10/2026 — Proposta A).
 *
 * Substitui o balão de 24/10/2026. Conversa transferida para humano NÃO abre a janela
 * inteira do Atendimento: surge um CARTÃO ANCORADO NO BOTÃO DA IA (com bico apontando
 * para ele), mais estreito que a tela, com nome, canal, imóvel, período da estadia,
 * o motivo em até 3 linhas e a ação clara ("Responder" / "Depois").
 *
 *  · Um hóspede: cartão logo acima do botão, etiqueta "Precisa de atendimento".
 *  · Mais de um: LEQUE ao redor do botão, ordenado pelo CHECK-IN MAIS PRÓXIMO
 *    (`handoff-queue-order.ts`). O topo do arco é a estadia mais próxima, com o cartão
 *    aberto; seguindo para a esquerda, as próximas (até 3 avatares) e, se houver mais,
 *    um "+N". Tocar num avatar traz o cartão daquele hóspede. O contador do botão
 *    mostra o total.
 *  · "Responder" abre o mini-chat no mesmo lugar (lê e responde sem sair da tela);
 *    "Abrir completo" leva à janela inteira, que segue igual.
 *  · NUNCA ESCONDIDO (29/10/2026): se o botão foi arrastado para o alto e o cartão (ou o
 *    mini-chat) não cabe acima dele, tudo abre do LADO OPOSTO — abaixo do botão, com o
 *    bico e o arco do leque espelhados.
 *  · O "X" é o X de canto padrão das janelas e dispensa o aviso (o chamado continua na
 *    fila e no contador do botão). "Depois" dispensa só o hóspede do cartão e, no leque,
 *    passa ao próximo da fila.
 */
export type QuickChatItem = {
  id: string;
  guestName: string;
  propertyName: string;
  reason: string | null;
  sessionId: string | null;
  checkinDate?: string | null;
  checkoutDate?: string | null;
  phone?: string | null;
  phoneCountry?: string | null;
  /** ISO do momento em que o chamado entrou na fila ("agora", "há 5 min"). */
  at?: string | null;
};

/** Medidas do botão da IA (FloatingDock): 48px, a 19px da borda no celular e 24px no computador. */
const FAB_SIZE = 48;
/** Distância do cartão ao botão (bico de 7px para fora do cartão). */
const GAP_SINGLE = 7;
/** Distância do botão ao fundo do cartão quando há leque (raio 62 + avatar de 38 + respiro de 10, menos o meio botão). */
const GAP_FAN = 67;
/** Raio do arco e ângulos (graus a partir do topo, para a esquerda) de cada posição do leque. */
const ARC_R = 62;
const ARC_ANGLES = [0, 34.5, 65, 94] as const;
const ARC_SIZES = [38, 30, 30, 24] as const;
const FAN_AVATARS = 3;

const CHANNEL_DOT: Record<ChatChannel, string> = { airbnb: "#e0485f", whatsapp: "#25d366", guide: "#8b5cf6" };
const CHANNEL_NAME: Record<ChatChannel, string> = { airbnb: "Airbnb", whatsapp: "WhatsApp", guide: "Guia digital" };

const CLOSE_X =
  "absolute right-0 top-0 z-[5] grid size-8 cursor-pointer place-items-center rounded-bl-[12px] rounded-tr-[calc(var(--win-radius,12px)-1px)] bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] text-muted-foreground shadow-[inset_1px_-1px_0_color-mix(in_oklab,var(--foreground)_9%,transparent)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function QuickChatBubbles({
  items,
  fabBottom,
  myUserId,
  onOpenFull,
  onDismiss,
  onOpenChatChange,
}: {
  items: QuickChatItem[];
  /** Distância (CSS) do rodapé até a BASE do botão da IA. */
  fabBottom: string;
  myUserId: string | null;
  onOpenFull: (id: string) => void;
  onDismiss: (id: string | "all") => void;
  /** Informa qual chamado está aberto no mini-chat (null = nenhum). */
  onOpenChatChange?: (id: string | null) => void;
}) {
  const [mode, setMode] = useState<"card" | "chat">("card");
  const [chatId, setChatId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const expanded = mode === "chat";
  const panelRef = useManualOverlayLayer<HTMLDivElement>(expanded, () => setMode("card"));
  const openChat = mode === "chat" ? chatId : null;
  useEffect(() => {
    onOpenChatChange?.(openChat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChat]);

  // Posição do botão da IA (sonda invisível no mesmo ponto) e do cartão, para decidir o lado.
  const probeRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ below: boolean; top: number }>({ below: false, top: 0 });
  const itemCount = items.length;

  const ordered = useMemo(
    () =>
      sortByNearestCheckin(
        items.map((i) => ({ ...i, checkinDate: i.checkinDate ?? null, checkoutDate: i.checkoutDate ?? null, at: i.at ?? null })),
      ),
    [items],
  );

  useLayoutEffect(() => {
    if (itemCount === 0) return;
    const measure = () => {
      const probe = probeRef.current;
      const box = cardRef.current ?? panelRef.current;
      if (!probe || !box) return;
      const pr = probe.getBoundingClientRect();
      const gapNow = mode === "chat" || itemCount === 1 ? GAP_SINGLE : GAP_FAN;
      const need = box.offsetHeight + gapNow + 12;
      const spaceBelow = window.innerHeight - pr.bottom;
      const below = pr.top < need && spaceBelow > pr.top;
      const top = pr.bottom + gapNow;
      setPlace((cur) => (cur.below === below && Math.abs(cur.top - top) < 0.5 ? cur : { below, top }));
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabBottom, mode, selectedId, chatId, itemCount, items]);

  if (ordered.length === 0) return null;
  const below = place.below;
  const selected = ordered.find((i) => i.id === selectedId) ?? ordered[0];
  const rank = ordered.findIndex((i) => i.id === selected.id);
  const fan = ordered.length > 1;
  const chatItem = chatId ? ordered.find((i) => i.id === chatId) ?? null : null;
  const channel = channelOf(null, selected.sessionId);

  // ───────────── Mini-chat (Responder) ─────────────
  if (mode === "chat" && chatItem) {
    return (
      <>
      {/* Sonda invisível: ocupa o lugar exato do botão da IA para medir de que lado há espaço. */}
            <div
              ref={probeRef}
              aria-hidden
              className="pointer-events-none invisible fixed right-[19px] lg:right-6"
              style={{ bottom: fabBottom, width: FAB_SIZE, height: FAB_SIZE }}
            />
      <div
        ref={panelRef}
        className="fixed right-[10px] w-[min(380px,calc(100vw-20px))] lg:right-4"
        style={{
          ...(below ? { top: place.top } : { bottom: `calc(${fabBottom} + ${FAB_SIZE + GAP_SINGLE}px)` }),
          height: "min(520px, 72dvh)",
          zIndex: 2147483000,
          pointerEvents: "auto",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="ds-overlay flex h-full flex-col overflow-hidden">
          <header className="flex items-center gap-2 border-b border-[var(--panel-div)] px-3 py-2">
            <ChannelLogo channel={channelOf(null, chatItem.sessionId)} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight text-foreground">{chatItem.guestName}</div>
              <div className="truncate text-[11px] leading-tight text-muted-foreground">{chatItem.propertyName}</div>
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
              onClick={() => setMode("card")}
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
      </div>
      </>
    );
  }

  // ───────────── Cartão (um hóspede) ou cartão + leque (vários) ─────────────
  const period = selected.checkinDate
    ? selected.checkoutDate
      ? `${brDate(selected.checkinDate)} → ${brDate(selected.checkoutDate)}`
      : brDate(selected.checkinDate)
    : "";
  const phrase = checkinPhrase(selected.checkinDate, selected.checkoutDate);
  const gap = fan ? GAP_FAN : GAP_SINGLE;
  const visible = ordered.slice(0, FAN_AVATARS);
  const extra = ordered.length - FAN_AVATARS;
  const arcAt = (i: number) => {
    const a = (ARC_ANGLES[i] * Math.PI) / 180;
    // Espelhado na vertical quando o botão está no alto e o leque abre para baixo.
    return { x: -ARC_R * Math.sin(a), y: (below ? 1 : -1) * ARC_R * Math.cos(a) };
  };

  const openReply = () => {
    setChatId(selected.id);
    setMode("chat");
  };
  const later = () => {
    // "Depois": dispensa só este hóspede; no leque, o próximo da fila assume o cartão.
    const next = ordered.find((i) => i.id !== selected.id);
    setSelectedId(next ? next.id : null);
    onDismiss(selected.id);
  };

  return (
    <>
      {/* Sonda invisível: ocupa o lugar exato do botão da IA para medir de que lado há espaço. */}
      <div
        ref={probeRef}
        aria-hidden
        className="pointer-events-none invisible fixed right-[19px] lg:right-6"
        style={{ bottom: fabBottom, width: FAB_SIZE, height: FAB_SIZE }}
      />
      <div
        ref={cardRef}
        className="fixed right-[10px] lg:right-4"
        style={{
          ...(below ? { top: place.top } : { bottom: `calc(${fabBottom} + ${FAB_SIZE + gap}px)` }),
          width: fan ? "min(300px, calc(100vw - 20px))" : "min(330px, calc(100vw - 20px))",
          zIndex: 2147483000,
          pointerEvents: "auto",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div role="group" aria-label={`Aviso de ${selected.guestName}`} className="ds-overlay box-border p-3.5">
          {/* Bico apontando para o botão da IA (centro do botão: 43px da borda no celular, 48px no computador). */}
          <span
            aria-hidden
            className={`absolute right-[26px] size-3.5 rotate-45 bg-[var(--panel)] lg:right-[25px] ${
              below
                ? "-top-[7px] shadow-[-1px_-1px_0_var(--panel-border)]"
                : "-bottom-[7px] shadow-[1px_1px_0_var(--panel-border)]"
            }`}
          />

          <button type="button" onClick={() => onDismiss("all")} aria-label="Dispensar aviso" title="Dispensar aviso" className={CLOSE_X}>
            <X className="size-[13px]" strokeWidth={1.8} />
          </button>

          <div className="flex items-center gap-2.5 pr-[22px]">
            <div className="relative grid size-9 flex-none place-items-center rounded-full bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] font-display text-sm font-bold">
              {(selected.guestName.trim()[0] ?? "H").toUpperCase()}
              <span
                role="img"
                aria-label={CHANNEL_NAME[channel]}
                className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full shadow-[0_0_0_2px_var(--panel)]"
                style={{ background: CHANNEL_DOT[channel] }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-[14.5px] font-bold leading-5">{selected.guestName}</span>
                <PhoneActionButton phone={selected.phone} country={selected.phoneCountry} size={16} alwaysShow className="p-0" />
                <span className="flex-none text-[11.5px] text-muted-foreground">· {agoLabel(selected.at)}</span>
              </div>
              {selected.propertyName ? (
                <div className="truncate text-xs leading-4 text-muted-foreground">{selected.propertyName}</div>
              ) : null}
              {period ? (
                <div className="ds-data whitespace-nowrap text-xs font-semibold leading-4 tabular-nums">{period}</div>
              ) : null}
            </div>
          </div>

          {fan ? (
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <AttentionPill>Atendimento</AttentionPill>
              <span className="text-[11.5px] font-semibold tabular-nums text-muted-foreground">
                {ordinalLabel(rank + 1)}
                {phrase ? ` · ${phrase}` : ""}
              </span>
            </div>
          ) : (
            <div className="mt-2.5">
              <AttentionPill>Precisa de atendimento</AttentionPill>
            </div>
          )}

          {selected.reason ? (
            <p className="mt-2 line-clamp-3 text-[13px] leading-[18px] text-foreground/85">{selected.reason}</p>
          ) : null}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={openReply}
              className="grid h-9 flex-1 cursor-pointer place-items-center rounded-[9px] bg-foreground text-[13px] font-bold text-background transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Responder
            </button>
            <button
              type="button"
              onClick={later}
              className="grid h-9 cursor-pointer place-items-center rounded-[9px] bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] px-4 text-[13px] font-semibold text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)] transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Depois
            </button>
          </div>
        </div>
      </div>

      {fan ? (
        // O leque nasce do CENTRO do botão da IA: a caixa tem o tamanho do botão e o mesmo recuo da borda.
        <div
          className="pointer-events-none fixed right-[19px] lg:right-6"
          style={{ bottom: fabBottom, width: FAB_SIZE, height: FAB_SIZE, zIndex: 2147483000 }}
        >
          <svg
            aria-hidden
            className="absolute overflow-visible"
            width={FAB_SIZE}
            height={FAB_SIZE}
            viewBox={`0 0 ${FAB_SIZE} ${FAB_SIZE}`}
          >
            {(() => {
              const last = arcAt(Math.min(ordered.length, 4) - 1);
              const top = arcAt(0);
              const c = FAB_SIZE / 2;
              return (
                <path
                  d={`M${c + last.x} ${c + last.y} A${ARC_R} ${ARC_R} 0 0 ${below ? 0 : 1} ${c + top.x} ${c + top.y}`}
                  fill="none"
                  stroke="var(--panel-border)"
                  strokeWidth={1}
                  strokeDasharray="2 5"
                  strokeLinecap="round"
                />
              );
            })()}
          </svg>

          {extra > 0 ? (
            <button
              type="button"
              onClick={() => setSelectedId(ordered[FAN_AVATARS].id)}
              aria-label={`${FAN_AVATARS + 1}º da fila: mais ${extra} ${extra === 1 ? "hóspede" : "hóspedes"}${
                ordered[FAN_AVATARS].checkinDate ? `, check-in a partir de ${brDayMonth(ordered[FAN_AVATARS].checkinDate)}` : ""
              }`}
              className="pointer-events-auto absolute grid cursor-pointer place-items-center rounded-full bg-[var(--surface-elevated)] text-[10.5px] font-bold text-muted-foreground shadow-[inset_0_0_0_1px_var(--panel-border),0_6px_14px_rgba(0,0,0,0.45)]"
              style={{
                width: ARC_SIZES[3],
                height: ARC_SIZES[3],
                left: FAB_SIZE / 2 + arcAt(3).x - ARC_SIZES[3] / 2,
                top: FAB_SIZE / 2 + arcAt(3).y - ARC_SIZES[3] / 2,
              }}
            >
              +{extra}
            </button>
          ) : null}

          {visible
            .map((it, i) => ({ it, i }))
            .reverse()
            .map(({ it, i }) => {
              const ch = channelOf(null, it.sessionId);
              const size = ARC_SIZES[i];
              const p = arcAt(i);
              const open = it.id === selected.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSelectedId(it.id)}
                  aria-pressed={open}
                  aria-label={`${ordinalLabel(i + 1)} da fila: ${it.guestName}, ${CHANNEL_NAME[ch]}${
                    it.checkinDate ? `, check-in em ${brDayMonth(it.checkinDate)}` : ""
                  }${open ? ", atendimento aberto" : ""}`}
                  className={`pointer-events-auto absolute grid cursor-pointer place-items-center rounded-full font-display font-bold transition-colors ${
                    open
                      ? "bg-[var(--panel-2)] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_22%,transparent),inset_0_1px_0_rgba(255,255,255,0.08),0_8px_18px_rgba(0,0,0,0.5)]"
                      : "bg-[var(--panel)] text-foreground/80 shadow-[inset_0_0_0_1px_var(--panel-border),0_6px_14px_rgba(0,0,0,0.45)]"
                  }`}
                  style={{
                    width: size,
                    height: size,
                    fontSize: i === 0 ? 14 : 12,
                    left: FAB_SIZE / 2 + p.x - size / 2,
                    top: FAB_SIZE / 2 + p.y - size / 2,
                  }}
                >
                  {(it.guestName.trim()[0] ?? "H").toUpperCase()}
                  <span
                    aria-hidden
                    className="absolute -bottom-0.5 -right-0.5 rounded-full shadow-[0_0_0_2px_var(--background)]"
                    style={{ width: i === 0 ? 11 : 10, height: i === 0 ? 11 : 10, background: CHANNEL_DOT[ch] }}
                  />
                </button>
              );
            })}
        </div>
      ) : null}
    </>
  );
}

/** Etiqueta dourada do aviso (mesmo selo de 10px/700 caixa-alta das etiquetas do sistema). */
function AttentionPill({ children }: { children: ReactNode }) {
  return (
    <span className="ds-data inline-flex h-5 items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,currentColor_12%,transparent)] px-2 text-[10px] font-bold uppercase tracking-[0.1em] shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)]">
      <i className="inline-block size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
