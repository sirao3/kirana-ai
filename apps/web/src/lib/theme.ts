import { useEffect, useSyncExternalStore } from "react";

/** Light / dark / follow-system. The choice is a per-viewer convenience kept in localStorage. */
export type ThemeMode = "system" | "light" | "dark";

const KEY = "kiranaai.theme";
const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let current: ThemeMode = typeof window === "undefined" ? "system" : readMode();

function apply() {
  const dark = current === "dark" || (current === "system" && media().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemeMode(m: ThemeMode) {
  current = m;
  try {
    if (m === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, m);
  } catch {
    // storage blocked: the choice lasts for this page view
  }
  apply();
  listeners.forEach((l) => l());
}

/** Mount once at the root: applies data-theme on <html> and follows the OS setting in "system" mode. */
export function useThemeSync() {
  useEffect(() => {
    apply();
    const m = media();
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, []);
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const mode = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return [mode, setThemeMode];
}
