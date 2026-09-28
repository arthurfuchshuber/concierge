# Primeiro acesso de prestadores/proprietários/usuários: simplificar e corrigir

## O que está acontecendo (confirmado no código e nos registros)

1. **Print 1 – sumiu a senha provisória:** o campo só aparece quando a pessoa ainda não tem acesso nenhum. Se já existe um convite pendente ou acesso ativo, a seção mostra só a chave ligada, sem explicar nada e sem opção de gerar nova senha.
2. **Print 2 – "e-mail já pertence a outra conta":** o e-mail `pcgaldino@icloud.com` se cadastrou sozinho pela tela "Crie uma conta" às 19:58 (não confirmou o e-mail, não tem imóveis nem empresa). A trava de segurança tratou esse cadastro vazio como se fosse de outra empresa e bloqueou.
3. **Print 3 – login sem "Esqueci minha senha":** a tela de login não tem opção de recuperar senha.

## O que vou fazer

**Seção "Acesso ao sistema" (prestador e proprietário)**
- Mostrar sempre a situação atual em texto: "Sem acesso", "Convite enviado — aguardando" ou "Acesso ativo desde…".
- Em qualquer situação, oferecer o campo de senha provisória com botão **Gerar** e **Copiar**, com o texto "Definir nova senha provisória" quando já houver acesso/convite. Salvar troca a senha e o próximo login obriga criar uma senha pessoal.
- Após liberar, mostrar um cartão com e-mail + senha e botão "Copiar para WhatsApp".

**Trava de "outra conta" mais inteligente**
- Continua bloqueando e-mails que realmente pertencem a outra empresa (têm imóveis, assinatura ou fazem parte de outra equipe).
- Cadastros vazios (criados sozinhos, sem empresa, sem imóveis, sem assinatura) passam a ser aproveitados: o sistema confirma o e-mail, define a senha provisória e vincula à sua conta.
- Mensagem de bloqueio reescrita em linguagem clara.

**Tela de login**
- Link "Esqueci minha senha" abaixo do campo Senha, que envia e-mail de redefinição.
- Nova página de redefinir senha (onde o link do e-mail leva) para criar a nova senha e entrar.

## Detalhes técnicos
- `StakeholderFormDialog.tsx`: renderizar bloco de senha para status `none | pending | active`; chamar `createStakeholderProvisionalAccess` também quando `pending/active` e senha preenchida.
- `stakeholder-access.functions.ts`: antes do throw, checar se o usuário tem `properties`, `subscriptions` ou `account_members` em outro owner; se nenhum, tratar como órfão (`updateUserById` com `email_confirm: true`, senha e `must_change_password`).
- `auth.tsx`: modo "esqueci" com `resetPasswordForEmail(email, { redirectTo: origin + '/reset-password' })`; criar rota pública `src/routes/reset-password.tsx` com `updateUser({ password })` (sem current_password).
- Conferir em celular (390px) sem cortes à direita.
