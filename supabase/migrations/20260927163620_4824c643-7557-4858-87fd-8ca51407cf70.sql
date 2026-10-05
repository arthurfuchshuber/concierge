DELETE FROM public.guest_arrival_status WHERE id = '2e1d8fb5-bb25-4dea-a358-d8f61cc8b719' AND cleaning_type IS NULL AND concluded_at IS NULL;
UPDATE public.guest_arrival_status SET concluded_at = NULL WHERE id = '01df08dc-4082-4724-b622-9f3686424e87';
