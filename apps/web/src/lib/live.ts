import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

/** Polled query for live screens (PRD: 1 s polling, no SSE). */
export function useLive<T>(key: unknown[], fn: () => Promise<T>, opts: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({ queryKey: key, queryFn: fn, refetchInterval: 1000, refetchIntervalInBackground: true, ...opts });
}
