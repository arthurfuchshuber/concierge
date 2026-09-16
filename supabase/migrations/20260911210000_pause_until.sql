-- A PAUSA DA IA PASSA A TER PRAZO (11/09/2026).
--
-- `ai_paused` é booleano e não expira. Quem liga, esquece: hoje há conversa
-- pausada desde 10/09 porque alguém clicou em "Assumir" e a vida seguiu. Como
-- a conversa pausada NUNCA volta para a IA — nem quando o hóspede escreve de
-- novo, nem por cron — o hóspede seguinte daquele imóvel fala com o silêncio.
--
-- A decisão de produto (11/09): falar direto com o hóspede pausa a IA por 30
-- minutos, renovados a cada nova mensagem do atendente. "Devolver agora"
-- continua existindo e vale a qualquer momento.
--
-- Por que uma coluna e não um cron que despausa: a expiração é lida no momento
-- em que a conversa é usada (lazy). Não existe janela em que o banco diz
-- "pausada" e o código acha que não — e não há relógio novo para esquecer de
-- agendar, que é justamente o erro que este projeto já cometeu três vezes.
--
-- `null` com `ai_paused = true` significa pausa sem prazo: é o estado das
-- conversas antigas, preservado de propósito para não devolver à IA, de uma
-- vez só, conversas que alguém possa estar conduzindo agora.

alter table public.property_chat_conversations
  add column if not exists paused_until timestamptz;

comment on column public.property_chat_conversations.paused_until is
  'Até quando a IA fica em silêncio nesta conversa. Passou desse horário, ela volta sozinha (expiração preguiçosa, lida no uso). NULL com ai_paused=true = pausa sem prazo (legado ou decisão explícita).';
