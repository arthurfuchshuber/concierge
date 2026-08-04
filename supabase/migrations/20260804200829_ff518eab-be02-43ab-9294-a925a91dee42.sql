ALTER TABLE public.permission_nodes
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deprecated boolean NOT NULL DEFAULT false;

UPDATE public.permission_nodes SET label = COALESCE(label, name);

CREATE UNIQUE INDEX IF NOT EXISTS permission_nodes_slug_key ON public.permission_nodes (slug);
CREATE INDEX IF NOT EXISTS permission_nodes_parent_idx ON public.permission_nodes (parent_id);