-- Assistente do painel: dispensar o cartão de confirmação, por usuário.
--
-- Pedido explícito (09/09/2026): "se o usuário pedir 'dispense a confirmação',
-- então ela tem que acatar e manter isso memorizado para aquele usuário
-- específico".
--
-- Por que uma coluna em `profiles` e não uma tabela nova: a preferência é de
-- UMA pessoa, e `profiles` já é a linha daquela pessoa, com o RLS certo já
-- escrito ("profiles select own" / "profiles update own"). Uma tabela nova
-- exigiria repetir esse mesmo RLS para guardar um booleano.
--
-- O que ISTO NÃO É: uma ampliação de permissão. Com a chave ligada, a
-- gravação continua passando pela MESMA server function da tela e pelo MESMO
-- RLS — se a pessoa não pode arquivar uma pendência, continua não podendo. O
-- que a chave remove é o clique de confirmação, não a checagem.
alter table public.profiles
  add column if not exists assistant_auto_confirm boolean not null default false;

comment on column public.profiles.assistant_auto_confirm is
  'Assistente do painel: quando true, a ação preparada é executada na hora, sem o cartão de confirmação. Preferência POR USUÁRIO (RLS de profiles), ligada/desligada pela própria conversa. Não amplia permissão: a gravação continua passando pela mesma server function e pelo mesmo RLS da tela.';
