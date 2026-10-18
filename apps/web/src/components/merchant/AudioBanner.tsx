import { Button, Notice } from "../ui";
import { unlockAudio, useAudioUnlocked } from "./alert";

/** While the browser still blocks audio, offers would arrive silently: one quiet notice with the button that unlocks it. */
export function AudioBanner({ className }: { className?: string }) {
  const on = useAudioUnlocked();
  if (on) return null;
  return (
    <Notice tone="neutral" live={false} className={className} title="Offer sounds are off"
      action={<Button variant="secondary" size="sm" style={{ background: "#fff" }} onClick={() => void unlockAudio()}>Turn on sounds</Button>}>
      Your browser keeps this page silent until you tap once.
    </Notice>
  );
}
