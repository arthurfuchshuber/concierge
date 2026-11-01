-- Limite de requisições COMPARTILHADO entre instâncias (31/10/2026).
-- Antes: contador só em memória (cada instância/deploy zerava e o atacante "ganhava" tentativas novas).
-- Agora: contador atômico no banco para as rotas sensíveis (tentativas de PIN/código). Se o banco falhar,
-- o código cai no contador em memória (nunca deixa a rota sem proteção nem derruba o hóspede).
create table if not exists public.public_rate_hits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

alter table public.public_rate_hits enable row level security;
-- Sem políticas: ninguém lê/escreve direto; só a função abaixo (security definer) e o service_role.

create or replace function public.public_rate_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.public_rate_hits as h (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case when h.window_start < now() - make_interval(secs => p_window_seconds) then now() else h.window_start end,
        count = case when h.window_start < now() - make_interval(secs => p_window_seconds) then 1 else h.count + 1 end
  returning count into v_count;

  -- limpeza oportunista de janelas antigas (barata e sem cron)
  if random() < 0.01 then
    delete from public.public_rate_hits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_max;
end;
$$;

revoke all on function public.public_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.public_rate_hit(text, integer, integer) to service_role;
