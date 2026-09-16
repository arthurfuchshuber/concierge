-- ============================================================
-- Tarefas / Pendências vinculadas a imóveis e/ou proprietários
-- (botão "PENDÊNCIAS" no Kanban + checklist no card de Limpeza).
--
-- Toda pendência é obrigatoriamente vinculada a um imóvel e/ou a um
-- proprietário (pedido explícito — nunca solta).
--
-- Duas formas de vínculo com uma estadia:
--   - "Pontual": log_id/reservation_id preenchidos na própria linha — a
--     pendência é sobre UMA estadia específica (ex.: "verificar chuveiro
--     antes do check-in da Mylenna") e some quando aquela estadia acaba.
--   - "Recorrente": sem log_id/reservation_id — pendência permanente do
--     imóvel/proprietário (ex.: "trocar botijão de gás"). Marcar como feita
--     numa limpeza específica não fecha a pendência pra sempre: fica
--     registrado em task_completions, e ela "volta" pendente na próxima
--     limpeza (pedido explícito).
--
-- Isolamento entre contas: uma pendência pode carregar até 4 vínculos
-- diferentes (imóvel, proprietário, log de acesso, reserva). Cada um deles
-- é validado INDIVIDUALMENTE contra a conta autenticada — não basta UM dos
-- vínculos ser válido pra linha inteira passar (isso permitiria "pendurar"
-- um vínculo de outro tenant/imóvel/proprietário numa pendência que também
-- tem um vínculo válido). Ver função task_link_visible() abaixo.
-- ============================================================

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  owner_contact_id uuid REFERENCES public.property_owners(id) ON DELETE CASCADE,
  log_id uuid REFERENCES public.guide_access_logs(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.property_reservations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('maintenance', 'financial', 'guest_request', 'purchase', 'inspection', 'cleaning', 'other')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date date,
  -- Quando true, a pendência aparece como item de checklist no card de
  -- Limpeza do Kanban (pedido explícito) — além de listada no dialog
  -- "PENDÊNCIAS".
  show_in_cleaning boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'canceled')),
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_link_required CHECK (property_id IS NOT NULL OR owner_contact_id IS NOT NULL)
);

CREATE INDEX tasks_account_idx ON public.tasks(account_owner_id);
CREATE INDEX tasks_property_idx ON public.tasks(property_id);
CREATE INDEX tasks_owner_contact_idx ON public.tasks(owner_contact_id);
CREATE INDEX tasks_status_idx ON public.tasks(status);
CREATE INDEX tasks_log_idx ON public.tasks(log_id);
CREATE INDEX tasks_reservation_idx ON public.tasks(reservation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
REVOKE ALL ON public.tasks FROM anon;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Função de autorização única — TODOS os vínculos preenchidos numa
-- pendência precisam, cada um, pertencer a uma conta que _user_id
-- administra ou integra. NULL nunca "passa por padrão": um vínculo só é
-- ignorado na checagem quando ele mesmo é NULL na linha.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.task_link_visible(
  _user_id uuid,
  _property_id uuid,
  _owner_contact_id uuid,
  _log_id uuid,
  _reservation_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- mesma regra do "vínculo obrigatório" da tabela, reforçada aqui pra
    -- nunca depender só da CHECK constraint.
    (_property_id IS NOT NULL OR _owner_contact_id IS NOT NULL)
    AND (_property_id IS NULL OR public.user_can_access_property(_user_id, _property_id))
    AND (_owner_contact_id IS NULL OR EXISTS (
      SELECT 1 FROM public.property_owners po
      WHERE po.id = _owner_contact_id
        AND (po.account_owner_id = _user_id OR public.is_account_member(_user_id, po.account_owner_id))
    ))
    -- log_id/reservation_id têm imóvel próprio (podem, em tese, divergir do
    -- property_id gravado na pendência) — cada um valida seu PRÓPRIO imóvel.
    AND (_log_id IS NULL OR EXISTS (
      SELECT 1 FROM public.guide_access_logs l
      WHERE l.id = _log_id AND public.user_can_access_property(_user_id, l.property_id)
    ))
    AND (_reservation_id IS NULL OR EXISTS (
      SELECT 1 FROM public.property_reservations r
      WHERE r.id = _reservation_id AND public.user_can_access_property(_user_id, r.property_id)
    ));
$$;

CREATE POLICY "tasks_select_access" ON public.tasks FOR SELECT TO authenticated
  USING (public.task_link_visible(auth.uid(), property_id, owner_contact_id, log_id, reservation_id));

CREATE POLICY "tasks_insert_access" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (public.task_link_visible(auth.uid(), property_id, owner_contact_id, log_id, reservation_id));

CREATE POLICY "tasks_update_access" ON public.tasks FOR UPDATE TO authenticated
  USING (public.task_link_visible(auth.uid(), property_id, owner_contact_id, log_id, reservation_id))
  WITH CHECK (public.task_link_visible(auth.uid(), property_id, owner_contact_id, log_id, reservation_id));

CREATE POLICY "tasks_delete_access" ON public.tasks FOR DELETE TO authenticated
  USING (public.task_link_visible(auth.uid(), property_id, owner_contact_id, log_id, reservation_id));

CREATE TRIGGER tasks_touch BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- Conclusões pontuais de pendências RECORRENTES: cada limpeza guarda sua
-- própria marca de "feito" aqui, sem tocar no status geral da pendência —
-- é isso que faz ela "voltar sozinha" pendente na limpeza seguinte.
-- ============================================================

CREATE TABLE public.task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  log_id uuid REFERENCES public.guide_access_logs(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.property_reservations(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES auth.users(id),
  CONSTRAINT task_completions_target_check CHECK (log_id IS NOT NULL OR reservation_id IS NOT NULL)
);

-- Constraints únicas CHEIAS (não parciais) de propósito — um índice único
-- parcial (WHERE log_id IS NOT NULL) já causou "there is no unique or
-- exclusion constraint matching ON CONFLICT" em guest_arrival_status
-- (ver 20260814220000_fix_arrival_status_conflict_target.sql). NULL já é
-- sempre distinto de qualquer outro valor no Postgres, então múltiplas
-- linhas do mesmo task_id com a OUTRA coluna nula continuam permitidas.
ALTER TABLE public.task_completions
  ADD CONSTRAINT task_completions_task_log_key UNIQUE (task_id, log_id);
ALTER TABLE public.task_completions
  ADD CONSTRAINT task_completions_task_reservation_key UNIQUE (task_id, reservation_id);

CREATE INDEX task_completions_task_idx ON public.task_completions(task_id);
CREATE INDEX task_completions_log_idx ON public.task_completions(log_id);
CREATE INDEX task_completions_reservation_idx ON public.task_completions(reservation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_completions TO authenticated;
GRANT ALL ON public.task_completions TO service_role;
REVOKE ALL ON public.task_completions FROM anon;

ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;

-- Reautoriza a pendência-mãe pelos MESMOS vínculos dela (task_link_visible,
-- não uma simples "a linha existe" — uma função SECURITY DEFINER lê a
-- tabela sem passar pela RLS dela, então "EXISTS (SELECT 1 FROM tasks...)"
-- sozinho enxergaria pendências de QUALQUER conta) e, à parte, valida o
-- log/reserva desta ocorrência específica contra o imóvel dele.
CREATE OR REPLACE FUNCTION public.task_completion_visible(
  _user_id uuid,
  _task_id uuid,
  _log_id uuid,
  _reservation_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (_log_id IS NOT NULL OR _reservation_id IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = _task_id
        AND public.task_link_visible(_user_id, t.property_id, t.owner_contact_id, t.log_id, t.reservation_id)
    )
    AND (_log_id IS NULL OR EXISTS (
      SELECT 1 FROM public.guide_access_logs l
      WHERE l.id = _log_id AND public.user_can_access_property(_user_id, l.property_id)
    ))
    AND (_reservation_id IS NULL OR EXISTS (
      SELECT 1 FROM public.property_reservations r
      WHERE r.id = _reservation_id AND public.user_can_access_property(_user_id, r.property_id)
    ));
$$;

CREATE POLICY "task_completions_select_access" ON public.task_completions FOR SELECT TO authenticated
  USING (public.task_completion_visible(auth.uid(), task_id, log_id, reservation_id));

CREATE POLICY "task_completions_insert_access" ON public.task_completions FOR INSERT TO authenticated
  WITH CHECK (public.task_completion_visible(auth.uid(), task_id, log_id, reservation_id));

CREATE POLICY "task_completions_delete_access" ON public.task_completions FOR DELETE TO authenticated
  USING (public.task_completion_visible(auth.uid(), task_id, log_id, reservation_id));
