-- "Resolver pendência" — dois pedidos explícitos, 24/09/2026 (com prints
-- marcados), já aplicados direto no banco:
--
--   1. "Hóspede" passa a ser uma opção de RESPONSÁVEL PELA DESPESA (antes só
--      empresa/proprietário/prestador podiam ser cobrados por um custo).
--   2. Nova pergunta, separada da anterior: QUEM PAGOU de fato (pode ser
--      diferente de quem é o responsável — ex.: a empresa adianta o
--      pagamento e depois cobra do proprietário) + o VALOR PAGO (pode ser
--      diferente do valor total da resolução — ex.: pagamento parcial).
--
-- "cost_payer"/"cost_payer_id" continuam sendo o RESPONSÁVEL (quem a conta
-- vai cobrar); "paid_by"/"paid_by_id"/"amount_paid_cents" são novos, sobre
-- quem de fato desembolsou e quanto.

alter table public.tasks drop constraint if exists tasks_cost_payer_check;
alter table public.tasks
  add constraint tasks_cost_payer_check
    check (cost_payer is null or cost_payer in ('company', 'owner', 'provider', 'guest'));

alter table public.tasks
  add column if not exists paid_by text
    check (paid_by is null or paid_by in ('company', 'owner', 'provider', 'guest')),
  add column if not exists paid_by_id uuid,
  add column if not exists amount_paid_cents integer;

comment on column public.tasks.cost_payer is
  'Responsável pela despesa: quem a conta será cobrada (company/owner/provider/guest). Não é quem executou nem quem pagou de fato.';
comment on column public.tasks.paid_by is
  'Quem pagou de fato (company/owner/provider/guest) — pode divergir do responsável (cost_payer): a empresa pode adiantar e cobrar depois, por exemplo.';
comment on column public.tasks.paid_by_id is
  'Id do proprietário (property_owners) ou do prestador (service_providers) quando paid_by não é company nem guest.';
comment on column public.tasks.amount_paid_cents is
  'Valor efetivamente pago (pode ser menor que amount_spent_cents — a "Valor da Resolução" — em caso de pagamento parcial).';
