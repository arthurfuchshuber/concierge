-- UM REGISTRO É UMA SITUAÇÃO, NÃO UM ARQUIVO (pedido explícito, 10/09/2026).
--
-- "quando o prestador for registrar algo e quiser mandar mais de um
--  arquivo/foto/video/audio, deve-se possibilitar a ele manter como sendo a
--  'mesma situação'".
--
-- A tabela continua com UMA LINHA POR MÍDIA — é o que o storage, a exclusão e
-- as URLs assinadas já sabem fazer. O que muda é que as linhas da mesma
-- situação passam a compartilhar `group_id`. A linha PRINCIPAL do grupo é
-- aquela em que `id = group_id`: é ela que guarda o texto (título + descrição)
-- e o vínculo com a pendência. As demais são mídia adicional.
--
-- Registros antigos viram grupos de um só: `group_id = id`. Nada é perdido e a
-- leitura nova (`coalesce(group_id, id)`) funciona mesmo antes do backfill.

alter table public.reservation_records
  add column if not exists group_id uuid;

update public.reservation_records
   set group_id = id
 where group_id is null;

create index if not exists reservation_records_group_idx
  on public.reservation_records (group_id);

comment on column public.reservation_records.group_id is
  'Situação a que a mídia pertence. A linha com id = group_id é a principal: guarda título/descrição (body) e a pendência.';
