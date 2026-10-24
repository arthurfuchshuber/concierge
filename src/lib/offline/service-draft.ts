/**
 * RASCUNHO DO "NOVO SERVIÇO", GUARDADO NO APARELHO (23/10/2026).
 *
 * A trilha do serviço (vínculo, imóvel/reserva, prestador, data e, por último,
 * título, valor, descrição e mídias) guarda tudo em estado de tela: fechar a
 * janela por engano, recarregar a página ou o app reiniciar levava junto o que
 * a pessoa já tinha respondido. Agora cada resposta cai aqui (IndexedDB, que
 * aceita Blob de foto/vídeo), uma chave por SITUAÇÃO (Manutenção, Danos…), e a
 * trilha volta de onde parou. Some ao criar o serviço e em 48 horas — rascunho
 * velho é pior que nenhum (mesma regra do rascunho da situação).
 */
import { idbApagar, idbGravar, idbLer } from "@/lib/offline/idb";
import type { MidiaGuardada } from "@/lib/offline/situation-draft";

const PREFIXO = "rascunho-servico:";
export const VALIDADE_SERVICO_MS = 1000 * 60 * 60 * 48;

export type RascunhoServico = {
  criadoEm: number;
  situationId: string;
  step: number;
  link: "imovel" | "reserva" | null;
  propertyId: string | null;
  reservationId: string | null;
  providerId: string | null;
  /** AAAA-MM-DD */
  date: string | null;
  cents: number | null;
  centsEdited: boolean;
  title: string;
  note: string;
  midias: MidiaGuardada[];
};

export const chaveRascunhoServico = (situationId: string) => `${PREFIXO}${situationId}`;

/** Rascunho "vazio" (nada respondido) não vale a pena guardar. */
export function rascunhoServicoVazio(r: Pick<RascunhoServico, "link" | "propertyId" | "title" | "note" | "midias">) {
  return !r.link && !r.propertyId && !r.title.trim() && !r.note.trim() && r.midias.length === 0;
}

export function rascunhoServicoValido(r: RascunhoServico | null | undefined, agora = Date.now()): r is RascunhoServico {
  return !!r && !!r.criadoEm && agora - r.criadoEm <= VALIDADE_SERVICO_MS && !rascunhoServicoVazio(r);
}

export async function lerRascunhoServico(situationId: string): Promise<RascunhoServico | null> {
  try {
    const chave = chaveRascunhoServico(situationId);
    const r = await idbLer<RascunhoServico>(chave);
    if (!rascunhoServicoValido(r)) {
      if (r) await idbApagar(chave);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

export async function gravarRascunhoServico(r: RascunhoServico): Promise<void> {
  try {
    const chave = chaveRascunhoServico(r.situationId);
    if (rascunhoServicoVazio(r)) {
      await idbApagar(chave);
      return;
    }
    await idbGravar(chave, r);
  } catch {
    /* sem IndexedDB (aba anônima): segue sem rascunho */
  }
}

export async function apagarRascunhoServico(situationId: string): Promise<void> {
  try {
    await idbApagar(chaveRascunhoServico(situationId));
  } catch {
    /* idem */
  }
}
