ALTER TABLE public.properties RENAME COLUMN access_instructions TO gate_instructions;
ALTER TABLE public.properties RENAME COLUMN access_media TO gate_media;
ALTER TABLE public.properties RENAME COLUMN access_video_url TO gate_video_url;

ALTER TABLE public.properties
  ADD COLUMN lock_instructions text,
  ADD COLUMN lock_video_url text,
  ADD COLUMN lock_media jsonb NOT NULL DEFAULT '[]'::jsonb;