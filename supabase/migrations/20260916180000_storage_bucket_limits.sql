-- Auditoria de segurança (16/09/2026): nenhum bucket tinha limite de tamanho.
-- Os limites abaixo ficam ACIMA do que o próprio app já aceita em cada tela
-- (e acima do maior arquivo existente em cada bucket), então não mudam nada
-- para o uso normal — só impedem que alguém use o storage como depósito.
--
--  bucket               app aceita                   maior hoje   limite
--  avatars              3 MB (Meu Perfil)            0,1 MB       5 MB
--  property-images      10 MB img / 60 MB vídeo      3,6 MB       60 MB
--  chat-attachments     20 MB (painel e hóspede)     2,7 MB       25 MB
--  guest-documents      12 MB (formulário)           —            12 MB
--  reservation-records  vídeos da operação           56 MB        500 MB
--
-- guest-documents só recebe arquivos do servidor (`guest-doc-upload`), que já
-- aceita apenas estes tipos; a lista aqui é a mesma.
update storage.buckets set file_size_limit = 5 * 1024 * 1024 where id = 'avatars';
update storage.buckets set file_size_limit = 60 * 1024 * 1024 where id = 'property-images';
update storage.buckets set file_size_limit = 25 * 1024 * 1024 where id = 'chat-attachments';
update storage.buckets
   set file_size_limit = 12 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
 where id = 'guest-documents';
update storage.buckets set file_size_limit = 500 * 1024 * 1024 where id = 'reservation-records';

-- Reverter:
-- update storage.buckets set file_size_limit = null, allowed_mime_types = null
--  where id in ('avatars','property-images','chat-attachments','guest-documents','reservation-records');
