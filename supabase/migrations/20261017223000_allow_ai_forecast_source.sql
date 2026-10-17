ALTER TABLE public.guest_arrival_status DROP CONSTRAINT IF EXISTS guest_arrival_status_arrival_time_source_check;
ALTER TABLE public.guest_arrival_status ADD CONSTRAINT guest_arrival_status_arrival_time_source_check CHECK (arrival_time_source = ANY (ARRAY['guest','staff','ai']));
