-- EDITAR REGISTRO NÃO GRAVAVA (achado em 17/09/2026, ao ligar o "Desfazer").
--
-- `reservation_records` tinha políticas de SELECT, INSERT e DELETE, mas não
-- de UPDATE. Com RLS ligado, o `update` de `updateRecordText` ("editar título
-- e descrição", pedido de 10/09/2026) passava sem erro e não mudava nenhuma
-- linha: a tela dizia "Registro atualizado" e o texto continuava o antigo.
-- Mesma regra das outras três: quem acessa o imóvel.
DROP POLICY IF EXISTS "Staff can update reservation records" ON public.reservation_records;
CREATE POLICY "Staff can update reservation records"
  ON public.reservation_records
  FOR UPDATE
  TO authenticated
  USING (user_can_access_property(auth.uid(), property_id))
  WITH CHECK (user_can_access_property(auth.uid(), property_id));
