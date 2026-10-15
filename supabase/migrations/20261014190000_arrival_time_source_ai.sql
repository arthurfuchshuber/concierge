-- Previsão de horário captada pela IA (chat Airbnb, WhatsApp e Guia) passa a
-- gravar arrival_time_source = 'ai'. 'ai' (como 'guest') NÃO destrava a faixa
-- "Já acessei o Airbnb!" mais cedo: só 'staff' faz isso.
alter table public.guest_arrival_status
  drop constraint if exists guest_arrival_status_arrival_time_source_check;
alter table public.guest_arrival_status
  add constraint guest_arrival_status_arrival_time_source_check
  check (arrival_time_source is null or arrival_time_source in ('guest', 'staff', 'ai'));
comment on column public.guest_arrival_status.arrival_time_source is
  'Quem gravou o horário previsto: guest (hóspede, formulário/seletor do guia), staff (equipe, editor de Previsão) ou ai (IA a partir de mensagem do hóspede).';
