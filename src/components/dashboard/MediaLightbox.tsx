/**
 * TELA CHEIA COM ZOOM PARA OS REGISTROS (pedido de 11/09/2026).
 *
 * "preciso que o usuário do sistema consiga visualizar em tela cheia os
 *  registros (fotos, vídeos) e que consiga dar zoom"
 *
 * O visualizador do registro mostra a mídia num palco 4:3 com a ficha embaixo.
 * Serve para reconhecer o que é, não para examinar: um risco fino na parede, a
 * placa de um carro num vídeo de auditoria, o número de série de um aparelho —
 * nada disso se lê ali.
 *
 * POR QUE NÃO A TELA CHEIA DO NAVEGADOR: no Safari do iPhone a
 * `requestFullscreen` não vale para um elemento qualquer — só para o próprio
 * <video>. Como 71% dos acessos deste sistema vêm de iPhone, uma implementação
 * baseada nela funcionaria para a minoria. Esta camada ocupa a viewport
 * inteira, que é o comportamento que existe em todo lugar.
 *
 * O ZOOM É PRÓPRIO, e não o do navegador, por um motivo prático: o zoom nativo
 * da página ampliaria a interface junto (botões, etiquetas) e não deixaria
 * arrastar a imagem por baixo dos cantos. Aqui a transformação é só da mídia.
 *
 * Decisões tomadas com o produto (11/09):
 *  · a etiqueta da categoria e a situação da pendência CONTINUAM visíveis no
 *    topo — quem revisa vários registros seguidos perde o contexto sem elas;
 *  · existe download, porque a foto do dano costuma ir para o hóspede, para o
 *    seguro ou para o prestador.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, X } from "lucide-react";

export type LightboxMedia = {
  id: string;
  kind: "photo" | "video" | "audio" | "file" | "note";
  url: string | null;
  mime?: string | null;
};

type Props = {
  media: LightboxMedia[];
  startIndex: number;
  /** Etiqueta da categoria e cor sólida, como no palco do registro. */
  categoryLabel?: string | null;
  categoryClass?: string | null;
  /** Situação da pendência ("Em aberto" / "Resolvida" / "Cancelada"). */
  statusLabel?: string | null;
  statusClass?: string | null;
  /** Nome base do arquivo ao baixar (o registro já tem um: CASACHARM-04). */
  fileBaseName?: string | null;
  onClose: () => void;
};

const MAX_SCALE = 5;
const MIN_SCALE = 1;
const DOUBLE_TAP_SCALE = 2.5;
/** Arrastar para baixo além disto, sem zoom, fecha. */
const CLOSE_DRAG = 110;

export function MediaLightbox({
  media,
  startIndex,
  categoryLabel,
  categoryClass,
  statusLabel,
  statusClass,
  fileBaseName,
  onClose,
}: Props) {
  const [idx, setIdx] = useState(Math.max(0, Math.min(startIndex, media.length - 1)));
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [baixando, setBaixando] = useState(false);

  const atual = media[idx];
  const zoomed = scale > 1.01;

  /* Trocar de mídia zera o zoom: continuar ampliado na próxima foto
     desorienta — a pessoa vê um pedaço de algo que ela não escolheu. */
  const irPara = useCallback(
    (i: number) => {
      if (i < 0 || i > media.length - 1) return;
      setIdx(i);
      setScale(1);
      setTx(0);
      setTy(0);
    },
    [media.length],
  );

  /* ---------------- teclado (computador) ---------------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") irPara(idx + 1);
      else if (e.key === "ArrowLeft") irPara(idx - 1);
      else if (e.key === "0") {
        setScale(1);
        setTx(0);
        setTy(0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, irPara, onClose]);

  /* Com a camada aberta, a página de trás não rola. */
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  /* ---------------- gestos ---------------- */
  const palco = useRef<HTMLDivElement | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const arrasto = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const ultimoToque = useRef(0);

  function posicaoRelativa(e: React.PointerEvent) {
    const r = palco.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  }

  function onPointerDown(e: React.PointerEvent) {
    // O <video> precisa dos próprios controles: não sequestramos o toque nele.
    if ((e.target as HTMLElement).tagName === "VIDEO" && !zoomed) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

    if (pointers.current.size === 2) {
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
      const novo = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, (d / pinch.current.dist) * pinch.current.scale),
      );
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

    // Com zoom o arrasto move a imagem; sem zoom ele é intenção de trocar de
    // mídia ou de fechar — nesse caso só acompanhamos o dedo de leve.
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

      if (dy > CLOSE_DRAG && Math.abs(dy) > Math.abs(dx)) {
        onClose();
        return;
      }
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        irPara(dx < 0 ? idx + 1 : idx - 1);
        return;
      }
      // Toque parado: pode ser o segundo de um toque duplo.
      if (movimento < 10) {
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
      setTx(0);
      setTy(0);
    }

    if (pointers.current.size === 0 && zoomed) {
      const agora = Date.now();
      const partiuParado = partida && Math.hypot(e.clientX - partida.x, e.clientY - partida.y) < 10;
      if (partiuParado && agora - ultimoToque.current < 300) {
        setScale(1);
        setTx(0);
        setTy(0);
        ultimoToque.current = 0;
      } else if (partiuParado) {
        ultimoToque.current = agora;
      }
    }
    arrasto.current = null;
  }

  /* Roda do mouse só amplia com Ctrl — sem isso, rolar a página dentro da
     camada viraria zoom acidental em qualquer notebook com trackpad. */
  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const novo = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (e.deltaY < 0 ? 1.12 : 0.89)));
    setScale(novo);
    if (novo <= 1.01) {
      setTx(0);
      setTy(0);
    }
  }

  /* ---------------- baixar ---------------- */
  async function baixar() {
    if (!atual?.url || baixando) return;
    setBaixando(true);
    try {
      const resp = await fetch(atual.url);
      const blob = await resp.blob();
      const ext = atual.kind === "video" ? "mp4" : blob.type.includes("png") ? "png" : "jpg";
      const nome = `${fileBaseName || "registro"}-${idx + 1}.${ext}`;
      const arquivo = new File([blob], nome, { type: blob.type });

      // No celular, a folha de compartilhamento é o caminho natural: salvar
      // em Fotos, mandar no WhatsApp, anexar no e-mail. Só tentamos quando o
      // aparelho aceita compartilhar ARQUIVOS.
      const nav = navigator as Navigator & {
        canShare?: (d: { files: File[] }) => boolean;
        share?: (d: { files: File[] }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [arquivo] }) && nav.share) {
        await nav.share({ files: [arquivo] });
        return;
      }

      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      // Compartilhamento cancelado pelo usuário também cai aqui; não vale
      // gritar por isso.
    } finally {
      setBaixando(false);
    }
  }

  if (typeof document === "undefined" || !atual) return null;

  const transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Mídia em tela cheia"
    >
      {/* Topo: fechar, etiquetas, contador e baixar. Some por cima da mídia
          com um degradê, para não cortar a imagem. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-3 pb-6 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="pointer-events-auto grid size-9 shrink-0 place-items-center rounded-full bg-white/15 text-white backdrop-blur"
        >
          <X className="size-4.5" strokeWidth={2.5} />
        </button>

        {categoryLabel && (
          <span
            className={`pointer-events-none shrink-0 rounded-[0.25rem] px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em] text-white ${categoryClass ?? "bg-zinc-600"}`}
          >
            {categoryLabel}
          </span>
        )}
        {statusLabel && (
          <span
            className={`pointer-events-none shrink-0 rounded-[0.25rem] px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em] text-white ${statusClass ?? "bg-zinc-600"}`}
          >
            {statusLabel}
          </span>
        )}

        <span className="ml-auto shrink-0 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold tabular-nums text-white">
          {idx + 1} de {media.length}
        </span>
        {atual.url && (
          <button
            type="button"
            onClick={baixar}
            aria-label="Baixar"
            className="pointer-events-auto grid size-9 shrink-0 place-items-center rounded-full bg-white/15 text-white backdrop-blur"
          >
            {baixando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" strokeWidth={2.2} />
            )}
          </button>
        )}
      </div>

      {/* O palco. `touch-action: none` porque os gestos são nossos. */}
      <div
        ref={palco}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        className="relative flex-1 touch-none select-none overflow-hidden"
        style={{ cursor: zoomed ? "grab" : "default" }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform,
            transition: pointers.current.size ? "none" : "transform .18s ease-out",
          }}
        >
          {atual.kind === "photo" && atual.url && (
            <img
              src={atual.url}
              alt=""
              draggable={false}
              className="max-h-full max-w-full object-contain"
            />
          )}
          {atual.kind === "video" && atual.url && (
            <video
              src={atual.url}
              controls
              playsInline
              autoPlay
              className="max-h-full max-w-full object-contain"
            />
          )}
          {atual.kind !== "photo" && atual.kind !== "video" && (
            <p className="px-6 text-center text-sm text-white/70">
              Este registro não tem imagem para ampliar.
            </p>
          )}
        </div>
      </div>

      {/* Pé: bolinhas de posição e a dica do zoom. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8">
        {zoomed && (
          <span className="rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold tabular-nums text-white">
            {scale.toFixed(1).replace(".", ",")}×
          </span>
        )}
        {media.length > 1 && (
          <div className="flex items-center gap-1.5">
            {media.map((m, i) => (
              <span
                key={m.id}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? "w-4 bg-white" : "w-1.5 bg-white/40"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
