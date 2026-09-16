import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkIsAdmin } from "@/lib/admin-subs.functions";

export function useIsAdmin() {
  const fetcher = useServerFn(checkIsAdmin);
  const q = useQuery({
    queryKey: ["is-admin"],
    queryFn: () => fetcher(),
    staleTime: 60_000,
  });
  return { isAdmin: !!q.data?.isAdmin, isLoading: q.isLoading };
}
