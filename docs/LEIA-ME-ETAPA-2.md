# Etapa 2 — Aba Serviços (Dashboard › Financeiro)

Aplicar por cima do projeto (mesmos caminhos). Base: commit ef30d11e. A migração JÁ foi aplicada no banco; o arquivo está aqui para o repositório.

## Arquivos
- supabase/migrations/20261023180000_service_situations.sql — tabela service_situations (RLS por conta), tasks.situation, reservation_records.situation_id, backfill (dano 13, limpeza 1, manutenção 10, outro 6).
- src/lib/service-situations.ts — situações do sistema, Title Case, limites (nome 60, detalhamento 300).
- src/lib/service-situations.functions.ts — listar/criar/editar/excluir (exclusão lógica) e getServiceExtras (respeita vínculo: prestador só vê o que resolveu).
- src/lib/reservation-records.functions.ts — situação gravada na tarefa; "Outro"/próprias criam tarefa (OTHER_SERVICE_RULE) só quando a situação é explícita. "Registros +" segue igual.
- src/lib/tasks.functions.ts — createTask grava tasks.situation.
- src/lib/offline/situation-outbox.ts — armarSituacao/desarmarSituacao: a escolha viaja dentro do trabalho guardado no aparelho (sobrevive a queda de rede).
- src/components/dashboard/ServiceSituationUi.tsx — janela "Sobre o que é a situação?", formulário "Nova situação", filtro, botão "+", trilha de novo serviço.
- src/components/dashboard/ManualCleaningButton.tsx — painel controlado + ManualCleaningHost.
- src/components/dashboard/CleaningDayDetail.tsx — extras no detalhe por dia/custo.
- src/components/dashboard/OperationWorkspace.tsx — 4 cartões, filtro de situação que atualiza cartões/gráficos/Eficiência/Top 5/títulos, aba "Serviços".

## Decisões
- Filtro padrão: Todas. Só aparecem situações com dados no período e visíveis ao perfil.
- Serviços extras = tarefas concluídas não-limpeza; custo = amount_spent_cents. Sem previsão para extras.
- Exclusão de situação própria é lógica (histórico mantém o nome).

## Não verificado
vite build, vitest, execução ponta a ponta no app real e tsc da árvore completa (só harness com stubs + render Playwright das janelas). Este ZIP contém só arquivos novos/alterados.
