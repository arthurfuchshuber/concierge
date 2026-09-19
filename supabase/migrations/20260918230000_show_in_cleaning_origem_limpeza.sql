-- "APARECE NA LIMPEZA" PARA O QUE A PRÓPRIA LIMPEZA ABRIU (18/09/2026)
--
-- Pedido explícito: "tudo que a própria limpeza abre deve ser marcado como
-- 'aparecer na limpeza' automaticamente para que ela faça o acompanhamento;
-- enquanto isso, usuários internos devem continuar conseguindo selecionar ou
-- não essa opção, e quando não selecionada não deve aparecer no checklist."
--
-- O QUE ESTAVA ACONTECENDO: a regra antiga olhava só a CATEGORIA — e só
-- Manutenção (e Objeto Esquecido) nascia visível para a limpeza. Um dano
-- registrado pela própria faxineira, na coluna de Limpeza, nascia oculto dela.
-- Resultado medido no banco: das 8 pendências abertas da Casa Charmosa, 7 eram
-- "inspection" (dano) com show_in_cleaning = false, e o checklist mostrava 1.
--
-- A regra nova vale dali em diante (ver `createTaskFromRecord` em
-- `src/lib/reservation-records.functions.ts`). Este backfill é só para as que
-- JÁ existiam, autorizado pelo cliente.
--
-- ESCOPO, de propósito estreito:
--   · só pendências que vieram de um REGISTRO cujo card_mode é 'cleaning'
--     (isto é, nasceram na coluna de Limpeza) — a origem é o que a regra usa;
--   · só as que ainda estão EM ABERTO;
--   · só as que estão com o campo desligado.
-- Nada de UPDATE em massa na tabela: quem foi marcado à mão por um usuário
-- interno em outro contexto não é tocado.

update public.tasks t
set show_in_cleaning = true
where t.status = 'pending'
  and t.show_in_cleaning = false
  and exists (
    select 1
    from public.reservation_records r
    where r.task_id = t.id
      and r.card_mode = 'cleaning'
  );
