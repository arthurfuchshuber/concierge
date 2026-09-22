-- city news/pulse: lidos apenas pelo servidor (service role). Sem leitura anônima.
drop policy if exists "city_daily_news readable by everyone" on public.city_daily_news;
drop policy if exists "public read city pulse" on public.city_daily_pulse;
revoke select on public.city_daily_news from anon;
revoke select on public.city_daily_pulse from anon;
grant all on public.city_daily_news to service_role;
grant all on public.city_daily_pulse to service_role;

-- taxonomia de POIs: leitura passa a exigir sessão (o app lê pelo servidor).
drop policy if exists "Anyone can read categories" on public.poi_categories;
drop policy if exists "Anyone can read tags" on public.poi_tags;
revoke select on public.poi_categories from anon;
revoke select on public.poi_tags from anon;

create policy "Signed-in users can read categories"
  on public.poi_categories for select to authenticated using (true);
create policy "Signed-in users can read tags"
  on public.poi_tags for select to authenticated using (true);

grant select on public.poi_categories to authenticated;
grant select on public.poi_tags to authenticated;
grant all on public.poi_categories to service_role;
grant all on public.poi_tags to service_role;