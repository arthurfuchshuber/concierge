# Memória do hóspede — ETAPA B (ativação operacional)

**Nada aqui é aplicado automaticamente.** Estes arquivos ficam fora de `supabase/migrations/` de propósito: a
estrutura (ETAPA A, `supabase/migrations/20261106230000_guest_ai_guest_profiles.sql`) não ativa nenhum
processamento. Cada passo abaixo exige autorização específica do titular.

Ordem:

1. ETAPA A aplicada e conferida (tabelas, funções e permissões).
2. Destino do cron comprovado (O2): saber se `project--c6a061b9-…lovable.app` serve a versão publicada ou o
   Preview. Se for a publicada, a rota `/api/public/cron/guest-memory` só existe depois de um Publish.
3. Secrets (o worker é fail-closed: sem eles, não roda):
   - `GUEST_MEMORY_WORKER=on` — único valor que habilita; ausente, vazio, `off` ou qualquer outro valor = desligado.
   - `GUEST_MEMORY_DAILY_COST_USD` — teto diário em dólares (0 < valor ≤ 10). Obrigatório: sem teto válido, não roda.
4. Agendamento: `01-schedule-guest-memory-cron.sql` (a cada hora, até 10 estadias por execução).
5. Carga retroativa: acontece pelo mesmo agendamento, 10 estadias por hora, das mais antigas para as mais novas.

Desligar: `02-unschedule-guest-memory-cron.sql` e/ou `GUEST_MEMORY_WORKER=off`.
