-- LIMPEZA COMPLETA PRECISA DE APROVAÇÃO (pedido explícito, 17/09/2026).
--
-- "sempre que a limpeza selecionar 'completa', essa informação precisa ir
--  pra aprovação antes de contabilizar no valor do dashboard"
--
-- Estado da aprovação, gravado na mesma linha de saída (kind = 'checkout')
-- que já guarda o tipo e o valor da limpeza:
--   pending   limpeza completa aguardando o gestor — NÃO entra nos totais;
--   approved  completa aprovada — entra com o valor da completa;
--   rejected  o gestor marcou "Foi normal" — a linha vira limpeza normal,
--             com o valor da normal, e o valor pedido fica registrado.
--   null      limpeza normal (não precisa de aprovação).
--
-- Quem aprova: o dono da conta, ou quem recebeu a permissão
-- "tenant.dashboard.chegadas.aprovar-limpeza" diretamente. A checagem mora no
-- servidor (cleaning-approval.functions.ts), que grava com a chave de serviço.
-- O gatilho abaixo impede que qualquer outra sessão aprove por fora da tela,
-- já que a política de UPDATE da tabela libera quem tem acesso ao imóvel.

ALTER TABLE public.guest_arrival_status
  ADD COLUMN IF NOT EXISTS cleaning_approval_status text
    CHECK (cleaning_approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS cleaning_approval_by uuid,
  ADD COLUMN IF NOT EXISTS cleaning_approval_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleaning_done_by uuid,
  ADD COLUMN IF NOT EXISTS cleaning_requested_price_cents integer;

COMMENT ON COLUMN public.guest_arrival_status.cleaning_approval_status IS
  'Aprovação da limpeza completa: pending (fora dos totais), approved, rejected (virou normal). Nulo para limpeza normal.';
COMMENT ON COLUMN public.guest_arrival_status.cleaning_approval_by IS 'Quem aprovou ou recusou a limpeza completa.';
COMMENT ON COLUMN public.guest_arrival_status.cleaning_approval_at IS 'Quando a limpeza completa foi aprovada ou recusada.';
COMMENT ON COLUMN public.guest_arrival_status.cleaning_done_by IS 'Quem concluiu a limpeza na esteira (nulo quando não houve usuário).';
COMMENT ON COLUMN public.guest_arrival_status.cleaning_requested_price_cents IS
  'Valor da completa pedido na conclusão — preservado quando o gestor marca "Foi normal".';

CREATE INDEX IF NOT EXISTS guest_arrival_status_cleaning_pending_idx
  ON public.guest_arrival_status (property_id)
  WHERE cleaning_approval_status = 'pending';

CREATE OR REPLACE FUNCTION public.guard_cleaning_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  privileged boolean := current_user IN ('service_role', 'postgres', 'supabase_admin');
BEGIN
  IF privileged THEN
    -- Mesmo pela chave de serviço, completa sem decisão nasce pendente.
    IF NEW.cleaning_type = 'completa' AND NEW.cleaning_approval_status IS NULL THEN
      NEW.cleaning_approval_status := 'pending';
    END IF;
    RETURN NEW;
  END IF;

  -- Sessão comum: uma decisão (approved/rejected) só sobrevive se já existia
  -- e a limpeza não mudou. Criar ou alterar uma decisão daqui, nunca.
  IF NEW.cleaning_approval_status IN ('approved', 'rejected') THEN
    IF TG_OP = 'INSERT'
       OR OLD.cleaning_approval_status IS DISTINCT FROM NEW.cleaning_approval_status
       OR OLD.cleaning_type IS DISTINCT FROM NEW.cleaning_type
       OR OLD.cleaning_price_cents IS DISTINCT FROM NEW.cleaning_price_cents THEN
      NEW.cleaning_approval_status := NULL;
    END IF;
  END IF;

  IF NEW.cleaning_type = 'completa' THEN
    IF NEW.cleaning_approval_status IS DISTINCT FROM 'approved' THEN
      NEW.cleaning_approval_status := 'pending';
    END IF;
  ELSIF NEW.cleaning_approval_status IS DISTINCT FROM 'rejected' THEN
    NEW.cleaning_approval_status := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.cleaning_approval_by := NULL;
    NEW.cleaning_approval_at := NULL;
    NEW.cleaning_requested_price_cents := NULL;
  ELSIF NEW.cleaning_approval_status IS NOT DISTINCT FROM OLD.cleaning_approval_status THEN
    NEW.cleaning_approval_by := OLD.cleaning_approval_by;
    NEW.cleaning_approval_at := OLD.cleaning_approval_at;
    NEW.cleaning_requested_price_cents := OLD.cleaning_requested_price_cents;
  ELSE
    NEW.cleaning_approval_by := NULL;
    NEW.cleaning_approval_at := NULL;
    NEW.cleaning_requested_price_cents := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guest_arrival_status_guard_cleaning_approval ON public.guest_arrival_status;
CREATE TRIGGER guest_arrival_status_guard_cleaning_approval
  BEFORE INSERT OR UPDATE ON public.guest_arrival_status
  FOR EACH ROW EXECUTE FUNCTION public.guard_cleaning_approval();

-- Decisão do cliente (17/09/2026): as completas já registradas também passam
-- pela aprovação.
UPDATE public.guest_arrival_status
   SET cleaning_approval_status = 'pending'
 WHERE kind = 'checkout'
   AND cleaning_type = 'completa'
   AND cleaning_approval_status IS NULL;

-- Nó da permissão nova, filho de "Chegadas e saídas" (mesmo slug do catálogo
-- em src/lib/permissions/permission.catalog.ts). Ninguém recebe acesso aqui:
-- fora o dono da conta, só aprova quem for liberado na tela de permissões.
INSERT INTO public.permission_nodes
  (slug, name, label, type, "order", display_order, active, parent_id, is_system,
   is_hidden, is_permissionable, max_access_level, version, deprecated)
SELECT 'tenant.dashboard.chegadas.aprovar-limpeza', 'Aprovar limpeza completa',
       'Aprovar limpeza completa', 'RESOURCE', 45, 45, true, p.id, false,
       false, true, 'WRITE', 1, false
  FROM public.permission_nodes p
 WHERE p.slug = 'tenant.dashboard.chegadas'
ON CONFLICT (slug) DO NOTHING;

-- Pedido do cliente (17/09/2026): "coloque todos os usuários oficiais da
-- empresa já com essa permissão... não usuários externos (prestadores,
-- proprietários, etc)". Oficial = membro ATIVO da conta, que não é o dono
-- (o dono já aprova sempre) e não está vinculado a um cadastro de prestador.
-- Proprietários não têm login de equipe. Membros que entrarem depois recebem
-- a permissão pela tela de permissões, como qualquer outra.
INSERT INTO public.permission_assignments
  (tenant_id, user_id, permission_node_id, access_level, scope_type, scope_id, created_by)
SELECT m.owner_id, m.member_user_id, n.id, 'WRITE', 'TENANT', NULL, m.owner_id
  FROM public.account_members m
  JOIN public.permission_nodes n ON n.slug = 'tenant.dashboard.chegadas.aprovar-limpeza'
 WHERE m.status = 'active'
   AND m.role <> 'owner'
   AND m.member_user_id <> m.owner_id
   AND NOT EXISTS (
     SELECT 1 FROM public.service_providers sp WHERE sp.member_user_id = m.member_user_id
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.permission_assignments a
      WHERE a.tenant_id = m.owner_id
        AND a.user_id = m.member_user_id
        AND a.permission_node_id = n.id
        AND a.scope_type = 'TENANT'
        AND a.scope_id IS NULL
   );
