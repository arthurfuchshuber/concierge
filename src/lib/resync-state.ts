import { useSyncExternalStore } from "react";

/**
 * "ATUALIZANDO…" (09/11/2026, mockup D009): ao voltar de segundo plano ou reconectar, a tela ainda mostra o
 * retrato de antes — alguém (equipe, hóspede, IA) pode ter concluído um card nesse intervalo. Enquanto a releitura
 * não termina, os botões de etapa dos cards ficam neutros ("Atualizando…") e não respondem ao toque, para ninguém
 * clicar num card já resolvido. Não faz nenhuma consulta: só acompanha a releitura que o LiveSync já dispara.
 *
 * Nunca fica preso: um prazo de segurança solta o estado mesmo se a releitura não responder.
 */
const SAFETY_MS = 8_000;

let resyncing = false;
let safety: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(v: boolean) {
  if (resyncing === v) return;
  resyncing = v;
  listeners.forEach((l) => l());
}

export function beginResync() {
  set(true);
  if (safety) clearTimeout(safety);
  safety = setTimeout(() => endResync(), SAFETY_MS);
}

export function endResync() {
  if (safety) clearTimeout(safety);
  safety = null;
  set(false);
}

export function isResyncing() {
  return resyncing;
}

export function useResyncing() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => resyncing,
    () => false,
  );
}

/** Quanto tempo longe da tela justifica reler antes de aceitar cliques (abas que só piscam não contam). */
export const AWAY_RESYNC_MS = 4_000;
