# Monitoramento das ações operacionais da IA (Gates G2a e G2b)

Todas as consultas desta pasta são **somente leitura** (`SELECT`). Rodar no editor SQL do Lovable Cloud.

| Arquivo | Para quê |
|---|---|
| `01-resumo.sql` | Total por ação, desfecho e motivo de recusa (últimos 14 dias), com imóveis, reservas e casos de madrugada |
| `02-volume-diario.sql` | Quantos "faria" e "recusou" por dia e por ação (30 dias) |
| `03-detalhe-recente.sql` | Últimos 100 registros, caso a caso: card antes, previsão proposta, ids da conversa e da mensagem de evidência |
| `04-conferencia-g2b.sql` | Prévia da precisão: cada "faria" comparado com o estado atual do card (conclusão feita pela equipe, pelo hóspede ou pelo auto-checkout; previsão igual à proposta) |

**Como ler:**
- **Ações:** `checkin_done`, `checkout_done`, `early_departure` (saída antecipada, card puxado para hoje), `eta_checkin` e `eta_checkout`.
- **Desfechos:** `would_apply` (a IA faria) e `refused` (recusou, com o motivo em `code`).
- **Motivos frequentes:**
  - `team_in_command`: equipe no comando;
  - `open_case`: chamado aberto;
  - `not_in_stay`: antes do horário oficial;
  - `eta_out_of_bounds`: fora dos limites oficiais;
  - `lexical_*`: barreira contra falso positivo;
  - `quote_not_in_message`: trecho citado não está na mensagem.
- **"Pendente" na consulta 04 não é falso positivo automaticamente.** Revise caso a caso pela conversa (ids na consulta 03). Pode ser só a equipe que ainda não moveu o card.

**Critério para sair do modo de observação (D-G2-3):** pelo menos 30 casos por ação, precisão de 99% ou mais e nenhuma baixa indevida.

Nada aqui cria cron, altera dados, secrets ou flags.
