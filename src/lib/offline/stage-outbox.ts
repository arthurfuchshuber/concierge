/**
 * FILA DE CONCLUSÕES DE ETAPA GUARDADA NO APARELHO (25/10/2026).
 *
 * Por quê: "Finalizar Limpeza" dependia da internet nos segundos seguintes ao
 * toque. Em 4G oscilando o pedido morria, o card sumia só na tela de quem
 * clicou e voltava depois — os demais nunca viam a limpeza concluída.
 *
 * Agora o toque GRAVA a conclusão no aparelho (IndexedDB) e esta fila entrega
 * ao servidor com retentativa: ao abrir o painel, ao voltar a internet, ao
 * voltar para a aba e a cada 15 s. O trabalho só some do aparelho quando o
 * servidor confirma. Enquanto pendente, o card fica fora da fila local (para
 * não "reaparecer") e as listas filtradas por `semPendentes`.
 *
 * Idempotente: a chave é o card (logId); reenviar a mesma conclusão só
 * regrava o mesmo status no servidor.
 */
import { idbApagar, idbChaves, idbGravar, idbLer } from "@/lib/offline/idb";
import { ehFalhaDeRede } from "@/lib/media-upload";

const PREFIXO = "fila-etapa:";
const VALIDADE_MS = 1000 * 60 * 60 * 24 * 7;
const PRAZO_MS = 45_000;

export type TrabalhoEtapa = {
  rowId: string;
  logId?: string;
  reservationId?: string;
  from: "cleaning";
  cleaningType?: "normal" | "completa";
  rotulo: string;
  criadoEm: number;
  tentativas: number;
};

export type EventoEtapa =
  | { tipo: "concluida"; job: TrabalhoEtapa }
  | { tipo: "pendente"; job: TrabalhoEtapa; erro: string }
  | { tipo: "recusada"; job: TrabalhoEtapa; erro: string }
  | { tipo: "mudou" };

type Enviar = (job: TrabalhoEtapa) => Promise<unknown>;

const memoria = new Map<string, TrabalhoEtapa>();
const ouvintes = new Set<(e: EventoEtapa) => void>();
let enviar: Enviar | null = null;
let rodando: Promise<void> | null = null;

function emitir(e: EventoEtapa) {
  for (const fn of ouvintes) fn(e);
}

export function ouvirEtapas(fn: (e: EventoEtapa) => void): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export function configurarEtapas(fn: Enviar) {
  enviar = fn;
}

/** IDs de card com conclusão ainda não confirmada pelo servidor. */
export function etapasPendentes(): ReadonlySet<string> {
  return new Set(memoria.keys());
}

/** Tira das listas os cards cuja conclusão ainda está na fila do aparelho. */
export function semPendentes<T extends { rows?: Array<{ logId: string }> } | undefined | null>(data: T): T {
  if (!data || !data.rows || memoria.size === 0) return data;
  return { ...data, rows: data.rows.filter((r) => !memoria.has(r.logId)) } as T;
}

export async function carregarEtapas(): Promise<void> {
  try {
    const chaves = await idbChaves(PREFIXO);
    for (const k of chaves) {
      const job = await idbLer<TrabalhoEtapa>(k);
      if (!job) continue;
      if (Date.now() - job.criadoEm > VALIDADE_MS) {
        await idbApagar(k);
        continue;
      }
      memoria.set(job.rowId, job);
    }
  } catch {
    /* sem IndexedDB: segue só com a memória */
  }
  emitir({ tipo: "mudou" });
}

export async function enfileirarEtapa(job: Omit<TrabalhoEtapa, "criadoEm" | "tentativas">): Promise<void> {
  const completo: TrabalhoEtapa = { ...job, criadoEm: Date.now(), tentativas: 0 };
  memoria.set(job.rowId, completo);
  await idbGravar(PREFIXO + job.rowId, completo).catch(() => false);
  emitir({ tipo: "mudou" });
  void processarEtapas();
}

/**
 * Desfazer: true = nunca chegou ao servidor (só saiu da fila); false = o
 * servidor já gravou (ou pode ter gravado) e quem chamou deve reverter lá.
 * Com envio em andamento, espera o resultado antes de decidir — senão o
 * desfazer "funcionava" na tela e a conclusão chegava ao servidor mesmo assim.
 */
export async function cancelarEtapa(rowId: string): Promise<boolean> {
  const voo = emEnvio.get(rowId);
  if (voo) {
    const enviado = await voo;
    if (enviado) {
      memoria.delete(rowId);
      await idbApagar(PREFIXO + rowId).catch(() => undefined);
      emitir({ tipo: "mudou" });
      return false;
    }
  }
  if (!memoria.has(rowId)) return false;
  memoria.delete(rowId);
  await idbApagar(PREFIXO + rowId).catch(() => undefined);
  emitir({ tipo: "mudou" });
  return true;
}

function comPrazo<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("prazo")), PRAZO_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Falha que não se resolve tentando de novo (card sumiu, sem permissão...). */
export function ehRecusaDefinitiva(e: unknown): boolean {
  if (ehFalhaDeRede(e)) return false;
  const m = ((e as Error)?.message ?? "").toLowerCase();
  // Sessão expirando / servidor fora: transitório.
  if (/unauthori|jwt|token|5\d\d|server function info|timeout|fetch|abort/.test(m)) return false;
  return m.length > 0;
}

export function processarEtapas(): Promise<void> {
  if (rodando) return rodando;
  rodando = (async () => {
    if (!enviar) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    for (const job of [...memoria.values()]) {
      if (!memoria.has(job.rowId)) continue;
      try {
        await comPrazo(enviar(job));
        if (!memoria.has(job.rowId)) continue; // desfeito no meio do envio
        memoria.delete(job.rowId);
        await idbApagar(PREFIXO + job.rowId).catch(() => undefined);
        emitir({ tipo: "concluida", job });
      } catch (e) {
        const erro = (e as Error)?.message ?? "erro";
        if (ehRecusaDefinitiva(e)) {
          memoria.delete(job.rowId);
          await idbApagar(PREFIXO + job.rowId).catch(() => undefined);
          emitir({ tipo: "recusada", job, erro });
        } else {
          const atual = { ...job, tentativas: job.tentativas + 1 };
          if (memoria.has(job.rowId)) {
            memoria.set(job.rowId, atual);
            await idbGravar(PREFIXO + job.rowId, atual).catch(() => false);
          }
          emitir({ tipo: "pendente", job: atual, erro });
        }
      }
    }
  })().finally(() => {
    rodando = null;
  });
  return rodando;
}
