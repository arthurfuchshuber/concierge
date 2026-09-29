# Admin SaaS com visão total, permissões sempre atualizadas e ícone "i" explicativo

## 1. Admin SaaS enxerga tudo de qualquer cliente
Na tela do print, os imóveis da Fakaki aparecem, mas reservas, contadores, guias, membros e cadastros vêm vazios. Hoje o modo "ver como cliente" troca só parte das consultas. A outra parte ainda busca os dados do próprio admin, ou esbarra nas regras de acesso.

O que será feito:
- **Descobrir a causa primeiro:** vou abrir a conta da Fakaki como admin e ver, tela por tela, quais consultas voltam vazias ou bloqueadas (Dashboard, Kanban, Limpeza, Registros, Guias, Stakeholders, Equipe/Permissões, IA, Atendimento, Administrativo). Também vou conferir no banco se essas reservas existem mesmo, para confirmar que o problema está na leitura e não nos dados.
- **Uma regra única no servidor:** quem tem o papel de admin SaaS, confirmado no servidor, tem acesso total de leitura à empresa escolhida. Todas as buscas passam a usar a empresa escolhida, e não a conta do admin.
- **Regras de acesso do banco:** onde faltar, entra uma liberação de leitura para admin, usando a verificação de papel que já existe. Clientes comuns continuam isolados como hoje.
- **Registro de auditoria** de cada acesso do admin à conta de um cliente.
- Nada muda para clientes, membros ou prestadores.

## 2. Permissões atualizadas na hora quando entra um recurso novo
- Hoje o catálogo de permissões depende de uma sincronização. Ele passa a ser montado direto do mapa de páginas e abas do sistema sempre que alguém consulta, com gravação automática no banco do que estiver faltando.
- A Central de Permissões e as decisões de acesso passam a ler esse catálogo sempre atualizado.
- Recurso novo nasce **bloqueado** para membros até o titular liberar. Titular e admin sempre têm acesso.
- Uma checagem automática falha se alguma página ou aba nova ficar sem permissão cadastrada.

## 3. Ícone "i" em cada permissão
- Ao lado de cada permissão, um ícone "i" abre uma janela que segue o padrão do sistema: desfoque do fundo, clique fora volta para a janela anterior e nada cortado na margem direita.
- A janela mostra tudo o que aquela permissão libera: páginas, abas, seções e ações (ver ou editar). Tudo é gerado do próprio mapa do sistema, então fica sempre completo, inclusive para recursos novos.

## Detalhes técnicos
- Modo admin: `useImpersonation` e o `activeOwnerId` passam a valer em todos os caminhos de leitura, com funções no servidor que confirmam `has_role(admin)` e aceitam o `ownerId` escolhido. `permission.enforce.server.ts` e `permission.resolve.server.ts` tratam o admin (`ADMIN_SAAS`) como leitor total do tenant escolhido.
- Nas tabelas afetadas, entram políticas SELECT extras com `has_role(auth.uid(),'admin')`, apenas onde faltarem, com grants conferidos.
- Catálogo: `permission.registry` / `permission.slugs` / `routeAreas` passam a ser a fonte única, com upsert idempotente dos nós em `permission_nodes`. Um teste compara o que o scanner encontra com o registro.
- Detalhe de cada nó: um resolvedor percorre os descendentes (PAGE → TAB → SECTION → RESOURCE) e as ações de cada um.
- Verificação: navegar como admin na conta da Fakaki, em celular e desktop, e rodar os testes de permissão.
