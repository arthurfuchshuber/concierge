ALTER TABLE public.guest_arrival_status ADD COLUMN IF NOT EXISTS assigned_provider_id uuid REFERENCES public.service_providers(id) ON DELETE SET NULL;
