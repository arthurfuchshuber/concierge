-- "Registros da reserva" (pedido explícito, 07/09/2026): uma linha do tempo
-- ÚNICA por reserva — foto, vídeo, áudio, arquivo ou descrição de
-- situação/problema/auditoria — acessível a partir do card em QUALQUER
-- status (Check-in, Estadia, Checkout, Fila de Limpeza, Concluídos, Não
-- Compareceu). Tudo cai na MESMA reserva, não importa em qual card/etapa foi
-- registrado — por isso a chave é `log_id`/`reservation_id` (a mesma
-- identidade estável já usada em toda a esteira — advanceArrival, markNoShow,
-- auto-checkout — nunca um id por status/card).
--
-- IDEMPOTENTE de propósito: este SQL foi aplicado direto no banco em
-- 07/09/2026 e também vive aqui como migração. Rodar de novo (replay de
-- migrações, ambiente novo) não pode quebrar nem duplicar nada.
CREATE TABLE IF NOT EXISTS public.reservation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  -- Pelo menos um dos dois abaixo é preenchido — mesmo padrão de
  -- guest_arrival_status (log de formulário do hóspede E/OU reserva do iCal).
  log_id uuid NULL,
  reservation_id uuid NULL,
  kind text NOT NULL CHECK (kind IN ('photo','video','audio','file','note')),
  storage_path text NULL, -- null quando kind='note' sem anexo
  mime text NULL,
  size_bytes bigint NULL,
  duration_ms integer NULL,
  file_name text NULL,
  body text NULL, -- descrição/legenda (obrigatória quando kind='note')
  -- Em qual coluna/status do Kanban o registro nasceu — só para a etiqueta
  -- exibida na linha do tempo (ex.: "Fila de Limpeza"); nunca filtra a
  -- listagem, que é sempre a reserva inteira.
  card_mode text NOT NULL CHECK (card_mode IN ('checkin','checkout','stay','cleaning','done','no_show')),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_records_target_chk CHECK (log_id IS NOT NULL OR reservation_id IS NOT NULL),
  CONSTRAINT reservation_records_content_chk CHECK (storage_path IS NOT NULL OR body IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS reservation_records_log_id_idx ON public.reservation_records (log_id) WHERE log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservation_records_reservation_id_idx ON public.reservation_records (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservation_records_property_id_idx ON public.reservation_records (property_id);

ALTER TABLE public.reservation_records ENABLE ROW LEVEL SECURITY;

-- Mesmo controle de acesso já usado no resto do Kanban/operação
-- (user_can_access_property) — pedido explícito: só quem já opera essa
-- reserva (equipe/conta responsável pelo imóvel), sem escopo novo.
DROP POLICY IF EXISTS "Staff can view reservation records" ON public.reservation_records;
CREATE POLICY "Staff can view reservation records"
  ON public.reservation_records FOR SELECT
  TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id));

DROP POLICY IF EXISTS "Staff can insert reservation records" ON public.reservation_records;
CREATE POLICY "Staff can insert reservation records"
  ON public.reservation_records FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_access_property(auth.uid(), property_id));

DROP POLICY IF EXISTS "Staff can delete reservation records" ON public.reservation_records;
CREATE POLICY "Staff can delete reservation records"
  ON public.reservation_records FOR DELETE
  TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id));

-- Bucket de storage privado + políticas — mesmíssimo padrão do bucket
-- "chat-attachments" (ver 20260715233105_...). Caminho de cada objeto:
-- <property_id>/<log_id-ou-reservation_id>/<uuid>.<ext>
-- Sem file_size_limit aqui (pedido explícito: "sem limite") — só o teto
-- global do projeto Supabase continua valendo, que esta migração não
-- controla.
INSERT INTO storage.buckets (id, name, public)
VALUES ('reservation-records', 'reservation-records', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Staff can read reservation record files" ON storage.objects;
CREATE POLICY "Staff can read reservation record files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'reservation-records'
    AND public.user_can_access_property(auth.uid(), (regexp_split_to_array(name, '/'))[1]::uuid)
  );

DROP POLICY IF EXISTS "Staff can upload reservation record files" ON storage.objects;
CREATE POLICY "Staff can upload reservation record files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'reservation-records'
    AND public.user_can_access_property(auth.uid(), (regexp_split_to_array(name, '/'))[1]::uuid)
  );

DROP POLICY IF EXISTS "Staff can delete reservation record files" ON storage.objects;
CREATE POLICY "Staff can delete reservation record files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'reservation-records'
    AND public.user_can_access_property(auth.uid(), (regexp_split_to_array(name, '/'))[1]::uuid)
  );
