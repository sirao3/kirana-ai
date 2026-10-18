import { useState } from "react";
import { Link } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "../components/ui/toast";
import { Button, C, FONT, ISound, Notice, Skeleton } from "../components/ui";
import { unlockAudio, useAudioUnlocked } from "../components/merchant/alert";
import { StoreTile } from "../components/merchant/StoreDashboard";
import { setAllOnline, useWallTokens } from "../components/merchant/useWallTokens";

/** /wall: the presenter view, every store side by side. Each column uses its own merchant token (no admin passcode). */
export function Wall() {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const sound = useAudioUnlocked();
  const [working, setWorking] = useState(false);
  const stores = useWallTokens();

  async function allOnline() {
    void unlockAudio(); // the click also unlocks offer sounds for every column
    setWorking(true);
    try {
      await setAllOnline(stores.data ?? [], qc);
      snack("All stores are online. Offer sounds are on.");
    } catch {
      snack("Could not bring every store online.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh px-4 pb-10 pt-5 sm:px-6 lg:px-8" style={{ background: C.bg, fontFamily: FONT, color: C.label }}>
        <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <Link to="/" aria-label="KiranaAI home" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[14px] font-bold text-white" style={{ background: C.green }}>K</Link>
          <div className="min-w-[220px] flex-1">
            <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em] sm:text-[28px]">Store wall</h1>
            <p className="text-[14px]" style={{ color: C.secondary }}>Every store, live. New orders ring and appear in their column.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" aria-pressed={sound} onClick={() => void unlockAudio()} icon={<ISound on={sound} size={18} />}
              style={sound ? undefined : { background: "#FFF4E0", color: "#B25E00" }}>
              {sound ? "Sounds on" : "Turn on sounds"}
            </Button>
            <Button busy={working} disabled={!stores.data} onClick={() => void allOnline()}>All stores online</Button>
          </div>
        </header>

        {stores.isError && (
          <Notice tone="bad" title="Could not load the stores" className="mb-4" action={<Button variant="plain" size="sm" onClick={() => void stores.refetch()}>Retry</Button>} />
        )}
        <div className="grid items-start gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 min-[1360px]:grid-cols-5">
          {stores.isLoading && [0, 1, 2, 3, 4].map((i) => <div key={i} className="space-y-2 p-2" role="status" aria-label="Loading store"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-16" /></div>)}
          {stores.data?.map((s) => <StoreTile key={s.id} storeId={s.id} token={s.token} />)}
        </div>
      </div>
    </MotionConfig>
  );
}
