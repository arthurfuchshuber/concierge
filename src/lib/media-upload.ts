/**
 * ENVIO DE MÍDIA QUE NÃO TRAVA (11/09/2026).
 *
 * "ela subiu os arquivos, mas o botão registrar ficou carregando sem ser
 *  liberado para publicar a situação"
 *
 * O envio antes era `supabase.storage.upload()` e ponto. Três problemas, e os
 * três apareceram no mesmo dia:
 *
 *  1. NÃO TEM PRAZO. O `fetch` por baixo não leva `AbortSignal` nem timeout —
 *     a opção nem existe no `FileOptions` da biblioteca. Quando o Android
 *     congela a aba no meio de um vídeo de 30-55 MB, a promessa não resolve
 *     NEM rejeita. O `await` fica pendurado para sempre, `saving` nunca volta
 *     a ser falso e a pessoa fica presa com o botão girando — sem poder nem
 *     descartar, porque "Descartar" também depende de `saving`.
 *
 *  2. NÃO TEM CANCELAMENTO. Sem `abort()`, a única saída era recarregar a
 *     página — e aí perdia o texto e as mídias junto.
 *
 *  3. NÃO MOSTRA NADA. Um vídeo de 40 MB em rede móvel leva minutos. Sem
 *     porcentagem, "está indo" e "travou" são a mesma tela. Quem está no
 *     imóvel troca de aplicativo, e aí trava de verdade.
 *
 * Por isso aqui é XMLHttpRequest e não `fetch`: é o único jeito no navegador
 * de ter, ao mesmo tempo, PROGRESSO DE ENVIO, cancelamento e um cão de guarda
 * de travamento. O endereço é a própria API de armazenamento do Supabase, com
 * o token da pessoa — as mesmas políticas de acesso do bucket continuam
 * valendo, nada é afrouxado aqui.
 *
 * O CÃO DE GUARDA não é um prazo total (um vídeo grande em rede ruim
 * legitimamente demora). Ele mede SILÊNCIO: se passarem 45 segundos sem
 * nenhum byte novo sair, a conexão morreu — corta e tenta de novo.
 */
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";

/** Sem byte novo por este tempo = conexão morta. */
const SILENCIO_MS = 45_000;
/** Tentativas por arquivo, contando a primeira. */
const TENTATIVAS = 3;
/** Espera entre tentativas. */
const ESPERA_MS = [1_000, 3_000];

export type MotivoFalha = "sessao" | "permissao" | "rede" | "tempo" | "cancelado" | "servidor";

export type EnvioResultado = { ok: true } | { ok: false; motivo: MotivoFalha; mensagem: string };

const MENSAGEM: Record<MotivoFalha, string> = {
  sessao: "Sua sessão expirou. Entre de novo — o texto já está salvo.",
  permissao: "Você não tem permissão para enviar arquivos neste imóvel.",
  rede: "A internet caiu durante o envio.",
  tempo: "O envio parou no meio — a conexão ficou muito lenta.",
  cancelado: "Envio cancelado.",
  servidor: "O servidor recusou o arquivo.",
};

/**
 * PRAZO PARA QUALQUER PROMESSA — e por que ela existe (11/09/2026).
 *
 * Todo `fetch` do navegador é eterno por padrão: numa rede móvel que congela,
 * ele não resolve NEM rejeita. Foi assim que o botão "Registrar situação"
 * ficou girando sem nunca liberar. Trocar o upload por XHR resolveu o envio do
 * arquivo — mas sobraram as outras três chamadas do mesmo caminho (renovar o
 * token, criar a situação, anexar a mídia), todas com o mesmo defeito.
 *
 * Daqui em diante NADA no caminho de gravar um registro pode ficar pendurado.
 * Estourou o prazo, vira erro visível com "Tentar de novo" — que é o pior
 * cenário aceitável. Spinner eterno não é.
 */
export function comPrazo<T>(promessa: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let pronto = false;
    const encerra = (fn: () => void) => {
      if (pronto) return;
      pronto = true;
      clearTimeout(t);
      signal?.removeEventListener("abort", aoCancelar);
      fn();
    };
    const t = setTimeout(() => encerra(() => reject(new Error("PRAZO"))), ms);
    const aoCancelar = () => encerra(() => reject(new Error("CANCELADO")));
    signal?.addEventListener("abort", aoCancelar);
    promessa.then(
      (v) => encerra(() => resolve(v)),
      (e) => encerra(() => reject(e)),
    );
  });
}

/** Quanto esperar a sessão e as chamadas ao servidor. Generoso, mas finito. */
export const PRAZO_AUTH_MS = 12_000;
export const PRAZO_SERVIDOR_MS = 30_000;

/**
 * Garante que existe um token válido AGORA.
 *
 * É o que faltava em 11/09: o envio saía com a sessão ainda não restaurada e a
 * política do bucket, que exige `auth.uid()`, negava em silêncio. Devolve o
 * token, ou null quando realmente não há sessão.
 */
export async function garantirToken(): Promise<string | null> {
  try {
    const { data } = await comPrazo(supabase.auth.getSession(), PRAZO_AUTH_MS);
    const sessao = data.session;
    if (!sessao?.access_token) return null;

    const agora = Math.floor(Date.now() / 1000);
    if (sessao.expires_at && sessao.expires_at - 60 > agora) return sessao.access_token;

    // Vencido ou quase: tenta renovar. Falhando por rede OU estourando o
    // prazo, devolve o token antigo mesmo — melhor tentar e receber um 401
    // claro do que desistir antes de perguntar, e melhor ainda do que ficar
    // pendurado esperando uma renovação que nunca volta.
    try {
      const { data: novo } = await comPrazo(supabase.auth.refreshSession(), PRAZO_AUTH_MS);
      return novo?.session?.access_token ?? sessao.access_token;
    } catch {
      return sessao.access_token;
    }
  } catch {
    return null;
  }
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

type UmaTentativa = { ok: true } | { ok: false; motivo: MotivoFalha; repetivel: boolean };

function tentarUmaVez(params: {
  bucket: string;
  path: string;
  blob: Blob;
  contentType: string;
  token: string;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}): Promise<UmaTentativa> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let ultimoByte = Date.now();
    let encerrado = false;

    const finalizar = (r: UmaTentativa) => {
      if (encerrado) return;
      encerrado = true;
      clearInterval(vigia);
      params.signal?.removeEventListener("abort", aoCancelar);
      resolve(r);
    };

    // Cão de guarda: mede silêncio, não duração.
    const vigia = setInterval(() => {
      if (Date.now() - ultimoByte > SILENCIO_MS) {
        try {
          xhr.abort();
        } catch {
          /* já estava morto */
        }
        finalizar({ ok: false, motivo: "tempo", repetivel: true });
      }
    }, 5_000);

    const aoCancelar = () => {
      try {
        xhr.abort();
      } catch {
        /* idem */
      }
      finalizar({ ok: false, motivo: "cancelado", repetivel: false });
    };
    params.signal?.addEventListener("abort", aoCancelar);

    xhr.upload.onprogress = (e) => {
      ultimoByte = Date.now();
      if (e.lengthComputable && e.total > 0) {
        params.onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onerror = () => finalizar({ ok: false, motivo: "rede", repetivel: true });
    xhr.ontimeout = () => finalizar({ ok: false, motivo: "tempo", repetivel: true });
    xhr.onabort = () => finalizar({ ok: false, motivo: "cancelado", repetivel: false });
    xhr.onload = () => {
      const s = xhr.status;
      if (s >= 200 && s < 300) {
        params.onProgress?.(100);
        finalizar({ ok: true });
        return;
      }
      // 401/403 = token ausente ou política do bucket. Repetir a mesma
      // requisição não muda nada; quem chama renova o token e tenta de novo.
      if (s === 401) finalizar({ ok: false, motivo: "sessao", repetivel: true });
      else if (s === 403) finalizar({ ok: false, motivo: "permissao", repetivel: false });
      // 5xx e 429 costumam passar sozinhos; 4xx restante é o arquivo mesmo.
      else if (s >= 500 || s === 429) finalizar({ ok: false, motivo: "servidor", repetivel: true });
      else if (s === 0) finalizar({ ok: false, motivo: "rede", repetivel: true });
      else finalizar({ ok: false, motivo: "servidor", repetivel: false });
    };

    const url = `${SUPABASE_URL}/storage/v1/object/${params.bucket}/${params.path}`;
    xhr.open("POST", url, true);
    xhr.setRequestHeader("authorization", `Bearer ${params.token}`);
    xhr.setRequestHeader("apikey", SUPABASE_KEY);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    // Sem sobrescrever: o caminho já nasce com um identificador único.
    xhr.setRequestHeader("x-upsert", "false");
    if (params.contentType) xhr.setRequestHeader("content-type", params.contentType);
    xhr.send(params.blob);
  });
}

/**
 * Envia UM arquivo, com progresso, cancelamento e até três tentativas.
 *
 * Não cria linha nenhuma no banco — quem faz isso é `appendSituationMedia`,
 * depois que este envio deu certo. A separação é de propósito: assim um
 * arquivo que sobe fica registrado na hora, e um que falha não leva os outros
 * junto.
 */
export async function enviarMidia(params: {
  bucket: string;
  path: string;
  blob: Blob;
  contentType: string;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}): Promise<EnvioResultado> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, motivo: "servidor", mensagem: MENSAGEM.servidor };
  }

  let ultimo: MotivoFalha = "rede";

  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa += 1) {
    if (params.signal?.aborted) {
      return { ok: false, motivo: "cancelado", mensagem: MENSAGEM.cancelado };
    }

    // Token renovado a cada tentativa: numa gravação longa ele pode ter
    // vencido entre a abertura da folha e o toque em "Registrar".
    const token = await garantirToken();
    if (!token) return { ok: false, motivo: "sessao", mensagem: MENSAGEM.sessao };

    const r = await tentarUmaVez({ ...params, token });
    if (r.ok) return { ok: true };

    ultimo = r.motivo;
    if (!r.repetivel) break;
    if (tentativa < TENTATIVAS - 1) {
      params.onProgress?.(0);
      await esperar(ESPERA_MS[tentativa] ?? 3_000, params.signal);
    }
  }

  return { ok: false, motivo: ultimo, mensagem: MENSAGEM[ultimo] };
}
