import { queryOptions, type QueryKey } from "@tanstack/react-query";

/** Cards and charts must consume the same result, never a previous period. */
export function cleaningStatsQueryOptions<T>({
  queryKey,
  queryFn,
  enabled,
}: {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  enabled: boolean;
}) {
  return queryOptions({ queryKey, queryFn, enabled, staleTime: 10_000 });
}