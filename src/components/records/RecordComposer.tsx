import { useEffect, useRef, useState } from "react";
import { Mic, Send } from "lucide-react";
import type { RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import { AudioPill } from "./AudioPill";

/** Distância (px) arrastando para a esquerda que cancela a gravação, como no WhatsApp. */
const CANCEL_SLIDE_PX = 80;
/** Altura máxima do campo (~6 linhas); depois disso a rolagem é interna. */
const MAX_FIELD_HEIGHT_PX = 6 * 19 + 16;

function pickMime(): string {
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

/**
 * CAMPO ÚNICO do modal "Registros da reserva" (board de 08/11/2026).
 *  - Texto: um campo só, que cresce para baixo conforme o texto (até ~6 linhas, depois rola por dentro).
 *    Enter envia; Shift+Enter quebra a linha.
 *  - Microfone DENTRO do campo, ao lado do enviar (só ícone, sem fundo): segurar para gravar (ponto vermelho,
 *    tempo e "deslize para cancelar"); ao soltar, o áudio fica no campo para ouvir antes de enviar
 *    (lixeira, play, onda e duração). Igual ao WhatsApp.
 *  - Enviar: só ícone, cinza sem conteúdo e com o gradiente quando há texto ou áudio.
 * Quem decide o que acontece depois (categoria → Nova situação) é o pai, por `onSubmitText`/`onSubmitAudio`.
 */
export function RecordComposer({
  onSubmitText,
  onSubmitAudio,
  clearToken = 0,
  maxSeconds = 120,
}: {
  onSubmitText: (text: string) => void;
  onSubmitAudio: (audio: RecordedAudio) => void;
  /** Muda quando o pai consumiu o conteúdo (categoria escolhida): só então o campo é limpo. Cancelar a
   *  escolha da categoria mantém o texto/áudio no campo. */
  clearToken?: number;
  maxSeconds?: number;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [slide, setSlide] = useState(0);
  const [draft, setDraft] = useState<RecordedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRef = useRef(false);
  const startXRef = useRef(0);
  const pressedRef = useRef(false);

  // O campo acompanha o texto: a altura cresce para baixo até ~6 linhas.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_FIELD_HEIGHT_PX)}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_FIELD_HEIGHT_PX ? "auto" : "hidden";
  }, [text, draft, recording]);

  function cleanup() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
  }
  useEffect(() => () => cleanup(), []);

  async function startRecording() {
    setError(null);
    cancelRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // soltou antes da permissão/gravação começar: não grava nada
      if (!pressedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const finalMime = rec.mimeType || mime || "audio/webm";
        const durationMs = Math.min(Date.now() - startedAtRef.current, maxSeconds * 1000);
        const blob = new Blob(chunksRef.current, { type: finalMime });
        const cancelled = cancelRef.current;
        cleanup();
        setRecording(false);
        setElapsedMs(0);
        setSlide(0);
        // toque rápido (menos de 0,7 s) não vira áudio
        if (cancelled || durationMs < 700 || blob.size === 0) return;
        setDraft({ blob, mime: finalMime, durationMs });
      };
      rec.start(100);
      startedAtRef.current = Date.now();
      setRecording(true);
      timerRef.current = setInterval(() => {
        const el = Date.now() - startedAtRef.current;
        setElapsedMs(el);
        if (el >= maxSeconds * 1000) stopRecording(false);
      }, 200);
    } catch {
      setError("Sem permissão para o microfone.");
      cleanup();
      setRecording(false);
    }
  }

  function stopRecording(cancel: boolean) {
    cancelRef.current = cancel;
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function onMicDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    pressedRef.current = true;
    startXRef.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    void startRecording();
  }
  function onMicMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!pressedRef.current) return;
    const dx = Math.max(0, startXRef.current - e.clientX);
    setSlide(dx);
    if (dx >= CANCEL_SLIDE_PX) {
      pressedRef.current = false;
      stopRecording(true);
    }
  }
  function onMicUp() {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    stopRecording(false);
  }

  useEffect(() => {
    if (clearToken === 0) return;
    setText("");
    setDraft(null);
  }, [clearToken]);

  const hasContent = !!draft || !!text.trim();
  function submit() {
    if (draft) {
      onSubmitAudio(draft);
      return;
    }
    const t = text.trim();
    if (!t) return;
    onSubmitText(t);
  }

  const mmss = `${Math.floor(elapsedMs / 60000)}:${String(Math.floor(elapsedMs / 1000) % 60).padStart(2, "0")}`;

  return (
    <div>
      <div className="flex min-h-9 items-end gap-2.5 rounded-[18px] border border-border bg-background py-[8px] pl-3.5 pr-3">
        {recording ? (
          <div className="flex h-[19px] min-w-0 flex-1 items-center gap-2.5 text-xs">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="shrink-0 font-bold tabular-nums text-foreground">{mmss}</span>
            <span
              className="min-w-0 flex-1 truncate text-center text-[12px] text-muted-foreground"
              style={{ opacity: Math.max(0.25, 1 - slide / CANCEL_SLIDE_PX) }}
            >
              ‹ deslize para cancelar
            </span>
          </div>
        ) : draft ? (
          <AudioPill
            className="h-[19px] flex-1"
            blob={draft.blob}
            durationMs={draft.durationMs}
            onDelete={() => setDraft(null)}
          />
        ) : (
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Descrever situação, problema ou auditoria…"
            className="block min-w-0 flex-1 resize-none bg-transparent text-xs leading-[19px] outline-none placeholder:text-muted-foreground"
          />
        )}
        {!draft && (
          <button
            type="button"
            aria-label={recording ? "Solte para parar a gravação" : "Segure para gravar áudio"}
            title="Segure para gravar áudio"
            onPointerDown={onMicDown}
            onPointerMove={onMicMove}
            onPointerUp={onMicUp}
            onPointerCancel={onMicUp}
            onContextMenu={(e) => e.preventDefault()}
            className={`grid h-[19px] shrink-0 touch-none select-none place-items-center ${
              recording ? "scale-125 text-red-500" : "text-muted-foreground hover:text-foreground"
            } transition-transform`}
          >
            <Mic className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!hasContent || recording}
          aria-label="Enviar"
          className="grid h-[19px] shrink-0 place-items-center text-muted-foreground disabled:opacity-60"
        >
          {hasContent && !recording ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="record-composer-send" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" stopColor="#7C1AD8" />
                  <stop offset="1" stopColor="#E82DAE" />
                </linearGradient>
              </defs>
              <path
                stroke="url(#record-composer-send)"
                d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"
              />
              <path stroke="url(#record-composer-send)" d="m21.854 2.147-10.94 10.939" />
            </svg>
          ) : (
            <Send className="size-3.5" />
          )}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{error}</p>}
    </div>
  );
}
