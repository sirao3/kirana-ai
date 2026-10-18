/**
 * Offer alert sound, synthesised with the Web Audio API (no audio files).
 * Browsers block audio until a user gesture, so the Online toggle / "All stores online" button
 * calls unlockAudio() on click, which also plays one short beep.
 */
import { useSyncExternalStore } from "react";
import { flashTitle, offerBadgeIcon } from "./attention";

let ctx: AudioContext | null = null;

const audioListeners = new Set<() => void>();
const notifyAudio = () => audioListeners.forEach((l) => l());

function getContext(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      ctx.addEventListener("statechange", notifyAudio);
    }
    return ctx;
  } catch {
    return null;
  }
}

/** One short two-tone chirp. Silent (no throw) if audio is unavailable or still locked. */
export function beep(freqs: number[] = [880, 1175], ms = 140): void {
  const c = getContext();
  if (!c || c.state !== "running") return;
  const start = c.currentTime;
  freqs.forEach((f, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    const t0 = start + (i * ms) / 1000;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  });
}

/** Call from a click handler: resumes the audio context and confirms with a beep. */
export async function unlockAudio(): Promise<void> {
  const c = getContext();
  if (!c) return;
  try {
    if (c.state !== "running") await c.resume();
  } catch {
    return;
  }
  beep([660], 120);
}

/** True when the AudioContext is running, i.e. offer sounds will actually play. False if unavailable or still locked. */
export function isAudioUnlocked(): boolean {
  return getContext()?.state === "running";
}

/** Subscribe to audio lock/unlock changes (for useSyncExternalStore). Returns the unsubscribe function. */
export function subscribeAudio(cb: () => void): () => void {
  getContext(); // create it so its statechange events reach us
  audioListeners.add(cb);
  return () => void audioListeners.delete(cb);
}

/** Live "are offer sounds on" flag. */
export function useAudioUnlocked(): boolean {
  return useSyncExternalStore(subscribeAudio, isAudioUnlocked, () => false);
}

// --- looping alert + attention cues while any dashboard has a pending offer ---
interface Pending { count: number; totalPaise: number }
const pending = new Map<string, Pending>();
let timer: ReturnType<typeof setInterval> | null = null;
let titleTimer: ReturnType<typeof setInterval> | null = null;
let baseTitle: string | null = null;

function attentionTotals(): { count: number; totalPaise: number } {
  let count = 0;
  let totalPaise = 0;
  for (const p of pending.values()) {
    count += p.count;
    totalPaise = Math.max(totalPaise, p.totalPaise);
  }
  return { count, totalPaise };
}

function renderTitle(phase: boolean): void {
  if (baseTitle === null) return;
  const { count, totalPaise } = attentionTotals();
  document.title = flashTitle(baseTitle, count, totalPaise, phase);
}

function startAttention(): void {
  if (typeof document === "undefined") return;
  baseTitle = document.title.replace(/^\(\d+\) New offer .*? — /, "");
  setFavicon(offerBadgeIcon());
  let phase = false;
  titleTimer = setInterval(() => {
    // Flash only while the tab is in the background; a visible tab keeps the plain count title.
    phase = document.hidden ? !phase : true;
    renderTitle(phase);
  }, 900);
  renderTitle(true);
}

function stopAttention(): void {
  if (titleTimer) clearInterval(titleTimer);
  titleTimer = null;
  if (baseTitle !== null) document.title = baseTitle;
  baseTitle = null;
  setFavicon(null);
}

let iconEl: HTMLLinkElement | null = null;
let iconOriginal: string | null | undefined;
function setFavicon(href: string | null): void {
  try {
    if (href) {
      if (!iconEl) {
        iconEl = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
        iconOriginal = iconEl ? iconEl.href : null;
        if (!iconEl) {
          iconEl = document.createElement("link");
          iconEl.rel = "icon";
          document.head.appendChild(iconEl);
        }
      }
      iconEl.href = href;
    } else if (iconEl) {
      if (iconOriginal) iconEl.href = iconOriginal;
      else iconEl.remove();
      iconEl = null;
      iconOriginal = undefined;
    }
  } catch {
    // favicon is a nicety
  }
}

function vibrate(): void {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // unsupported
  }
}

/**
 * Registers (or clears) a source of pending offers. While at least one is active the alert sound loops, the
 * favicon gets a badge and the tab title flashes in the background; a rise in the count vibrates (phones).
 */
export function setPendingOffers(key: string, hasPending: boolean, info?: Pending): void {
  const before = pending.get(key)?.count ?? 0;
  if (hasPending) pending.set(key, info ?? { count: 1, totalPaise: 0 });
  else pending.delete(key);
  const after = pending.get(key)?.count ?? 0;
  if (after > before) vibrate();
  if (pending.size > 0 && !timer) {
    beep();
    timer = setInterval(() => beep(), 1600);
    startAttention();
  } else if (pending.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
    stopAttention();
  } else if (pending.size > 0) {
    renderTitle(true);
  }
}
