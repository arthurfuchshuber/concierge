-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · INVENTÁRIO DE ELEGIBILIDADE — SOMENTE LEITURA.
-- Roda no banco oficial ANTES da aplicação (identifica o estado real) e pode rodar depois (confere a foto).
-- Reproduz, em SQL puro, a regra `eligibility.2026-11-05.1` de `guest_ai_shadow_eligibility_reason`
-- (mesma ordem de motivos). O ensaio prova que este resultado = `shadow_refresh_eligibility` no mesmo banco.
-- Saída: uma linha por tenant × motivo (tenant abreviado; nenhum nome, nenhum dado de hóspede).
with p as (
  select pr.id, pr.owner_id, pr.archived_at, pr.published, pr.guide_created, pr.checkin_time, pr.checkout_time
    from public.properties pr
), r as (
  select p.id, p.owner_id,
    case
      when p.archived_at is not null then 'archived'
      when p.owner_id is null or not exists (select 1 from public.profiles f where f.id = p.owner_id) then 'tenant_unresolved'
      when exists (select 1 from public.property_listing_raw_data l
                    where l.property_id = p.id
                      and (l.owner_id is distinct from p.owner_id
                           or exists (select 1 from public.property_listing_raw_data o
                                       where o.property_id <> p.id
                                         and (o.airbnb_listing_id = l.airbnb_listing_id
                                              or (l.channex_property_id is not null and o.channex_property_id = l.channex_property_id)))))
           or exists (select 1 from public.channex_twin_links t where t.property_id = p.id and t.owner_id is distinct from p.owner_id)
        then 'listing_inconsistent'
      when not ((p.published and p.guide_created)
                or exists (select 1 from public.property_listing_raw_data l
                            where l.property_id = p.id and l.not_found_at is null
                              and not (l.sync_paused_at is not null and l.paused_reason = 'account_disconnected'))
                or exists (select 1 from public.host_whatsapp_config w where w.owner_id = p.owner_id and w.status = 'active'))
        then 'no_guest_channel'
      when coalesce(btrim(p.checkin_time), '') = '' or coalesce(btrim(p.checkout_time), '') = '' then 'operational_data_missing'
      else null
    end as reason
  from p
)
select left(owner_id::text, 8) as tenant,
       coalesce(reason, 'eligible') as status,
       count(*) as properties
  from r
 group by 1, 2
 order by 1, 2;
