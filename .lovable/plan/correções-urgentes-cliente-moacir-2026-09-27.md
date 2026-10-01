# Correções urgentes (cliente Moacir)

## 1. Lista de proprietários aparece atrás da janela "Transferir proprietário"
Causa provável: na última rodada a lista suspensa (Select) passou a entrar na pilha global de janelas, mas o nível de sobreposição é aplicado no elemento interno, enquanto o Radix posiciona a lista num invólucro externo com nível próprio — a janela de transferência (nível mais alto) fica por cima.
- Aplicar o nível da pilha no invólucro posicionado do Select (e conferir o mesmo padrão em Dropdown, Popover, Menubar e ContextMenu, que foram alterados juntos).
- Garantir que qualquer lista aberta dentro de uma janela fique sempre acima dela e que o clique fora feche só a lista.

## 2. Erro "Não foi possível concluir esta ação" na 1ª tentativa de transferir
- Primeiro passo: ler os registros do servidor da função de transferência para confirmar a causa real (diagnóstico ainda não confirmado).
- Hipóteses a verificar: clique registrado enquanto a lista estava "atrás" (valor ainda não confirmado/sessão não anexada), ou falha transitória na primeira chamada (autenticação/renovação de sessão).
- Corrigir a causa confirmada; desabilitar "Confirmar transferência" até haver proprietário válido selecionado e mostrar a mensagem real do erro quando for de regra de negócio.

## 3. Acesso do prestador salvo mas aparece desligado ao reabrir
Fluxo atual: ao salvar, cria o login com senha provisória e o vínculo de membro; ao reabrir, a chave é ligada conforme uma consulta que procura o usuário pelo e-mail e o vínculo na conta de quem está logado.
- Verificar no banco se o vínculo de membro do prestador foi realmente criado (e em qual conta).
- Pontos suspeitos a checar e corrigir:
  - busca do usuário por e-mail pode não encontrá-lo (listagem paginada), fazendo a tela achar que não há acesso;
  - se quem está logado é membro de equipe (não o titular), o vínculo é gravado/consultado na conta errada — usar sempre a conta titular ativa;
  - erro silencioso (plano/limite) exibido só como aviso rápido após "Cadastro salvo".
- Após salvar, atualizar o estado da chave imediatamente com o resultado retornado (sem depender só da nova consulta).

## Verificação
- Testar no navegador: abrir Transferir, lista visível por cima, transferir na 1ª tentativa sem erro.
- Criar acesso para um prestador de teste, fechar e reabrir detalhes: chave ligada e status "ativo".

## Detalhes técnicos
- Arquivos: `src/components/ui/select.tsx` (e demais primitivos alterados), `src/routes/_authenticated/admin.properties.$id.tsx` (handleConfirmTransfer), `src/lib/properties.functions.ts` (transferPropertyOwner), `src/lib/stakeholder-access.functions.ts` (getStakeholderAccess / createStakeholderProvisionalAccess, findUserIdByEmail), `src/components/stakeholders/StakeholderFormDialog.tsx`.
- Resolver owner efetivo via conta ativa (membro → owner_id) em ambas as funções de acesso; busca por e-mail direta em vez de listagem paginada.
