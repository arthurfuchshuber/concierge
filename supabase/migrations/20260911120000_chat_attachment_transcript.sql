-- A IA PRECISA OUVIR OS ÁUDIOS DA CONVERSA (pedido explícito, 11/09/2026).
--
-- Até aqui, uma mensagem de áudio entrava em `property_chat_messages` com
-- `content` vazio. O histórico que vai para a IA lê exatamente `content` —
-- então todo áudio era, para ela, uma mensagem em branco. Na conversa da
-- Izabela (10/09) o atendente mandou SEIS áudios negociando a diária extra e a
-- IA seguiu sem saber de nada: o contexto tinha buracos onde estava a
-- informação mais importante.
--
-- A transcrição resolve isso sem mudar o formato da conversa: o áudio continua
-- sendo áudio para as pessoas, e vira TEXTO para a IA — e para quem preferir
-- ler a mandar tocar.

alter table public.property_chat_messages
  add column if not exists attachment_transcript text;

comment on column public.property_chat_messages.attachment_transcript is
  'Transcrição do áudio/vídeo do anexo. É por ela que a IA "ouve" a conversa: entra no histórico como texto.';
