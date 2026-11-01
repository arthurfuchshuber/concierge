-- Público das informações da IA (01/11/2026): G = Hóspede Ativo (só com reserva ativa), P = Público (qualquer pessoa),
-- I = Equipe Interna (equipes e usuários internos; a IA nunca repassa ao hóspede).
-- O que JÁ existe entra como P (comportamento de hoje, nada deixa de ser respondido). Itens NOVOS: o usuário escolhe o público
-- ao salvar (a janela "Ensinar IA" exige a escolha e a IA só sugere).
alter table public.host_knowledge add column if not exists audience text not null default 'P';
alter table public.host_knowledge drop constraint if exists host_knowledge_audience_check;
alter table public.host_knowledge add constraint host_knowledge_audience_check check (audience in ('G','P','I'));

alter table public.host_behavior add column if not exists audience text not null default 'P';
alter table public.host_behavior drop constraint if exists host_behavior_audience_check;
alter table public.host_behavior add constraint host_behavior_audience_check check (audience in ('G','P','I'));

-- Trechos da base de conhecimento da IA: o público acompanha o trecho; a busca filtra por ele.
-- Trechos antigos ficam P até a próxima reindexação (comportamento de hoje).
alter table public.ai_kb_chunks add column if not exists audience text not null default 'P';
alter table public.ai_kb_chunks drop constraint if exists ai_kb_chunks_audience_check;
alter table public.ai_kb_chunks add constraint ai_kb_chunks_audience_check check (audience in ('G','P','I'));
