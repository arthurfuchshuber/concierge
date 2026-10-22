import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { cleaningStatsQueryOptions } from "../cleaning-stats-query";

describe("cleaning period query", () => {
  it("does not show the previous period while the new totals and daily series load", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const previous = { cleaningsDone: 13, totalCents: 160000, daily: [{ date: "2026-10-16", count: 13 }] };
    const next = { cleaningsDone: 16, totalCents: 195000, daily: [{ date: "2026-10-15", count: 3 }, { date: "2026-10-16", count: 13 }] };
    const options = (start: string, queryFn: () => Promise<typeof previous>) =>
      cleaningStatsQueryOptions({ queryKey: ["dash-cleaning-stats", "self", start, "2026-10-21"], enabled: true, queryFn });
    const first = options("2026-10-16", async () => previous);
    client.setQueryData(first.queryKey, previous);
    const observer = new QueryObserver(client, first);
    const unsubscribe = observer.subscribe(() => {});
    let resolveNext: ((value: typeof next) => void) | undefined;
    const fetchNext = vi.fn(() => new Promise<typeof next>((resolve) => { resolveNext = resolve; }));
    observer.setOptions(options("2026-10-15", fetchNext));
    expect(observer.getCurrentResult().isLoading).toBe(true);
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.getCurrentResult().isPlaceholderData).toBe(false);
    if (!resolveNext) throw new Error("The selected period did not fetch");
    resolveNext(next);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(next));
    expect(observer.getCurrentResult().isLoading).toBe(false);
    expect(fetchNext).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().data?.daily.reduce((sum, day) => sum + day.count, 0)).toBe(16);
    unsubscribe();
    client.clear();
  });
});