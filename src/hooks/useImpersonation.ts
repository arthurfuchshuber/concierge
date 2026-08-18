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
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", handler);
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
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", handler);
    };
  }, [queryClient]);
}

