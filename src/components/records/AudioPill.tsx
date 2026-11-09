import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";

/**
 * PLAYER DE ÁUDIO COMPACTO, estilo WhatsApp (board de 08/11/2026).
 * Play/pausa num círculo com o gradiente da marca, onda ocupando TODA a largura disponível (a parte já tocada
 * fica com a cor da marca) e a duração. Opcional: lixeira à esquerda (prévia antes de enviar).
 * Usado no campo do modal "Registros da reserva" (prévia depois de soltar o microfone) e na "Nova situação"
 * (o áudio gravado logo abaixo da Descrição).
 */
export function AudioPill({
  blob,
  durationMs,
  onDelete,
  className = "",
}: {
  blob: Blob;
  durationMs?: number | null;
  onDelete?: () => void;
  className?: string;
}) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const total = Math.max(0, Math.round((durationMs ?? 0) / 1000));

  // Onda decorativa, estável por áudio (derivada do tamanho do arquivo), com barras suficientes para a largura toda.
  const bars = useMemo(() => {
    let seed = (blob.size % 9973) + 7;
    return Array.from({ length: 48 }, () => {
      seed = (seed * 9301 + 49297) % 233280;
      return 4 + Math.round((seed / 233280) * 9);
    });
  }, [blob]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  }

  const shown = playing || progress > 0 ? Math.round(audioRef.current?.currentTime ?? 0) : total;
  const mmss = `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, "0")}`;

  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : total || 1;
          setProgress(Math.min(1, a.currentTime / d));
        }}
        className="hidden"
      />
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Apagar áudio"
          title="Apagar áudio"
          className="grid shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pausar áudio" : "Ouvir áudio"}
        className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
      >
        {playing ? (
          <Pause className="size-2.5" fill="currentColor" />
        ) : (
          <Play className="ml-px size-2.5" fill="currentColor" />
        )}
      </button>
      <span
        className="flex h-3.5 min-w-0 flex-1 items-center justify-between overflow-hidden"
        aria-hidden="true"
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className={`w-[2px] shrink-0 rounded-[1px] ${i / bars.length < progress ? "bg-[#E82DAE]" : "bg-foreground/30"}`}
            style={{ height: h }}
          />
        ))}
      </span>
      <span className="shrink-0 text-[10.5px] font-bold tabular-nums text-foreground/70">
        {mmss}
      </span>
    </div>
  );
}
