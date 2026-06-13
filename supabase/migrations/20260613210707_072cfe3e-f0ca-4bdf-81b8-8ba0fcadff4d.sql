ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS guide_theme text NOT NULL DEFAULT 'dark';
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_guide_theme_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_guide_theme_check CHECK (guide_theme IN ('dark','light'));