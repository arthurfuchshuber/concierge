/**
 * VISUALIZADOR DE MÍDIA DOS REGISTROS — REGRA DO SISTEMA (mockup Fin-23, aprovado em 19/11/2026).
 *
 * "implemente essa tela como REGRA no sistema inteiro sempre que o usuário abrir um registro,
 *  independentemente de qual pagina ele esteja ... precisa ser impecavelmente esse layout"
 *
 * Toda foto ou vídeo de registro que o usuário abrir — Registros, Financeiro, Limpeza, pendências,
 * relato do prestador — abre AQUI, e só aqui. Nada de painel próprio por tela.
 *
 * LAYOUT (igual ao mockup):
 *  · véu escuro e quente (rgba(16,12,10,.82)) com desfoque de 14 px sobre a página — a tela de trás
 *    continua "presente", como nas demais janelas;
 *  · cabeçalho: título (Sora 15, branco) + imóvel (12,5, branco 62%); X em aba no canto superior
 *    direito (36 px, véu branco 12%, quina inferior esquerda 14 px);
 *  · a mídia num CARTÃO arredondado (18 px) com margem de 16 px, fundo escuro em degradê e sombra;
 *  · vídeo: selo com a duração no topo esquerdo, play de vidro no centro e barra fosca de controles
 *    (play, tempo, progresso com bolinha, duração, tela cheia) dentro do cartão;
 *  · setas ‹ › de vidro nas laterais do cartão — SÓ com mais de uma mídia;
 *  · embaixo do cartão: "Enviado por <autor>" à esquerda e "dd/mm/aaaa · hh:mm" à direita;
 *  · fileira de miniaturas 52×52 (a atual com anel branco, as outras apagadas) e o contador "2 de 5".
 *    A fileira rola na horizontal pelo arrasto, SEM barra de rolagem (exceção aprovada: o contador
 *    já diz onde a pessoa está). Com UMA mídia só: sem miniatura, sem seta, sem contador.
 *
 * Mantido do visualizador anterior (11/09 e 03/10/2026): zoom próprio na foto (pinça, toque duplo,
 * Ctrl+roda), arrastar para os lados troca de mídia, arrastar para baixo fecha, Esc/setas do teclado,
 * a página de trás não rola, e `pointer-events-auto` na raiz (o Dialog do Radix deixa o <body> com
 * `pointer-events: none` e a camada herdava isso).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { pushGlobalOverlay } from "@/lib/global-overlay-store";

export type ViewerMedia = {
  id: string;
  kind: "photo" | "video" | "audio" | "file" | "note";
  url: string | null;
  mime?: string | null;
  durationMs?: number | null;
  /** Quem enviou esta mídia (cai no `author` geral quando faltar). */
  author?: string | null;
  /** Quando foi enviada (ISO). */
  createdAt?: string | null;
};

type Props = {
  media: ViewerMedia[];
  startIndex?: number;
  /** Título do cabeçalho (ex.: "Fotos da Conferência", título da situação). */
  title: string;
  /** Linha de baixo do título — o imóvel. */
  subtitle?: string | null;
  /** Autor padrão, quando a mídia não traz o seu. */
  author?: string | null;
  onClose: () => void;
};

const MAX_SCALE = 5;
const MIN_SCALE = 1;
const DOUBLE_TAP_SCALE = 2.5;
/** Arrastar para baixo além disto, sem zoom, fecha. */
const CLOSE_DRAG = 110;

const GLASS = "bg-black/[0.38] backdrop-blur-[8px]";
const CARD_BG = "radial-gradient(120% 80% at 30% 20%,#4a3d33 0%,#2a221d 55%,#191411 100%)";
const THUMB_BG = "radial-gradient(120% 80% at 30% 20%,#4a3d33,#1f1915)";

function fmtClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

function fmtWhen(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const PlayGlyph = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden>
    <path d="M8 5.5v13l10.5-6.5z" />
  </svg>
);
const PauseGlyph = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden>
    <rect x="6.5" y="5" width="4" height="14" rx="1" />
    <rect x="13.5" y="5" width="4" height="14" rx="1" />
  </svg>
);
const VideoGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m22 8-6 4 6 4V8Z" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </svg>
);
const FullGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
);

/* ------------------------------------------------------------------ */
/* Vídeo com os controles do mockup (os nativos ficam desligados).      */
/* ------------------------------------------------------------------ */
function ViewerVideo({ src, durationMs }: { src: string; durationMs?: number | null }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(durationMs ? durationMs / 1000 : 0);
  const trilho = useRef<HTMLDivElement | null>(null);
  const seeking = useRef(false);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }

  function seekTo(clientX: number) {
    const v = ref.current;
    const r = trilho.current?.getBoundingClientRect();
    if (!v || !r || !dur) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    v.currentTime = f * dur;
    setCur(f * dur);
  }

  function telaCheia() {
    const v = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.requestFullscreen) void v.requestFullscreen().catch(() => v.webkitEnterFullscreen?.());
    else v.webkitEnterFullscreen?.();
  }

  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      <video
        ref={ref}
        src={src}
        playsInline
        preload="metadata"
        className="absolute inset-0 size-full object-contain"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => !seeking.current && setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
        onClick={toggle}
      />

      {/* Selo da duração, topo esquerdo. */}
      <div
        className={`pointer-events-none absolute left-3 top-3 z-[2] flex items-center gap-1.5 rounded-full px-2.5 py-[5px] text-[11px] font-bold leading-none text-white ${GLASS}`}
      >
        <VideoGlyph />
        {fmtClock(dur)}
      </div>

      {/* Play de vidro no centro, enquanto pausado. */}
      {!playing && (
        <button
          type="button"
          aria-label="Reproduzir"
          onPointerDown={stop}
          onClick={toggle}
          className="absolute left-1/2 top-1/2 z-[2] grid size-[72px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/[0.16] shadow-[inset_0_0_0_1px_rgba(255,255,255,.28),0_10px_30px_rgba(0,0,0,.35)] backdrop-blur-[10px]"
        >
          <PlayGlyph size={28} />
        </button>
      )}

      {/* Barra fosca de controles, dentro do cartão. */}
      <div
        onPointerDown={stop}
        className="absolute inset-x-2.5 bottom-2.5 z-[3] flex h-10 items-center gap-2.5 rounded-[12px] bg-black/[0.42] px-3 text-[11.5px] font-semibold tabular-nums text-white/85 backdrop-blur-[10px]"
      >
        <button type="button" aria-label={playing ? "Pausar" : "Reproduzir"} onClick={toggle} className="grid size-5 shrink-0 place-items-center">
          {playing ? <PauseGlyph size={14} /> : <PlayGlyph size={14} />}
        </button>
        <span className="shrink-0">{fmtClock(cur)}</span>
        <div
          ref={trilho}
          role="slider"
          aria-label="Progresso do vídeo"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(cur)}
          className="relative flex h-6 flex-1 cursor-pointer touch-none items-center"
          onPointerDown={(e) => {
            seeking.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            seekTo(e.clientX);
          }}
          onPointerMove={(e) => seeking.current && seekTo(e.clientX)}
          onPointerUp={() => (seeking.current = false)}
          onPointerCancel={() => (seeking.current = false)}
        >
          <div className="relative h-1 w-full rounded-full bg-white/[0.22]">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/70" style={{ width: `${pct}%` }} />
            <div
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,.4)]"
              style={{ left: `${pct}%` }}
            />
          </div>
        </div>
        <span className="shrink-0">{fmtClock(dur)}</span>
        <button type="button" aria-label="Tela cheia" onClick={telaCheia} className="grid size-5 shrink-0 place-items-center">
          <FullGlyph />
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

export function MediaLightbox({ media: all, startIndex = 0, title, subtitle, author, onClose }: Props) {
  const media = all.filter((m) => !!m.url && (m.kind === "photo" || m.kind === "video"));
  const total = media.length;
  const [idx, setIdx] = useState(Math.max(0, Math.min(startIndex, total - 1)));
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const atual = media[idx];
  const zoomed = scale > 1.01;
  const multi = total > 1;

  /* Trocar de mídia zera o zoom: continuar ampliado na próxima foto desorienta. */
  const irPara = useCallback(
    (i: number) => {
      if (i < 0 || i > total - 1) return;
      setIdx(i);
      setScale(1);
      setTx(0);
      setTy(0);
    },
    [total],
  );

  /* ---------------- teclado (computador) ---------------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Fecha SÓ o visualizador: a janela de baixo (Radix) ouve o Esc no documento.
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") irPara(idx + 1);
      else if (e.key === "ArrowLeft") irPara(idx - 1);
      else if (e.key === "0") {
        setScale(1);
        setTx(0);
        setTy(0);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [idx, irPara, onClose]);

  /* Entra na pilha única de janelas: o clique aqui não conta como "clique fora" da janela de baixo. */
  useEffect(() => {
    const layer = pushGlobalOverlay("window");
    return () => layer.release();
  }, []);

  /* Com a camada aberta, a página de trás não rola. */
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  /* A miniatura atual sempre visível inteira na fileira. */
  const fileira = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = fileira.current;
    const el = box?.querySelector<HTMLElement>(`[data-thumb="${idx}"]`);
    if (!box || !el) return;
    const alvo = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
    box.scrollTo?.({ left: Math.max(0, alvo), behavior: "smooth" });
  }, [idx]);

  /* ---------------- gestos no cartão ---------------- */
  const palco = useRef<HTMLDivElement | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const arrasto = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const ultimoToque = useRef(0);
  const isPhoto = atual?.kind === "photo";

  function posicaoRelativa(e: React.PointerEvent) {
    const r = palco.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  }

  function onPointerDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2 && isPhoto) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
      arrasto.current = null;
      return;
    }
    arrasto.current = { x: e.clientX, y: e.clientY, tx, ty };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const novo = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (d / pinch.current.dist) * pinch.current.scale));
      setScale(novo);
      if (novo <= 1.01) {
        setTx(0);
        setTy(0);
      }
      return;
    }
    if (!arrasto.current) return;
    const dx = e.clientX - arrasto.current.x;
    const dy = e.clientY - arrasto.current.y;
    if (zoomed) {
      setTx(arrasto.current.tx + dx);
      setTy(arrasto.current.ty + dy);
    } else {
      setTx(dx * 0.5);
      setTy(dy > 0 ? dy * 0.5 : dy * 0.15);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const partida = arrasto.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;

    if (pointers.current.size === 0 && partida && !zoomed) {
      const dx = e.clientX - partida.x;
      const dy = e.clientY - partida.y;
      const movimento = Math.hypot(dx, dy);
      setTx(0);
      setTy(0);
      if (dy > CLOSE_DRAG && Math.abs(dy) > Math.abs(dx)) {
        onClose();
        return;
      }
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        irPara(dx < 0 ? idx + 1 : idx - 1);
        arrasto.current = null;
        return;
      }
      if (movimento < 10 && isPhoto) {
        const agora = Date.now();
        if (agora - ultimoToque.current < 300) {
          const p = posicaoRelativa(e);
          setScale(DOUBLE_TAP_SCALE);
          setTx(-p.x * (DOUBLE_TAP_SCALE - 1));
          setTy(-p.y * (DOUBLE_TAP_SCALE - 1));
          ultimoToque.current = 0;
        } else {
          ultimoToque.current = agora;
        }
      }
    }

    if (pointers.current.size === 0 && zoomed) {
      const agora = Date.now();
      const parado = partida && Math.hypot(e.clientX - partida.x, e.clientY - partida.y) < 10;
      if (parado && agora - ultimoToque.current < 300) {
        setScale(1);
        setTx(0);
        setTy(0);
        ultimoToque.current = 0;
      } else if (parado) {
        ultimoToque.current = agora;
      }
    }
    arrasto.current = null;
  }

  /* Roda do mouse só amplia com Ctrl — sem isso, o trackpad viraria zoom acidental. */
  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey || !isPhoto) return;
    e.preventDefault();
    const novo = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (e.deltaY < 0 ? 1.12 : 0.89)));
    setScale(novo);
    if (novo <= 1.01) {
      setTx(0);
      setTy(0);
    }
  }

  if (typeof document === "undefined" || !atual) return null;

  const quem = atual.author ?? author ?? null;
  const quando = fmtWhen(atual.createdAt);
  const transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[100] flex flex-col bg-[rgba(16,12,10,.82)] backdrop-blur-[14px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="mx-auto flex size-full max-w-[560px] flex-col">
        {/* Cabeçalho: título + imóvel. */}
        <div className="relative flex-none pl-5 pr-14 pt-[max(18px,calc(env(safe-area-inset-top)+12px))]">
          <div className="truncate font-display text-[15px] font-bold leading-[19px] tracking-[-0.35px] text-white">{title}</div>
          {subtitle ? (
            <div className="mt-[3px] truncate text-[12.5px] font-medium leading-4 text-white/[0.62]">{subtitle}</div>
          ) : null}
        </div>

        {/* Mídia no cartão + dados do envio. */}
        <div className="flex min-h-0 flex-1 flex-col justify-center px-4 pt-4">
          <div
            ref={palco}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            className="relative h-[min(420px,100%)] max-h-[64dvh] min-h-[220px] touch-none select-none overflow-hidden rounded-[18px] shadow-[0_0_0_1px_rgba(255,255,255,.07),0_24px_60px_rgba(0,0,0,.55)] sm:h-[min(560px,100%)]"
            style={{ background: CARD_BG, cursor: zoomed ? "grab" : "default" }}
          >
            <div
              key={atual.id}
              className="absolute inset-0"
              style={{ transform, transition: pointers.current.size ? "none" : "transform .18s ease-out" }}
            >
              {atual.kind === "photo" ? (
                <img src={atual.url!} alt="" draggable={false} className="absolute inset-0 size-full object-contain" />
              ) : (
                <ViewerVideo src={atual.url!} durationMs={atual.durationMs} />
              )}
            </div>

            {zoomed && (
              <span className={`pointer-events-none absolute right-3 top-3 z-[4] rounded-full px-2.5 py-[5px] text-[11px] font-bold tabular-nums text-white ${GLASS}`}>
                {scale.toFixed(1).replace(".", ",")}×
              </span>
            )}

            {multi && idx > 0 && (
              <button
                type="button"
                aria-label="Anterior"
                onPointerDown={stop}
                onClick={() => irPara(idx - 1)}
                className={`absolute left-2.5 top-1/2 z-[4] grid size-9 -translate-y-1/2 place-items-center rounded-full text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)] ${GLASS}`}
              >
                <ChevronLeft className="size-4" strokeWidth={2.4} />
              </button>
            )}
            {multi && idx < total - 1 && (
              <button
                type="button"
                aria-label="Próxima"
                onPointerDown={stop}
                onClick={() => irPara(idx + 1)}
                className={`absolute right-2.5 top-1/2 z-[4] grid size-9 -translate-y-1/2 place-items-center rounded-full text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)] ${GLASS}`}
              >
                <ChevronRight className="size-4" strokeWidth={2.4} />
              </button>
            )}
          </div>

          {(quem || quando) && (
            <div className="mt-3.5 flex items-center justify-between gap-3 px-1 text-[12px] font-medium leading-4 text-white/60">
              <span className="min-w-0 truncate">{quem ? `Enviado por ${quem}` : ""}</span>
              <span className="shrink-0 tabular-nums">{quando ?? ""}</span>
            </div>
          )}
        </div>

        {/* Miniaturas + contador (só com mais de uma mídia). Rolagem pelo arrasto, sem barra. */}
        <div className="flex flex-none flex-col items-center gap-2.5 pb-[max(22px,calc(env(safe-area-inset-bottom)+12px))] pt-5">
          {multi && (
            <>
              <div
                ref={fileira}
                className="max-w-full snap-x overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div className="mx-auto flex w-max gap-2.5 p-0.5">
                  {media.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      data-thumb={i}
                      aria-label={`Mídia ${i + 1} de ${total}`}
                      aria-current={i === idx}
                      onClick={() => irPara(i)}
                      className={`relative size-[52px] flex-none snap-center overflow-hidden rounded-[10px] transition-opacity ${
                        i === idx ? "opacity-100 shadow-[0_0_0_2px_#fff,0_4px_12px_rgba(0,0,0,.4)]" : "opacity-55"
                      }`}
                    >
                      {m.kind === "photo" ? (
                        <img src={m.url!} alt="" loading="lazy" draggable={false} className="block size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center" style={{ background: THUMB_BG }}>
                          <PlayGlyph size={14} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <span className="text-[11.5px] font-bold tabular-nums text-white/75">
                {idx + 1} de {total}
              </span>
            </>
          )}
        </div>
      </div>

      {/* X em aba, canto superior direito da tela. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-0 top-0 z-10 grid size-9 place-items-center rounded-bl-[14px] bg-white/[0.12] text-white"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        <X className="size-[13px]" strokeWidth={2.2} />
      </button>
    </div>,
    document.body,
  );
}
