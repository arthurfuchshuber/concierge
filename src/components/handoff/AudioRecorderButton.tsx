import { useEffect, useRef, useState } from "react";
import { Mic, Square, Send, Trash2, Loader2 } from "lucide-react";

export type RecordedAudio = {
  blob: Blob;
  mime: string;
  durationMs: number;
};

type Props = {
  disabled?: boolean;
  maxSeconds?: number;
  onRecorded: (audio: RecordedAudio) => Promise<void> | void;
  compact?: boolean;
};

/**
 * Tap-to-record audio button with live waveform and timer.
 * - Tap the mic to start recording.
 * - Live level bars + mm:ss counter.
 * - Auto-stops at maxSeconds (default 60).
 * - Cancel button discards, Send button hands the blob to onRecorded.
 */
export function AudioRecorderButton({ disabled, maxSeconds = 60, onRecorded, compact }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stopReasonRef = useRef<"cancel" | "send" | "timeout" | null>(null);

  function cleanup() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    mediaRef.current = null;
    chunksRef.current = [];
  }

  useEffect(() => () => cleanup(), []);

  function pickMime(): string {
    // Preferimos mp4/AAC quando o navegador suportar (Safari) — é o codec de áudio
    // com maior compatibilidade cross-browser. O Chrome não suporta mp4 no
    // MediaRecorder e cai para webm/opus automaticamente.
    const candidates = [
      "audio/mp4",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg",
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }


  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const finalMime = rec.mimeType || mime || "audio/webm";
        const durationMs = Math.min(Date.now() - startedAtRef.current, maxSeconds * 1000);
        const reason = stopReasonRef.current;
        stopReasonRef.current = null;
        const blob = new Blob(chunksRef.current, { type: finalMime });
        cleanup();
        setElapsedMs(0);
        setLevel([]);
        if (reason === "cancel") {
          setState("idle");
          return;
        }
        // send or timeout
        setState("sending");
        try {
          await onRecorded({ blob, mime: finalMime, durationMs });
        } catch (e) {
          setError((e as Error).message || "Falha ao enviar áudio.");
        } finally {
          setState("idle");
        }
      };
      rec.start(100);
      startedAtRef.current = Date.now();
      setState("recording");

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel((prev) => [...prev.slice(-39), rms]);
        const el = Date.now() - startedAtRef.current;
        setElapsedMs(el);
        if (el >= maxSeconds * 1000) {
          stopReasonRef.current = "timeout";
          rec.stop();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError((e as Error).message || "Sem permissão para o microfone.");
      cleanup();
      setState("idle");
    }
  }

  function stop(reason: "cancel" | "send") {
    if (!mediaRef.current) return;
    stopReasonRef.current = reason;
    if (mediaRef.current.state !== "inactive") mediaRef.current.stop();
  }

  const mm = String(Math.floor(elapsedMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0");

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        title="Gravar áudio"
        aria-label="Gravar áudio"
        className={`grid ${compact ? "size-8" : "size-9"} place-items-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40`}
      >
        <Mic className="size-4" />
      </button>
    );
  }

  if (state === "sending") {
    return (
      <div className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> enviando…
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center gap-2 rounded-full bg-red-500/10 border border-red-500/30 px-3 py-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 shrink-0">
        <span className="size-2 rounded-full bg-red-500 animate-pulse" />
        {mm}:{ss}
      </span>
      <div className="flex-1 flex items-center gap-0.5 h-6 overflow-hidden">
        {level.map((v, i) => (
          <span
            key={i}
            className="w-0.5 bg-red-500/70 rounded-full"
            style={{ height: `${Math.max(3, Math.min(22, v * 60))}px` }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => stop("cancel")}
        title="Cancelar"
        aria-label="Cancelar gravação"
        className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
      >
        <Trash2 className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => stop("send")}
        title="Enviar áudio"
        aria-label="Enviar áudio"
        className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground shrink-0"
      >
        <Send className="size-3.5" />
      </button>
      {error && <span className="text-[10px] text-destructive ml-1">{error}</span>}
      {!error && (
        <button
          type="button"
          onClick={() => stop("send")}
          className="hidden"
          aria-hidden
        >
          <Square className="size-3.5" />
        </button>
      )}
    </div>
  );
}
