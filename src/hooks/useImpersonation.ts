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
