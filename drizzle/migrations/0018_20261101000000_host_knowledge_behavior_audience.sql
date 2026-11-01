alter table public.host_knowledge add column if not exists audience text not null default 'P';
alter table public.host_knowledge drop constraint if exists host_knowledge_audience_check;
alter table public.host_knowledge add constraint host_knowledge_audience_check check (audience in ('G','P','I'));

alter table public.host_behavior add column if not exists audience text not null default 'P';
alter table public.host_behavior drop constraint if exists host_behavior_audience_check;
alter table public.host_behavior add constraint host_behavior_audience_check check (audience in ('G','P','I'));

alter table public.ai_kb_chunks add column if not exists audience text not null default 'P';
alter table public.ai_kb_chunks drop constraint if exists ai_kb_chunks_audience_check;
alter table public.ai_kb_chunks add constraint ai_kb_chunks_audience_check check (audience in ('G','P','I'));
