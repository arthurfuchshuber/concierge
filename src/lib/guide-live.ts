import { supabase } from "@/integrations/supabase/client";

/**
 * Guia do hóspede em tempo real, SEM login no banco.
 *
 * O banco manda um aviso mínimo (Broadcast, canal `guide:<slug>`, sem nenhum
 * dado) quando algo da estadia, do imóvel ou do chat muda. Aqui só transformamos
 * o aviso no evento `guide-live-ping`; cada tela refaz a consulta que já tem
 * (e que já valida o código da reserva). Os intervalos de consulta continuam
 * como rede de segurança caso o socket caia.
 */
export const GUIDE_LIVE_EVENT = "guide-live-ping";

export function startGuideLive(slug: string): () => void {
  if (typeof window === "undefined" || !slug) return () => {};
  let timer: number | null = null;
  const fire = () => {
    if (timer != null) return;
    timer = window.setTimeout(() => {
      timer = null;
      window.dispatchEvent(new Event(GUIDE_LIVE_EVENT));
    }, 150);
  };
  let channel: ReturnType<typeof supabase.channel> | null = null;
  try {
    channel = supabase
      .channel(`guide:${slug}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "ping" }, fire)
      .subscribe();
  } catch {
    /* sem socket: o polling cobre */
  }
  return () => {
    if (timer != null) window.clearTimeout(timer);
    try {
      if (channel) void supabase.removeChannel(channel);
    } catch {
      /* ignore */
    }
  };
}
