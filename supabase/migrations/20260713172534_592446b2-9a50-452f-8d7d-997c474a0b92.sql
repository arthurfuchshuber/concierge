
-- 1) Trigger que espelha nearby recommendations entre membros do mesmo grupo
CREATE OR REPLACE FUNCTION public.sync_nearby_recommendations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  gid uuid;
  peer_id uuid;
  src_property uuid;
  scope_val text;
BEGIN
  -- Evita recursão: o INSERT/UPDATE/DELETE que fazemos abaixo dispara de novo.
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  scope_val := COALESCE(NEW.scope::text, OLD.scope::text);
  IF scope_val <> 'nearby' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  src_property := COALESCE(NEW.property_id, OLD.property_id);

  SELECT group_id INTO gid
    FROM public.city_reference_group_members
    WHERE property_id = src_property;
  IF gid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  FOR peer_id IN
    SELECT property_id FROM public.city_reference_group_members
     WHERE group_id = gid AND property_id <> src_property
  LOOP
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.property_recommendations
       WHERE property_id = peer_id
         AND scope = 'nearby'
         AND (
           (OLD.place_id IS NOT NULL AND place_id IS NOT DISTINCT FROM OLD.place_id)
           OR (OLD.place_id IS NULL AND place_id IS NULL AND name = OLD.name)
         );

    ELSIF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.property_recommendations
         WHERE property_id = peer_id AND scope = 'nearby'
           AND (
             (NEW.place_id IS NOT NULL AND place_id IS NOT DISTINCT FROM NEW.place_id)
             OR (NEW.place_id IS NULL AND place_id IS NULL AND name = NEW.name)
           )
      ) THEN
        INSERT INTO public.property_recommendations(
          property_id, scope, type, name, category, rating, distance_text,
          distance_meters, drive_minutes, note, image_url, maps_url, place_id,
          position, user_ratings_total, walk_minutes, opening_hours, last_synced_at
        ) VALUES (
          peer_id, NEW.scope, NEW.type, NEW.name, NEW.category, NEW.rating, NEW.distance_text,
          NEW.distance_meters, NEW.drive_minutes, NEW.note, NEW.image_url, NEW.maps_url, NEW.place_id,
          NEW.position, NEW.user_ratings_total, NEW.walk_minutes, NEW.opening_hours, NEW.last_synced_at
        );
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      UPDATE public.property_recommendations SET
        type = NEW.type,
        name = NEW.name,
        category = NEW.category,
        rating = NEW.rating,
        distance_text = NEW.distance_text,
        distance_meters = NEW.distance_meters,
        drive_minutes = NEW.drive_minutes,
        note = NEW.note,
        image_url = NEW.image_url,
        maps_url = NEW.maps_url,
        position = NEW.position,
        user_ratings_total = NEW.user_ratings_total,
        walk_minutes = NEW.walk_minutes,
        opening_hours = NEW.opening_hours,
        last_synced_at = NEW.last_synced_at
       WHERE property_id = peer_id AND scope = 'nearby'
         AND (
           (NEW.place_id IS NOT NULL AND place_id IS NOT DISTINCT FROM NEW.place_id)
           OR (NEW.place_id IS NULL AND place_id IS NULL AND name = OLD.name)
         );
      IF NOT FOUND THEN
        INSERT INTO public.property_recommendations(
          property_id, scope, type, name, category, rating, distance_text,
          distance_meters, drive_minutes, note, image_url, maps_url, place_id,
          position, user_ratings_total, walk_minutes, opening_hours, last_synced_at
        ) VALUES (
          peer_id, NEW.scope, NEW.type, NEW.name, NEW.category, NEW.rating, NEW.distance_text,
          NEW.distance_meters, NEW.drive_minutes, NEW.note, NEW.image_url, NEW.maps_url, NEW.place_id,
          NEW.position, NEW.user_ratings_total, NEW.walk_minutes, NEW.opening_hours, NEW.last_synced_at
        );
      END IF;
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS sync_nearby_across_group ON public.property_recommendations;
CREATE TRIGGER sync_nearby_across_group
AFTER INSERT OR UPDATE OR DELETE ON public.property_recommendations
FOR EACH ROW EXECUTE FUNCTION public.sync_nearby_recommendations();

-- 2) Realtime para property_recommendations
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.property_recommendations;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;
ALTER TABLE public.property_recommendations REPLICA IDENTITY FULL;

-- 3) Refresh inicial: copia "Aqui pertinho" do Studio 101 para os demais membros do grupo
ALTER TABLE public.property_recommendations DISABLE TRIGGER sync_nearby_across_group;

DO $$
DECLARE
  anchor_id uuid := '3b1addff-85e6-488b-b019-bb0168df904c';
  gid uuid;
  peer_id uuid;
BEGIN
  SELECT group_id INTO gid FROM public.city_reference_group_members WHERE property_id = anchor_id;
  IF gid IS NULL THEN RETURN; END IF;

  FOR peer_id IN
    SELECT property_id FROM public.city_reference_group_members
     WHERE group_id = gid AND property_id <> anchor_id
  LOOP
    DELETE FROM public.property_recommendations WHERE property_id = peer_id AND scope = 'nearby';

    INSERT INTO public.property_recommendations(
      property_id, scope, type, name, category, rating, distance_text,
      distance_meters, drive_minutes, note, image_url, maps_url, place_id,
      position, user_ratings_total, walk_minutes, opening_hours, last_synced_at
    )
    SELECT peer_id, scope, type, name, category, rating, distance_text,
           distance_meters, drive_minutes, note, image_url, maps_url, place_id,
           position, user_ratings_total, walk_minutes, opening_hours, last_synced_at
      FROM public.property_recommendations
     WHERE property_id = anchor_id AND scope = 'nearby';
  END LOOP;
END $$;

ALTER TABLE public.property_recommendations ENABLE TRIGGER sync_nearby_across_group;
