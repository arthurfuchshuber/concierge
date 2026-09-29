# Auditoria de visibilidade: usuários, proprietários e prestadores

## Objetivo
Garantir que cada pessoa com acesso veja **somente** o que foi liberado para ela. Um prestador só pode ver as próprias limpezas e tarefas, nos imóveis dele. Um proprietário só pode ver os imóveis dele. Um membro da equipe só vê as áreas e os imóveis que foram liberados. Nada pode passar de uma conta para outra.

## Situação
O Moacir relatou que os prestadores dele veem tudo, de todos. A causa ainda não foi confirmada. Por isso, o primeiro passo é reproduzir o problema com um prestador real da conta dele.

## Passos
1. **Reproduzir.** Entrar na prévia como um prestador do Moacir (por exemplo, Erica). Isso só acontece depois da sua aprovação no cartão de acesso. Em seguida, anotar tudo o que ele consegue ver: menus, páginas, abas, imóveis, reservas, hóspedes, registros, limpezas, valores, outros prestadores, proprietários e conversas.
2. **Mapear por perfil.** Montar uma tabela "o que deveria ver × o que vê hoje" para 4 perfis:
   - titular;
   - membro da equipe com acesso limitado;
   - proprietário;
   - prestador.
3. **Encontrar os vazamentos em 3 camadas:**
   - **Telas:** menus e abas que aparecem sem a permissão correspondente.
   - **Servidor:** funções que devolvem a conta inteira sem filtrar pelos imóveis e pelas limpezas da pessoa (dashboard, operação, limpeza, registros, kanban, pessoas, guias, atendimento, assistente interno).
   - **Banco de dados:** regras de acesso que liberam qualquer membro ativo a ler tudo da conta, sem considerar o perfil nem os imóveis vinculados.
4. **Corrigir, fechando a categoria inteira e não só um caso:**
   - Filtro obrigatório por perfil e por imóvel vinculado em todas as leituras do servidor.
   - Regras do banco restritas: prestador lê só as linhas dele e dos imóveis atribuídos, e proprietário só os imóveis dele.
   - Menus e abas escondidos quando a pessoa não tem permissão.
   - Valores e dados de hóspedes ocultos para quem não pode vê-los.
5. **Conferir.** Repetir o passo 1 com os 4 perfis, no celular e no computador. Criar testes automáticos que falham caso um prestador ou proprietário volte a enxergar dados de fora.
6. **Relatório.** Entregar uma lista simples do que cada perfil vê depois da correção, para você validar com o Moacir.

## Detalhes técnicos
- Revisar `resolveSubjectSnapshot` / `permission.enforce.server.ts`, incluindo `allProperties`, que hoje vem como padrão `true` para membros novos. Confirmar se prestadores estão caindo nesse padrão.
- Revisar `resolveAuthorizedAccountOwnerId`: um membro ativo recebe a conta do titular. Verificar quais funções usam a conta resolvida sem aplicar escopo de papel ou imóvel (`dashboard.functions.ts`, `stakeholders.functions.ts`, `cleaning-*.functions.ts`, registros, assistente).
- Revisar as políticas de RLS baseadas em `is_account_member` / `can_access_stakeholder_data` em `properties`, `guest_arrival_status`, `reservation_records`, `service_providers`, `property_owners`, `tasks` e `property_chat_*`, e passar a usar `member_can_see_property` e o vínculo do prestador.
- Ligar o registro do prestador ou proprietário ao usuário de acesso (via `account_members` / e-mail) para derivar o escopo no servidor. Nunca confiar no navegador.
