import { useEffect, useRef, useState } from "react";
import type { OrderView } from "@kiranaai/shared";
import { useSnackbar } from "../ui/toast";
import { diffOrder } from "./handoff";

/**
 * Watches the polled order and returns text for a polite live region.
 * Handoffs (a store declined / timed out) are shown as a snackbar, whose own polite region speaks them;
 * other updates (offered, accepted) go to the returned text. Each change is therefore read once.
 */
export function useAttemptAnnouncements(order: OrderView): string {
  const prev = useRef<OrderView | undefined>(undefined);
  const snack = useSnackbar();
  const [said, setSaid] = useState("");
  useEffect(() => {
    const items = diffOrder(prev.current, order);
    prev.current = order;
    if (!items.length) return;
    const handoffs = items.filter((i) => i.handoff);
    const quiet = items.filter((i) => !i.handoff);
    if (handoffs.length) snack(handoffs[handoffs.length - 1]!.text); // one at a time; the latest wins
    if (quiet.length) setSaid(quiet.map((i) => i.text).join(" "));
  }, [order, snack]);
  return said;
}
