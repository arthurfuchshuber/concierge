-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · Gate A · SONDA DA INTERFACE SQL (somente leitura; nada é gravado).
-- Rodar NA MESMA interface e do MESMO jeito que o gateA-bundle.sql será executado (texto inteiro numa única chamada),
-- imediatamente antes dele. Prova que a interface executa vários comandos numa ÚNICA transação e que `SET LOCAL`
-- vale para os comandos seguintes — as duas condições de que o bundle depende.
-- Esperado: uma linha com mesma_transacao = true, set_local_efetivo = true, papel = postgres, mensagem_unica = true e
-- texto_integral_visivel = true (o servidor enxerga a mensagem INTEIRA em `current_query()`: é disso que depende a
-- conferência de SHA-256 do conteúdo feita pela guarda do bundle).
-- Qualquer outro resultado (ou erro, ou várias linhas de resultado sem a última) ⇒ NÃO executar o bundle nessa interface.
-- `set_config(..., true)` e `SET LOCAL` só valem dentro da própria transação e desaparecem no fim dela.
select set_config('guest_ai.gate_a_probe', 'on', true);
set local lock_timeout = '3s';
select current_setting('guest_ai.gate_a_probe', true) = 'on' as mesma_transacao,
       current_setting('lock_timeout') = '3s' as set_local_efetivo,
       current_user::text as papel,
       statement_timestamp() = transaction_timestamp() as mensagem_unica,
       -- marcadores montados por concatenação: só casam com os comandos ANTERIORES da mesma mensagem
       strpos(current_query(), 'select set_' || 'config(''guest_ai.gate_a_probe''') > 0
         and strpos(current_query(), 'set local lock_' || 'timeout = ''3s'';') > 0 as texto_integral_visivel;
