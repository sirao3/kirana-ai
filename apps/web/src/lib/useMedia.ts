import { useSyncExternalStore } from "react";

/** Live result of a CSS media query. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

/** M3 expanded window class and up (≥840 px): room for a supporting pane. */
export const EXPANDED = "(min-width: 840px)";
