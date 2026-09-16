-- O IMÓVEL DE TESTE DA IA SAI DA VARIÁVEL DE AMBIENTE (11/09/2026).
--
-- A suíte de avaliação exigia `AI_EVALUATION_PROPERTY_IDS` — uma lista de
-- UUIDs numa variável de ambiente do projeto. A exigência em si estava certa
-- (escolher um imóvel "no escuro" geraria conversas de teste no painel de um
-- anfitrião de verdade), mas o LUGAR estava errado por dois motivos:
--
--  1. aquilo não é segredo. É o id de um imóvel do próprio cliente. Variável
--     de ambiente é para chave de API, não para configuração de produto;
--  2. e, por ser variável de ambiente, só o dono do projeto no Lovable
--     conseguia mexer — num SaaS, cada cliente precisaria abrir um chamado
--     para ligar a própria avaliação.
--
-- Agora é uma marca no próprio imóvel. Quem escolhe continua sendo uma pessoa
-- (nada é escolhido sozinho), mas a escolha vive onde ela pertence: no dado.
-- A variável de ambiente continua funcionando e tem prioridade, para não
-- quebrar quem já a tiver configurado.

alter table public.properties
  add column if not exists ai_evaluation_target boolean not null default false;

comment on column public.properties.ai_evaluation_target is
  'Imóvel dedicado a testes da IA. A suíte semanal de avaliação roda contra os imóveis marcados aqui. Marque um imóvel SEM hóspedes — as execuções geram conversas e registros de teste.';

create index if not exists properties_ai_evaluation_target_idx
  on public.properties (ai_evaluation_target)
  where ai_evaluation_target;

-- O "Apê Aconchegante a 2 km do Centro": despublicado (ninguém se hospeda) e,
-- ainda assim, o mais completo em conteúdo de cidade — 246 trechos de base e
-- 87 recomendações. É o candidato natural.
update public.properties
   set ai_evaluation_target = true
 where id = '79a16568-a5a3-4642-81c6-3860a08ad1bc';
