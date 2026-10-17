import { supabase } from "@/integrations/supabase/client";

/**
 * O socket do tempo real precisa do token da pessoa ANTES de assinar qualquer
 * canal, e de um token novo a cada renovação: sem isso a RLS descarta os
 * eventos em silêncio (o canal aparece "conectado", mas nada chega). Antes,
 * só o LiveSync fazia isso; os canais do Dashboard e do `useRealtimeInvalidate`
 * assinavam sem garantir o token. Agora todos passam por aqui.
 */
let bound = false;

export async function ensureRealtimeAuth(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
  } catch {
    /* sem sessão: nada a fazer */
  }
  if (bound) return;
  bound = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) void supabase.realtime.setAuth(session.access_token);
  });
}
