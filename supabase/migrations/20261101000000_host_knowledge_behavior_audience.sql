-- Público das informações ensinadas à IA (01/11/2026): G = Hóspede Ativo (padrão), P = Público, I = Equipe Interna.
-- "I" nunca entra na base de conhecimento nem no prompt do atendimento ao hóspede.
alter table public.host_knowledge add column if not exists audience text not null default 'G';
alter table public.host_behavior add column if not exists audience text not null default 'G';
alter table public.host_knowledge drop constraint if exists host_knowledge_audience_check;
alter table public.host_knowledge add constraint host_knowledge_audience_check check (audience in ('G','P','I'));
alter table public.host_behavior drop constraint if exists host_behavior_audience_check;
alter table public.host_behavior add constraint host_behavior_audience_check check (audience in ('G','P','I'));
