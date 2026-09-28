# Business sem limite de pessoas com acesso

## O que muda
- O plano Business não limita mais quantas pessoas podem ter acesso ao sistema. Isso inclui prestadores, proprietários e atendentes da equipe. Hoje o limite é de 2 pessoas além do titular, e foi esse limite que travou o Moacir.
- Os planos Starter e Pro continuam sem acesso para outras pessoas, como hoje.
- O limite de 50 guias do Business não muda.
- Textos atualizados:
  - Na página Equipe, a frase "Business: até 2 atendentes além do titular" passa a dizer "Business e Enterprise: ilimitado".
  - Na lista do plano Business (preços e assinatura), entra "Prestadores, proprietários e usuários ilimitados".

## Depois
Peça ao Moacir para liberar de novo o acesso das 3 prestadoras. Agora deve funcionar, desde que ele use o botão "Gerar" para criar a senha.

## Detalhes técnicos
- `src/lib/stakeholder-access.functions.ts` (~l.95-106): remover o bloco `if (plan.plan === "business") { count >= 2 }`.
- `src/lib/team.functions.ts` (~l.104-113): remover o mesmo bloco.
- `src/components/admin-pages/EquipePage.tsx` l.388: ajustar o texto.
- `src/lib/payments.shared.ts`: adicionar o item em `business.featureList`.
- Verificar se existe algum gatilho/função no banco que conte `account_members` por plano. Se existir, remover a trava do Business também. Essa verificação não foi possível agora porque o banco estava indisponível.
