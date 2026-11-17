-- RESPOSTA BARRADA NO RASTRO (17/11/2026, auditoria; caso Marcela "tem porteiro?"): quando os validadores barram a
-- resposta, o rastro guarda o texto que o modelo escreveu (só se o guard de saída o considerou sem credencial) e os
-- bloqueios/afirmações detectadas. Sem isso, cada bloqueio indevido exigia adivinhar a frase. Só o service_role lê.
alter table public.guest_ai_generation_traces add column if not exists blocked_reply text;
alter table public.guest_ai_generation_traces add column if not exists blocked_detail text;
