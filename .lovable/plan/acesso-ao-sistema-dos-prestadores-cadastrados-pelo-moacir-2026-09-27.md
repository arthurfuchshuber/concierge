# Acesso ao sistema dos prestadores cadastrados pelo Moacir

## Situação confirmada
- Entendido: o problema é o acesso dos **prestadores** (Erica, Sandra, Giovana) que o Moacir cadastrou, não o acesso dele. O plano Business dele está ativo.
- No banco, esses 3 prestadores estão salvos com e-mail, mas **nenhum acesso** foi criado para eles na conta do Moacir (zero pessoas liberadas). Por isso a chave aparece desligada ao reabrir.
- A causa exata ainda não foi confirmada: a criação do acesso falhou no servidor e o aviso de erro era escondido pelo "Cadastro atualizado".

## Passos
1. **Confirmar a causa**: repetir a liberação de acesso de um dos prestadores como se fosse o Moacir (entrando na prévia com a conta dele, após sua aprovação) e ler a mensagem real do servidor. Checar também se os e-mails dos prestadores já existem como login em outra conta, o que bloqueia a criação.
2. **Corrigir conforme a causa**. As mais prováveis são:
   - A checagem de permissão ("gerenciar equipe") recusando o titular da conta porque o Moacir não tem o registro de "titular" que as contas mais antigas têm. Nesse caso, reconhecer sempre o titular e criar esse registro para as contas que não o têm.
   - E-mail já cadastrado em outra conta: mostrar uma mensagem clara na hora de salvar, dizendo para usar outro e-mail.
3. **Liberar os 3 prestadores** depois da correção, refazendo o fluxo normal, ou pedindo ao Moacir que salve de novo.
4. **Conferir**: reabrir os detalhes do prestador e ver a chave ligada e o status "ativo". Confirmar também que o prestador entra com a senha provisória.

## Detalhes técnicos
- Fluxo: `createStakeholderProvisionalAccess` em `src/lib/stakeholder-access.functions.ts` (enforce `equipe.write` → plano → criar/atualizar usuário → upsert `account_members`).
- Suspeita principal: `enforce(userId, "equipe.write")` sem fallback de titular (as contas antigas têm uma linha de autovínculo em `account_members`; a do Moacir não tem). Validar com uma chamada real antes de alterar.
