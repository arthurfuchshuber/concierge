/**
 * O RASCUNHO DA SITUAÇÃO, GUARDADO NO APARELHO (11/09/2026).
 *
 * Isto é o que teria salvado a gravação perdida às 13:45. A folha estava
 * aberta, com um vídeo de auditoria dentro, quando o app reiniciou sozinho
 * (ver `_authenticated/route.tsx`) — e levou o vídeo e o texto junto. Ela
 * refilmou tudo.
 *
 * Agora cada mudança na folha cai aqui, com os ARQUIVOS. Blob de vídeo em
 * IndexedDB é gravação direta, sem conversão: os mesmos 40 MB que em
 * localStorage nem caberiam, e que virariam 53 MB de base64 se coubessem.
 *
 * Uma chave por ALVO (imóvel + reserva), não uma global: duas situações de
 * imóveis diferentes não podem se atropelar, e é normal a pessoa abrir uma,
 * ser interrompida, e voltar depois de passar em outro apartamento.
 *
 * Some sozinho em 48 horas e ao sair da conta. Rascunho velho é pior que
 * rascunho nenhum — ninguém quer retomar a pia de anteontem.
 */
import { idbApagar, idbGravar, idbLer } from "@/lib/offline/idb";

const PREFIXO = "rascunho-situacao:";
const VALIDADE_MS = 1000 * 60 * 60 * 48;

export type MidiaGuardada = {
  key: string;
  blob: Blob;
  kind: "photo" | "video" | "audio" | "file";
  mime: string;
  name: string | null;
  durationMs: number | null;
};

export type RascunhoSituacao = {
  criadoEm: number;
  propertyId: string;
  logId?: string;
  reservationId?: string;
  cardMode: string;
  category: string;
  title: string;
  description: string;
  midias: MidiaGuardada[];
};

export function chaveRascunho(
  propertyId: string,
  alvo: { logId?: string; reservationId?: string },
): string {
  return `${PREFIXO}${propertyId}:${alvo.logId ?? alvo.reservationId ?? "-"}`;
}

export async function lerRascunho(chave: string): Promise<RascunhoSituacao | null> {
  const r = await idbLer<RascunhoSituacao>(chave);
  if (!r) return null;
  if (!r.criadoEm || Date.now() - r.criadoEm > VALIDADE_MS) {
    await idbApagar(chave);
    return null;
  }
  // Um rascunho sem nada dentro não é rascunho.
  if (!r.title?.trim() && !r.description?.trim() && (r.midias?.length ?? 0) === 0) {
    await idbApagar(chave);
    return null;
  }
  return r;
}

export async function gravarRascunho(chave: string, r: RascunhoSituacao): Promise<void> {
  if (!r.title.trim() && !r.description.trim() && r.midias.length === 0) {
    await idbApagar(chave);
    return;
  }
  await idbGravar(chave, r);
}

export async function apagarRascunho(chave: string): Promise<void> {
  await idbApagar(chave);
}

/** Resumo curto para a pergunta "quer retomar?". */
export function resumoRascunho(r: RascunhoSituacao): string {
  const partes: string[] = [];
  const fotos = r.midias.filter((m) => m.kind === "photo").length;
  const videos = r.midias.filter((m) => m.kind === "video").length;
  const outros = r.midias.length - fotos - videos;
  if (videos) partes.push(videos === 1 ? "1 vídeo" : `${videos} vídeos`);
  if (fotos) partes.push(fotos === 1 ? "1 foto" : `${fotos} fotos`);
  if (outros) partes.push(outros === 1 ? "1 arquivo" : `${outros} arquivos`);
  const texto = r.title.trim() || r.description.trim();
  if (texto) partes.push(`o texto “${texto.slice(0, 28)}${texto.length > 28 ? "…" : ""}”`);
  return partes.join(" e ") || "um rascunho";
}
