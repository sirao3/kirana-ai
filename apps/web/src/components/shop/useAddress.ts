import { useQuery } from "@tanstack/react-query";
import { bap } from "./bap";

/** The customer's saved delivery address and which stores deliver to it (shared cache key ["address"]). */
export function useAddress(enabled = true) {
  return useQuery({ queryKey: ["address"], queryFn: bap.address, enabled, staleTime: 30_000 });
}
