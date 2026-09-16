import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useImpersonation } from "@/hooks/useImpersonation";
import { getMyPermissions, type MemberPermission } from "@/lib/member-permissions.functions";

/**
 * Returns the caller's permission map for the currently active account.
 * When there is no impersonation the caller is the owner of their own
 * account and holds every permission.
 */
export function useMyPermissions() {
  const { impersonation } = useImpersonation();
  const getFn = useServerFn(getMyPermissions);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
  }, []);
  const ownerId = impersonation?.userId ?? myUserId ?? null;

  const q = useQuery({
    queryKey: ["my-permissions", ownerId],
    queryFn: () => getFn({ data: { ownerId: ownerId! } }),
    enabled: !!ownerId,
    staleTime: 60_000,
  });

  function can(p: MemberPermission): boolean {
    if (!q.data) return false;
    return !!q.data.permissions[p];
  }
  return { isOwner: q.data?.isOwner ?? false, can, loading: q.isLoading };
}
