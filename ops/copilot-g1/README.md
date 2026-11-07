# Gate G1: blindagem do Copiloto (ordem de aplicação)

O merge na `main` entra no ar automaticamente. Por isso a mudança de banco do G1 vem em duas partes.

| Passo | Quem | O quê | Conferência |
|---|---|---|---|
| 1 | Titular | Aplicar `supabase/migrations/20261107000000_copilot_g1a_actor_rpcs.sql` no editor SQL. A parte é aditiva: as RPCs antigas continuam funcionando. | `01-check-g1a.sql`, só leitura |
| 2 | Titular | Homologar e mergear o PR do G1. Aguardar o build novo no ar (`/api/public/version`). | Abrir uma conversa com sugestão na UI |
| 3 | Titular | Aplicar `g1b-revoke-legacy.sql`. | `02-check-g1b.sql`, só leitura |

**Rollback:**
- Antes do passo 3: reverter o PR. O código antigo usa as RPCs antigas, que continuam existindo.
- Depois do passo 3: reaplicar o PR. As RPCs antigas só voltam reaplicando a migration `20261105150000`, o que não é recomendado.

Nenhum arquivo daqui cria cron, chama serviço externo ou altera secrets ou flags.

## Situação (06/11/2026)

| Passo | Situação |
|---|---|
| 1. G1a | aplicada e conferida |
| 2. PR #5 | mergeado (`main` `9b1fa07f`); build `1794011207760` no ar |
| 3. G1b | aplicada e conferida |

A G1b está registrada em `supabase/migrations/20261107000100_copilot_g1b_revoke_legacy.sql`. O conteúdo é idêntico ao deste diretório, com um cabeçalho de registro. Não há nada a executar.
