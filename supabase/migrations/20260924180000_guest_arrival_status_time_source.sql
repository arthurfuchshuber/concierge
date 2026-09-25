-- Distingue QUEM inseriu um horário previsto de chegada/saída em
-- guest_arrival_status: o próprio hóspede (formulário inicial ou o seletor
-- dentro do guia) ou a equipe (editor de Previsão do painel).
--
-- Pedido explícito, 24/09/2026: a faixa "Já acessei o Airbnb!" só pode ser
-- destravada mais cedo por um horário inserido pela EQUIPE (quando for
-- anterior ao horário padrão de check-in do imóvel) — o horário que o
-- PRÓPRIO hóspede informa nunca pode ser parâmetro para destravar o botão.
-- Sem esta coluna não havia como diferenciar as duas origens: as duas
-- gravam em `arrival_time_override`/`arrival_date_override` da mesma forma.
alter table public.guest_arrival_status
  add column if not exists arrival_time_source text
    check (arrival_time_source in ('guest', 'staff'));

comment on column public.guest_arrival_status.arrival_time_source is
  'Quem gravou arrival_date_override/arrival_time_override por último: guest (hóspede, via formulário inicial ou seletor no guia) ou staff (equipe, via editor de Previsão do painel). NULL para linhas gravadas antes desta coluna existir.';
