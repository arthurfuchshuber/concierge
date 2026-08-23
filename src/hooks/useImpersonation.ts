import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type Impersonation = { userId: string; name: string; email: string | null } | null;


const KEY = "sg-impersonate";
const EVT = "sg-impersonate-change";

function read(): Impersonation {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Impersonation;
    if (!p?.userId) return null;
    return p;
  } catch {
    return null;
  }
}

export function setImpersonation(v: Impersonation) {
  if (typeof window === "undefined") return;
  if (v) window.sessionStorage.setItem(KEY, JSON.stringify(v));
  else window.sessionStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}

export function useImpersonation() {
  const [state, setState] = useState<Impersonation>(() => read());
  useEffect(() => {
    const handler = () => setState(read());
    // O evento nativo "storage" dispara para QUALQUER chave gravada no
    // localStorage/sessionStorage por outra janela/iframe da mesma origem
    // (ex.: o iframe de pré-visualização do guia gravando seu próprio
    // token de sessão ou o id da conversa do chat). Filtramos pela chave
    // para só reagir a uma troca real de conta impersonada.
    const storageHandler = (e: StorageEvent) => {
      if (e.key === KEY) handler();
    };
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);
  const clear = useCallback(() => setImpersonation(null), []);
  return { impersonation: state, clear };
}

/**
 * Recarrega os dados do painel sempre que a empresa ativa muda.
 * Sem isso, as telas continuavam exibindo o resultado da consulta anterior
 * (ex.: "Sem plano · 0" e lista de guias vazia) até um refresh manual.
 */
export function useImpersonationQuerySync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const handler = () => {
      // Trocar de empresa não pode reaproveitar NADA da anterior: limpamos o
      // cache em memória (e não apenas invalidamos) para que nenhum dado de
      // outra conta continue na tela enquanto a nova consulta responde.
      queryClient.clear();
      // O cache offline do aparelho também é descartado: ele foi gravado sob
      // a empresa anterior e não pode reidratar na próxima abertura.
      try {
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i) ?? "";
          if (k.startsWith("cia-cache-v2:") || k === "cia-cache-v1") keys.push(k);
        }
        keys.forEach((k) => window.localStorage.removeItem(k));
      } catch { /* noop */ }
    };
    // Mesmo motivo do useImpersonation acima: só limpar o cache do painel
    // quando a chave que realmente muda é a de impersonação, não a cada
    // escrita de storage feita por qualquer outra aba/iframe da origem.
    const storageHandler = (e: StorageEvent) => {
      if (e.key === KEY) handler();
    };
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [queryClient]);
}

