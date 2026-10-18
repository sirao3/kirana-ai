import { cx, Icon } from "../m3";
import { unlockAudio, useAudioUnlocked } from "./alert";

/**
 * Persistent banner while the browser still blocks audio: offers would arrive silently.
 * The whole bar is the button, so one tap anywhere on it turns sounds on (and it disappears for good).
 */
export function AudioBanner({ className }: { className?: string }) {
  const on = useAudioUnlocked();
  if (on) return null;
  return (
    <button
      type="button"
      onClick={() => void unlockAudio()}
      className={cx(
        "state-layer flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md bg-tertiary-container px-4 py-2 text-left text-on-tertiary-container",
        className,
      )}
    >
      <Icon name="volume_off" />
      <span className="min-w-0 flex-1">
        <span className="block type-title-small">Tap to turn on offer sounds</span>
        <span className="block type-body-small">Your browser keeps this page silent until you do.</span>
      </span>
      <Icon name="volume_up" />
    </button>
  );
}
