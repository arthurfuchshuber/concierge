
create type public.app_role as enum ('admin', 'host');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles select own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid());
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = auth.uid());

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "user_roles select own" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'host') on conflict do nothing;
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

create type public.access_mode as enum ('public', 'pin');
create type public.guide_language as enum ('pt', 'en');

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  name text not null,
  tagline text,
  hero_image_url text,
  address text,
  maps_url text,
  lat double precision,
  lng double precision,
  city text,
  country text,
  checkin_time text default '15:00',
  checkout_time text default '11:00',
  lock_code text,
  gate_code text,
  address_note text,
  wifi_ssid text,
  wifi_password text,
  host_name text,
  host_phone text,
  access_mode public.access_mode not null default 'public',
  pin_code text,
  pin_expires_at timestamptz,
  default_language public.guide_language not null default 'pt',
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.properties to authenticated;
grant all on public.properties to service_role;
alter table public.properties enable row level security;
create policy "properties owner all" on public.properties for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index idx_properties_slug on public.properties(slug);
create index idx_properties_owner on public.properties(owner_id);

create table public.property_manual_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null,
  description text,
  body text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.property_manual_items to authenticated;
grant all on public.property_manual_items to service_role;
alter table public.property_manual_items enable row level security;
create policy "manual owner all" on public.property_manual_items for all to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));

create type public.rec_scope as enum ('nearby', 'city');
create type public.rec_type as enum ('restaurant','bar','cafe','beach','attraction','market','pharmacy','park','nightlife','shopping','other');
create table public.property_recommendations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  scope public.rec_scope not null,
  type public.rec_type not null,
  name text not null,
  category text,
  rating numeric(2,1),
  distance_text text,
  distance_meters int,
  drive_minutes int,
  note text,
  image_url text,
  maps_url text,
  place_id text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.property_recommendations to authenticated;
grant all on public.property_recommendations to service_role;
alter table public.property_recommendations enable row level security;
create policy "rec owner all" on public.property_recommendations for all to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));
create index idx_rec_property on public.property_recommendations(property_id, scope, type);

create table public.property_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  label text not null,
  number text not null,
  position int not null default 0
);
grant select, insert, update, delete on public.property_emergency_contacts to authenticated;
grant all on public.property_emergency_contacts to service_role;
alter table public.property_emergency_contacts enable row level security;
create policy "emergency owner all" on public.property_emergency_contacts for all to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));

create table public.property_faqs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  question text not null,
  answer text not null,
  position int not null default 0
);
grant select, insert, update, delete on public.property_faqs to authenticated;
grant all on public.property_faqs to service_role;
alter table public.property_faqs enable row level security;
create policy "faqs owner all" on public.property_faqs for all to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));

create table public.property_checkout_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  label text not null,
  position int not null default 0
);
grant select, insert, update, delete on public.property_checkout_items to authenticated;
grant all on public.property_checkout_items to service_role;
alter table public.property_checkout_items enable row level security;
create policy "checkout owner all" on public.property_checkout_items for all to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger properties_touch before update on public.properties for each row execute function public.touch_updated_at();
