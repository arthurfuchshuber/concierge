# Monitoramento das ações operacionais da IA (Gate G2)

Todas as consultas desta pasta são **somente leitura** (`SELECT`). Rodar no editor SQL do Lovable Cloud.

| Arquivo | Para quê |
|---|---|
| `01-resumo.sql` | Total por ação, desfecho e motivo de recusa (últimos 14 dias), com imóveis, reservas e casos de madrugada |
| `02-volume-diario.sql` | Por dia, modo e ação: quantas aplicadas, observadas, recusadas e reservadas (30 dias) |
| `03-detalhe-recente.sql` | Últimos 100 registros, caso a caso: card antes, previsão proposta, ids da conversa e da mensagem de evidência |
| `04-conferencia-g2b.sql` | Qualidade: ações aplicadas (`live`) que a equipe desfez ou corrigiu, e ações observadas (`shadow`) comparadas com o que aconteceu no card; late checkout mantido ou ajustado pela equipe |
| `05-escritas-interrompidas.sql` | Ações reservadas (`claimed`) há mais de 5 minutos sem desfecho: conferir o card manualmente |

**Como ler:**
- **Ações:** `checkin_done`, `checkout_done`, `early_departure` (saída antecipada, card puxado para hoje), `eta_checkin`, `eta_checkout` e `late_checkout` (late checkout concedido por atendente humano no chat, gravado em nome dele; a evidência é a mensagem da equipe).
- **Modos:** `live` (a IA move o card de verdade) e `shadow` (só registra).
- **Desfechos:** `applied` (card movido, com foto antes e depois), `refused` (recusou, com o motivo em `code`), `claimed` (reservada, à espera do desfecho) e `would_apply` (no `shadow`, a IA faria).
- **Motivos frequentes:**
  - `team_in_command`: equipe no comando;
  - `open_case`: chamado aberto;
  - `not_in_stay`: antes do horário oficial;
  - `eta_out_of_bounds`: fora dos limites oficiais;
  - `lexical_*`: barreira contra falso positivo;
  - `quote_not_in_message`: trecho citado não está na mensagem;
  - `panel_refused`: as travas do painel recusaram (ex.: estadia anterior ainda aberta);
  - `staff_prediction_race`: a equipe gravou uma previsão no mesmo instante;
  - `staff_grant_not_explicit` / `staff_grant_ambiguous`: a mensagem da equipe não concedia o horário de forma expressa e única;
  - `staff_not_authorized`: o atendente que escreveu não tem permissão de autorizar late checkout (o banco recusou);
  - `staff_author_unknown`: a mensagem não tem atendente humano identificado.
- **"Desfeita pela equipe" na consulta 04 é o sinal de possível baixa indevida.** Revise caso a caso pela conversa (ids na consulta 03).

**Meta de qualidade (D-G2-3):** precisão de 99% ou mais e nenhuma baixa indevida. Em caso de problema, `GUEST_AI_OPS_MODE=shadow` (ou sem valor) para a ação real na hora, sem deploy.

Nada aqui cria cron, altera dados, secrets ou flags.
