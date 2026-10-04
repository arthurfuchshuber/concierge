import { useEffect, useState } from "react";
import { Play } from "lucide-react";

/**
 * PRIMEIRO QUADRO DO VÍDEO, GUARDADO (04/10/2026).
 *
 * Antes, cada miniatura de vídeo era um `<video preload="metadata">`: o
 * navegador baixava os metadados de novo a cada tela/atualização e o quadrado
 * ficava PRETO até o primeiro quadro chegar — a sensação de "carregando o
 * tempo todo". Agora o primeiro quadro é capturado UMA vez, vira uma imagem
 * pequena guardada no aparelho e as próximas telas já abrem com ela, na hora.
 * Enquanto a primeira captura não termina, aparece um quadrado neutro com o
 * ícone de play (nunca preto). Se a captura não for possível (arquivo sem
 * permissão de leitura), cai no `<video>` de sempre.
 */
const MEMORY = new Map<string, string>();
const PENDING = new Map<string, Promise<string | null>>();
const STORE = "sg:video-poster:";
const MAX_STORED = 150;

/** A URL assinada muda a cada leitura; o arquivo (caminho sem a query) não. */
function keyOf(url: string): string {
  return url.split("?")[0];
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(STORE + key);
  } catch {
    return null;
  }
}

function writeStored(key: string, data: string) {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(STORE)) keys.push(k);
    }
    if (keys.length >= MAX_STORED) for (const k of keys.slice(0, keys.length - MAX_STORED + 1)) localStorage.removeItem(k);
    localStorage.setItem(STORE + key, data);
  } catch {
    /* cota cheia / bloqueado: segue só em memória */
  }
}

function cached(key: string): string | null {
  return MEMORY.get(key) ?? readStored(key);
}

function capture(url: string, key: string): Promise<string | null> {
  const running = PENDING.get(key);
  if (running) return running;
  const p = new Promise<string | null>((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const v = document.createElement("video");
    let done = false;
    const finish = (data: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      if (data) {
        MEMORY.set(key, data);
        writeStored(key, data);
      }
      PENDING.delete(key);
      resolve(data);
    };
    const timer = setTimeout(() => finish(null), 10_000);
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.crossOrigin = "anonymous";
    v.onerror = () => finish(null);
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
      } catch {
        finish(null);
      }
    };
    v.onseeked = () => {
      try {
        const w = 120;
        const h = Math.max(1, Math.round((w * (v.videoHeight || 1)) / (v.videoWidth || 1)));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")?.drawImage(v, 0, 0, w, h);
        finish(c.toDataURL("image/jpeg", 0.65));
      } catch {
        finish(null); // canvas "contaminado" (sem CORS): usa o <video>
      }
    };
    v.src = url;
  });
  PENDING.set(key, p);
  return p;
}

export function VideoFrame({ url }: { url: string }) {
  const key = keyOf(url);
  const [poster, setPoster] = useState<string | null>(() => cached(key));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (poster || failed) return;
    let alive = true;
    void capture(url, key).then((p) => {
      if (!alive) return;
      if (p) setPoster(p);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [url, key, poster, failed]);

  if (poster) return <img src={poster} alt="" decoding="async" className="absolute inset-0 size-full object-cover" />;
  if (failed) {
    return (
      <video
        src={`${url}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full bg-black object-cover"
      />
    );
  }
  return (
    <span aria-hidden className="absolute inset-0 grid place-items-center bg-gradient-to-br from-secondary/80 to-secondary/40">
      <Play className="size-3 text-muted-foreground" />
    </span>
  );
}
