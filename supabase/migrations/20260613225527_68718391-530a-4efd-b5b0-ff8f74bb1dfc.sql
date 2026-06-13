alter table public.property_recommendations
  add column if not exists walk_minutes integer,
  add column if not exists opening_hours text[];