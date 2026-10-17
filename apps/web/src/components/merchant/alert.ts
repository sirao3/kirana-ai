/**
 * Offer alert sound, synthesised with the Web Audio API (no audio files).
 * Browsers block audio until a user gesture, so the Online toggle / "All stores online" button
 * calls unlockAudio() on click, which also plays one short beep.
 */
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
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

// --- looping alert while any dashboard has a pending offer ---
const pending = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;

/** Registers (or clears) a source of pending offers; the alert loops while at least one is active. */
export function setPendingOffers(key: string, hasPending: boolean): void {
  if (hasPending) pending.add(key);
  else pending.delete(key);
  if (pending.size > 0 && !timer) {
    beep();
    timer = setInterval(() => beep(), 1600);
  } else if (pending.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}
