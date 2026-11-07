-- ConciergeIA · Guia Digital + IA — distância por ROTA (Google Maps) e contexto do item clicado no guia.
-- Aditiva (só ADD COLUMN + CHECK), idempotente, sem cron, sem pg_net, sem backfill e sem tocar dados existentes.
--
-- 1) property_recommendations.distance_kind
--    'route'         = `distance_meters` é o comprimento do TRAJETO calculado pelo Google Maps (rota a pé; sem
--                      rota a pé, rota de carro), gravado SÓ pela sincronização do servidor com o Google;
--    'straight_line' = a rota não pôde ser calculada e o valor é a distância em linha reta (compatibilidade);
--    NULL            = linha anterior a esta mudança ou gravada pelo editor do guia (valor do aparelho, não
--                      conferido) — tratada como "distância não confirmada" pela IA até a próxima sincronização.
--    A IA só cita metros/quilômetros quando distance_kind = 'route'.
--
-- 2) property_chat_messages.guide_context
--    Item que o hóspede tocou no Guia Digital para abrir o chat (evento da Home ou recomendação), conferido pelo
--    servidor contra os dados reais do imóvel ANTES de gravar: {kind, id, name, type, category}. Pequeno objeto
--    (≤ 2 KB), nunca texto livre do hóspede, nunca credencial.

alter table public.property_recommendations add column if not exists distance_kind text;
alter table public.property_recommendations drop constraint if exists property_recommendations_distance_kind_check;
alter table public.property_recommendations add constraint property_recommendations_distance_kind_check
  check (distance_kind is null or distance_kind in ('route', 'straight_line'));
comment on column public.property_recommendations.distance_kind is
  'Procedência de distance_meters: route (trajeto do Google Maps, gravado pela sincronização do servidor), straight_line (linha reta, rota indisponível) ou NULL (não confirmada).';

alter table public.property_chat_messages add column if not exists guide_context jsonb;
alter table public.property_chat_messages drop constraint if exists property_chat_messages_guide_context_check;
alter table public.property_chat_messages add constraint property_chat_messages_guide_context_check
  check (
    guide_context is null
    or (
      jsonb_typeof(guide_context) = 'object'
      and guide_context ? 'kind'
      and guide_context->>'kind' in ('city_event', 'place')
      and pg_column_size(guide_context) <= 2048
    )
  );
comment on column public.property_chat_messages.guide_context is
  'Item do Guia Digital que abriu o chat (evento da Home ou recomendação), conferido pelo servidor: {kind, id, name, type, category}.';

do $post$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'property_recommendations' and column_name = 'distance_kind')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'property_chat_messages' and column_name = 'guide_context') then
    raise exception 'GUIDE_MAPS_CONTEXT_POS: colunas não criadas';
  end if;
end $post$;
