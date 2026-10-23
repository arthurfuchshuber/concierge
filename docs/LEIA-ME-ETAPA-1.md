# ConciergeIA — Etapa 1: "Concluir pendência" com prestação de contas (23/10/2026)

Implementação fiel dos mockups 0i (janela compacta), 0j (diferença de valores) e 0k (regras de "quem deve pagar").
Base: commit ef30d11e (HEAD do Lovable em 23/10/2026; sem novas edições na hora do empacote).

> **Este ZIP contém só os arquivos alterados/criados** (o diff por inteiro do repositório excede o limite de resposta do conector do Lovable nesta sessão, então não consegui remontar a árvore completa). Copie cada arquivo para o mesmo caminho no projeto.

## Banco (JÁ APLICADO no Supabase do projeto; o .sql é o registro versionado)
- `supabase/migrations/20261023160000_task_settlement_difference.sql`
  - `tasks`: + `amount_due_cents` (valor a pagar), `resolution_received` (já recebeu), `difference_cents` (com sinal), `difference_to`, `difference_to_id`.
  - `task_completions` (ocorrências de pendência recorrente do checklist da limpeza): as mesmas colunas + `cost_payer(_id)`, `paid_by(_id)`, `amount_paid_cents`, para a despesa dessas ocorrências também ser contabilizada.
  - Só colunas aditivas e anuláveis; nada existente mudou.
  - (`cost_payer`, `paid_by`, `amount_paid_cents` em `tasks` já existiam.)

## Código
| Arquivo | O que mudou |
|---|---|
| `src/lib/tasks-types.ts` | `TaskParty` (company/owner/provider/guest) e rótulos; `TaskRow` ganhou os campos de despesa (valor a pagar, recebido, quem deve pagar, quem pagou, valor pago, diferença/destino) e o contato do proprietário. |
| `src/lib/tasks.functions.ts` | `listTaskLinkOptions` devolve `companyName` (nome fantasia da conta = "Anfitrião Sigma"). `listTasks` lê/entrega todos os campos novos. `setTaskStatus` e `toggleCleaningCompletion` gravam a prestação de contas e **impõem as regras do 0k no servidor**: proprietário = dono do imóvel (não se troca), hóspede só se há reserva/estadia, anfitrião sem id, prestador precisa existir; a diferença tem que bater com (valor a pagar − valor da resolução). Reabrir limpa tudo. "Desfazer" (`restoreTask`, `restoreTaskCompletion`) restaura os campos novos. |
| `src/components/dashboard/TaskResolveDialog.tsx` (novo) | A janela 0i + a janela de diferença 0j + o seletor 0k. |
| `src/components/dashboard/OperationWorkspace.tsx` | A função antiga `TaskResolveDialog` saiu; o nome continua exportado daqui (re-export do arquivo novo). O gatilho do checklist da limpeza passa o nome da empresa/hóspede e repassa toda a prestação de contas ao servidor. Nada mais foi tocado. |
| `src/components/dashboard/pendencias.tsx` | Mesmo para o gatilho de Pendências (Registros). |

## Comportamento (conforme os mockups)
- Cabeçalho: imóvel, "Proprietário(a): nome" + ícone de mensagem. Campo "Situação" somente leitura.
- Quem resolveu (lista de prestadores, busca por nome/cidade/tipo) + Valor da resolução; botão Não recebeu (pré) | Já recebeu.
- Quem deve pagar + Valor a pagar (nasce com o total e acompanha o valor da resolução até ser editado); Proprietário/Hóspede aparecem como campo TRAVADO; Anfitrião = nome da empresa (1 linha, reticências); Prestador = "Qual prestador?" com a lista. Botão A pagar (pré) | Já foi pago (aparecem Quem pagou + Valor pago).
- Comprovação: texto + foto/vídeo/galeria/arquivo/microfone na mesma caixa.
- Se valor a pagar ≠ valor da resolução: janela "Há uma diferença de valores" (a menos/a mais) e escolha do destino (sem "ninguém"). Se o destino for Prestador e nenhum foi escolhido antes, pergunta "Qual prestador?".
- Tudo continua opcional; "Desfazer" por 5 s continua funcionando.

## Verificação
- `tsc --noEmit` limpo nos arquivos novos/alterados **contra stubs** (o projeto completo não estava disponível para compilar).
- Renderização de teste (Playwright, tema escuro, 640px e 390px) conferida contra os mockups.
- NÃO rodado: `vite build`, `vitest`, teste de ponta a ponta no app. Recomendo abrir uma pendência no preview e concluir uma vez com e sem diferença.

## Ainda NÃO feito (próximas etapas)
Aba Serviços (janela "+", situações, filtro, cartões/gráficos dinâmicos) e a contabilização dos números nos perfis (prestador, proprietário…) — estes dependem de mockups dos perfis, que ainda não existem. Os dados já ficam gravados, vinculados a cada perfil.
