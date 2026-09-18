DROP POLICY IF EXISTS "Staff can update reservation records" ON public.reservation_records;
CREATE POLICY "Staff can update reservation records"
ON public.reservation_records
FOR UPDATE
TO authenticated
USING (user_can_access_property(auth.uid(), property_id))
<<<<<<< HEAD
WITH CHECK (user_can_access_property(auth.uid(), property_id));
=======
WITH CHECK (user_can_access_property(auth.uid(), property_id));
>>>>>>> 1946830e3fe521295bdc28efea0aecb3644a100c
