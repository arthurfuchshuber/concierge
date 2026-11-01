/**
 * PAINEL DA MÍDIA DO REGISTRO (mockup aprovado, 31/10/2026).
 *
 * Clicar no quadrado da mídia do Detalhe do Registro abre SÓ a mídia, num painel
 * sobre a janela (que continua escurecida por trás) — não é a tela cheia.
 *
 *   · cabeçalho: "Categoria · 1 de 3", baixar tudo e o X da janela;
 *   · mídia grande, com a foto/vídeo inteiro sobre um fosco da própria imagem;
 *   · setas nas laterais para ir à anterior / próxima (só quando há mais de uma);
 *   · vídeo: os controles (progresso, play, tempo, volume, tela cheia) ficam DENTRO
 *     da imagem, na parte de baixo, sobre um degradê escuro;
 *   · fileira de miniaturas embaixo (a atual com contorno), 16 px de respiro em volta.
 *
 * A tela cheia com zoom (`MediaLightbox`) continua existindo: tocar na FOTO dentro do
 * painel chama `onZoom`, para quem precisa examinar um detalhe.
 */
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Maximize2,
  Mic,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AudioPlayer } from "@/components/dashboard/ReservationRecords";

export type PanelMedia = {
  id: string;
  kind: "photo" | "video" | "audio" | "file" | "note";
  url: string | null;
  durationMs?: number | null;
};

/** "1:48" — minutos e segundos, sem zero à esquerda nos minutos. */
function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Vídeo com os controles DENTRO da imagem, na parte de baixo. */
function PanelVideo({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [total, setTotal] = useState(0);
  const [muted, setMuted] = useState(false);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };
  const seek = (e: React.PointerEvent<HTMLButtonElement>) => {
    const v = video.current;
    if (!v || !total) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
  };
  const fullscreen = () => {
    const el = box.current;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (el?.requestFullscreen) void el.requestFullscreen();
    else v?.webkitEnterFullscreen?.();
  };

  return (
    <div ref={box} className="absolute inset-0 bg-black">
      <video
        ref={video}
        src={url}
        playsInline
        preload="metadata"
        onClick={toggle}
        onLoadedMetadata={(e) => setTotal(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="size-full cursor-pointer object-contain"
      />
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-4 pb-4 pt-12">
        <button
          type="button"
          aria-label="Ir para o ponto do vídeo"
          onPointerDown={seek}
          className="group flex h-4 w-full items-center"
        >
          <span className="relative block h-[3px] w-full rounded-full bg-white/30">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-white"
              style={{ width: total ? `${Math.min(100, (now / total) * 100)}%` : "0%" }}
            />
          </span>
        </button>
        <div className="mt-2 flex items-center gap-3 text-white">
          <button type="button" onClick={toggle} aria-label={playing ? "Pausar" : "Reproduzir"} className="grid size-5 place-items-center">
            {playing ? <Pause className="size-[17px] fill-current" /> : <Play className="size-[17px] fill-current" />}
          </button>
          <span className="text-xs font-medium tabular-nums">
            {fmtClock(now)} / {fmtClock(total)}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              const v = video.current;
              if (!v) return;
              v.muted = !v.muted;
              setMuted(v.muted);
            }}
            aria-label={muted ? "Ativar o som" : "Silenciar"}
            className="grid size-5 place-items-center"
          >
            {muted ? <VolumeX className="size-[17px]" /> : <Volume2 className="size-[17px]" />}
          </button>
          <button type="button" onClick={fullscreen} aria-label="Tela cheia do vídeo" className="grid size-5 place-items-center">
            <Maximize2 className="size-[17px]" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelStage({
  media,
  onZoom,
}: {
  media: PanelMedia;
  onZoom?: () => void;
}) {
  if (media.kind === "photo" && media.url) {
    return (
      <>
        <div
          aria-hidden
          className="absolute -inset-5 scale-110 bg-cover bg-center blur-2xl brightness-[.4] saturate-[.8]"
          style={{ backgroundImage: `url(${JSON.stringify(media.url)})` }}
        />
        <button
          type="button"
          onClick={onZoom}
          aria-label="Abrir em tela cheia com zoom"
          className="absolute inset-0 z-0 cursor-zoom-in"
        >
          <img src={media.url} alt="" className="size-full object-contain" />
        </button>
      </>
    );
  }
  if (media.kind === "video" && media.url) return <PanelVideo url={media.url} />;
  if (media.kind === "audio" && media.url) {
    return (
      <div className="grid size-full place-items-center px-5">
        <div className="w-full max-w-[16rem]">
          <AudioPlayer url={media.url} durationMs={media.durationMs ?? null} />
        </div>
      </div>
    );
  }
  return (
    <div className="grid size-full place-items-center gap-2 px-5 text-center text-muted-foreground">
      <FileText className="size-8" />
      <span className="text-[11px] leading-snug">O arquivo não está disponível.</span>
    </div>
  );
}

function PanelThumb({ media }: { media: PanelMedia }) {
  if (media.kind === "photo" && media.url) {
    return <img src={media.url} alt="" className="absolute inset-0 size-full object-cover" />;
  }
  if (media.kind === "video" && media.url) {
    return (
      <>
        <video
          aria-hidden
          src={`${media.url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-4 place-items-center rounded-full bg-black/60 text-white">
            <Play className="size-2 fill-current" />
          </span>
        </span>
      </>
    );
  }
  const Icon = media.kind === "audio" ? Mic : FileText;
  return <Icon className="size-4 text-muted-foreground" />;
}

export function RecordMediaPanel({
  open,
  onOpenChange,
  media,
  index,
  onIndex,
  label,
  onDownloadAll,
  downloading,
  onZoom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  media: PanelMedia[];
  index: number;
  onIndex: (i: number) => void;
  /** Nome da categoria do registro ("Incidentes"). */
  label: string;
  onDownloadAll?: () => void;
  downloading?: boolean;
  /** Toque na foto: abre a tela cheia com zoom, no mesmo índice. */
  onZoom?: (i: number) => void;
}) {
  const last = media.length - 1;
  const i = Math.max(0, Math.min(index, last));
  const current = media[i];
  const go = (d: number) => onIndex(Math.max(0, Math.min(last, i + d)));

  // Setas do teclado trocam a mídia enquanto o painel está aberto.
  useEffect(() => {
    if (!open || media.length < 2) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i, media.length]);

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90dvh] w-[min(420px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogDescription className="sr-only">
          Mídia do registro, ampliada. Use as setas para trocar de mídia.
        </DialogDescription>
        <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-12">
          <DialogTitle className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
            {label}
            {media.length > 1 ? (
              <>
                {" · "}
                <span className="font-bold text-foreground">
                  {i + 1} de {media.length}
                </span>
              </>
            ) : null}
          </DialogTitle>
          {onDownloadAll && (
            <button
              type="button"
              onClick={onDownloadAll}
              disabled={downloading}
              aria-label="Baixar todas as mídias"
              title="Baixa todas as mídias deste registro"
              className="grid size-7 shrink-0 place-items-center rounded-[7px] border-0 bg-[var(--action-sq-bg)] text-foreground transition-colors hover:bg-primary/[0.08] disabled:opacity-50"
            >
              {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            </button>
          )}
        </div>

        <div className="relative h-[min(58dvh,440px)] shrink-0 touch-pan-y overflow-hidden bg-[#101014]">
          <PanelStage key={current.id} media={current} onZoom={onZoom ? () => onZoom(i) : undefined} />
          {media.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={i === 0}
                aria-label="Mídia anterior"
                className="absolute left-2.5 top-1/2 z-20 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/12 transition-opacity disabled:opacity-30"
              >
                <ChevronLeft className="size-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={i === last}
                aria-label="Próxima mídia"
                className="absolute right-2.5 top-1/2 z-20 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/12 transition-opacity disabled:opacity-30"
              >
                <ChevronRight className="size-[18px]" />
              </button>
            </>
          )}
        </div>

        {media.length > 1 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-foreground/[0.07] p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {media.map((m, k) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onIndex(k)}
                aria-label={`Mídia ${k + 1}`}
                aria-current={k === i}
                className={`relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-foreground/[0.09] ${
                  k === i ? "ring-2 ring-foreground" : "opacity-55"
                }`}
              >
                <PanelThumb media={m} />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
