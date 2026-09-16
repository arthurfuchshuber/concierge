
ALTER TYPE public.member_permission ADD VALUE IF NOT EXISTS 'library_view';
ALTER TYPE public.member_permission ADD VALUE IF NOT EXISTS 'ai_view';
ALTER TYPE public.member_permission ADD VALUE IF NOT EXISTS 'chat_view';
ALTER TYPE public.member_permission ADD VALUE IF NOT EXISTS 'operation_view';
ALTER TYPE public.member_permission ADD VALUE IF NOT EXISTS 'operation_edit';
ALTER TYPE public.member_permission ADD VALUE IF NOT EXISTS 'guests_view';
ALTER TYPE public.member_permission ADD VALUE IF NOT EXISTS 'guests_edit';
