/**
 * FILA DE ENVIO DE SITUAÇÕES GUARDADA NO APARELHO (18/10/2026).
 *
 * Por quê: em 4G a criação da situação chegou a levar >60 s; a tela mostrava
 * "o servidor demorou demais", a pessoa saía do app e a foto nunca subia.
 *
 * Agora "Registrar situação" só GRAVA no aparelho (IndexedDB, com os arquivos)
 * e fecha. Esta fila envia em segundo plano e:
 *  · nunca perde nada: o trabalho só some do aparelho quando tudo chegou;
 *  · retoma sozinha ao voltar para o app, ao voltar a internet, ao reabrir
 *    o navegador e a cada 30 s;
 *  · é idempotente: o ID da situação nasce no aparelho e cada arquivo tem
 *    caminho fixo, então repetir nunca duplica registro nem arquivo.
 */
import { idbApagar, idbChaves, idbGravar, idbLer } from "@/lib/offline/idb";
import { enviarMidia, garantirToken, comPrazo } from "@/lib/media-upload";
import { comprimirImagem } from "@/lib/image-compress";
import { comprimirVideo } from "@/lib/video-compress";
import { extFor } from "@/components/dashboard/record-draft";

const PREFIXO = "fila-situacao:";
const VALIDADE_MS = 1000 * 60 * 60 * 24 * 7;
const PRAZO_CHAMADA_MS = 90_000;

export type MidiaFila = {
  key: string;
  blob: Blob;
  kind: "photo" | "video" | "audio" | "file";
  mime: string;
  name: string | null;
  durationMs: number | null;
  /** Já otimizada (foto/vídeo) — não comprime de novo numa retomada. */
  pronta?: boolean;
  path?: string;
  enviada?: boolean;
  anexada?: boolean;
};

export type TrabalhoSituacao = {
  groupId: string;
  criadoEm: number;
  propertyId: string;
  logId?: string;
  reservationId?: string;
  cardMode?: string | null;
  category: string;
  title: string | null;
  description: string | null;
  /** true quando a situação já existe no servidor (ou é um anexo a uma existente). */
  criada: boolean;
  taskId?: string | null;
  taskCreated?: boolean;
  midias: MidiaFila[];
  tentativas?: number;
  ultimoErro?: string | null;
};

export type EventoFila =
  | { tipo: "progresso"; job: TrabalhoSituacao; feitos: number; total: number; pct: number }
  | { tipo: "criada"; job: TrabalhoSituacao }
  | { tipo: "concluida"; job: TrabalhoSituacao }
  | { tipo: "pendente"; job: TrabalhoSituacao; erro: string };

type Ouvinte = (e: EventoFila) => void;
const ouvintes = new Set<Ouvinte>();
export function ouvirFila(fn: Ouvinte): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}
function emitir(e: EventoFila) {
  for (const fn of ouvintes) {
    try {
      fn(e);
    } catch {
      /* ouvinte não derruba a fila */
    }
  }
}

/** Funções do servidor, injetadas por quem monta a fila (evita ciclo de import). */
export type ServidorFila = {
  criar: (data: Record<string, unknown>) => Promise<{ groupId?: string; taskId?: string | null; taskCreated?: boolean }>;
  anexar: (data: Record<string, unknown>) => Promise<unknown>;
};
let servidor: ServidorFila | null = null;
export function configurarFila(s: ServidorFila) {
  servidor = s;
}

let ativos = 0;
export function envioEmAndamento(): boolean {
  return ativos > 0;
}

export async function enfileirarSituacao(job: TrabalhoSituacao): Promise<boolean> {
  const ok = await idbGravar(PREFIXO + job.groupId, job);
  if (ok) void processarFila();
  return ok;
}

export async function trabalhosPendentes(): Promise<TrabalhoSituacao[]> {
  const chaves = await idbChaves(PREFIXO);
  const lista: TrabalhoSituacao[] = [];
  for (const k of chaves) {
    const j = await idbLer<TrabalhoSituacao>(k);
    if (j) lista.push(j);
  }
  return lista.sort((a, b) => a.criadoEm - b.criadoEm);
}

function salvar(job: TrabalhoSituacao) {
  return idbGravar(PREFIXO + job.groupId, job);
}

export function caminhoMidia(job: TrabalhoSituacao, m: MidiaFila): string {
  const pasta = job.logId ?? job.reservationId ?? job.propertyId;
  return `${job.propertyId}/${pasta}/${job.groupId.slice(0, 8)}-${m.key}.${extFor(m.kind, m.mime)}`;
}

let rodando: Promise<void> | null = null;

/** Processa tudo que estiver na fila. Seguro de chamar a qualquer momento. */
export function processarFila(): Promise<void> {
  if (rodando) return rodando;
  rodando = (async () => {
    try {
      if (!servidor || typeof navigator === "undefined") return;
      if (navigator.onLine === false) return;
      const lista = await trabalhosPendentes();
      for (const job of lista) {
        if (Date.now() - job.criadoEm > VALIDADE_MS) {
          await idbApagar(PREFIXO + job.groupId);
          continue;
        }
        await processarUm(job);
      }
    } finally {
      rodando = null;
    }
  })();
  return rodando;
}

async function processarUm(job: TrabalhoSituacao): Promise<void> {
  const s = servidor!;
  ativos += 1;
  try {
    const token = await garantirToken();
    if (!token) throw new Error("Sessão expirada — entre de novo para concluir o envio.");

    if (!job.criada) {
      const r = await comPrazo(
        s.criar({
          groupId: job.groupId,
          propertyId: job.propertyId,
          logId: job.logId,
          reservationId: job.reservationId,
          cardMode: job.cardMode ?? undefined,
          category: job.category,
          title: job.title,
          description: job.description,
          media: [],
          pendingMedia: job.midias.length,
        }),
        PRAZO_CHAMADA_MS,
      );
      job.criada = true;
      job.taskId = r?.taskId ?? null;
      job.taskCreated = !!r?.taskCreated;
      await salvar(job);
      emitir({ tipo: "criada", job });
    }

    const total = job.midias.length;
    for (let i = 0; i < total; i += 1) {
      const m = job.midias[i];
      if (m.anexada) continue;
      const feitos = job.midias.filter((x) => x.anexada).length;
      emitir({ tipo: "progresso", job, feitos, total, pct: 0 });

      if (!m.pronta) {
        try {
          if (m.kind === "photo") {
            m.blob = await comprimirImagem(m.blob, m.mime);
          } else if (m.kind === "video") {
            const f = await comprimirVideo(m.blob);
            m.blob = f.blob;
            m.mime = f.mime || m.mime;
          }
        } catch {
          /* sem otimização: sobe o original */
        }
        m.pronta = true;
        m.path = caminhoMidia(job, m);
        await salvar(job);
      }
      if (!m.path) {
        m.path = caminhoMidia(job, m);
        await salvar(job);
      }

      if (!m.enviada) {
        const r = await enviarMidia({
          bucket: "reservation-records",
          path: m.path,
          blob: m.blob,
          contentType: m.mime || "application/octet-stream",
          onProgress: (pct) => emitir({ tipo: "progresso", job, feitos, total, pct }),
        });
        if (!r.ok) throw new Error(r.mensagem);
        m.enviada = true;
        await salvar(job);
      }

      await comPrazo(
        s.anexar({
          groupId: job.groupId,
          propertyId: job.propertyId,
          path: m.path,
          kind: m.kind,
          mime: m.mime || "application/octet-stream",
          sizeBytes: m.blob.size,
          durationMs: m.durationMs,
        }),
        PRAZO_CHAMADA_MS,
      );
      m.anexada = true;
      await salvar(job);
    }

    await idbApagar(PREFIXO + job.groupId);
    emitir({ tipo: "concluida", job });
  } catch (e) {
    const msg = e instanceof Error && e.message !== "PRAZO" ? e.message : "A internet está lenta.";
    job.tentativas = (job.tentativas ?? 0) + 1;
    job.ultimoErro = msg;
    await salvar(job);
    emitir({ tipo: "pendente", job, erro: msg });
  } finally {
    ativos -= 1;
  }
}
