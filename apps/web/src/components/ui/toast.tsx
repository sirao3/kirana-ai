// KiranaAI design kit, part 5: toasts. One at a time, bottom-centre (above the tab bar on phones), polite live region.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FONT, IClose, soft } from "./kit";

interface Toast {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
}
const Ctx = createContext<(text: string, action?: Toast["action"]) => void>(() => undefined);

/** `snack(text, action?)`: 4 s, or 6 s when it carries an action. */
export function useSnackbar() {
  return useContext(Ctx);
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<Toast | null>(null);
  const id = useRef(0);
  const show = useCallback((text: string, action?: Toast["action"]) => setMsg({ id: ++id.current, text, action }), []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg((m) => (m?.id === msg.id ? null : m)), msg.action ? 6000 : 4000);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--snackbar-offset,0px)+16px)] z-[70] flex justify-center px-4">
        <AnimatePresence>
          {msg && (
            <motion.div key={msg.id} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={soft}
              className="pointer-events-auto flex min-h-12 w-full max-w-[560px] items-center gap-2 rounded-[14px] py-1 pl-4 pr-1.5 text-white sm:w-auto sm:min-w-[320px]"
              style={{ background: "rgba(29,29,31,0.92)", backdropFilter: "blur(20px)", boxShadow: "0 12px 32px rgba(0,0,0,0.22)", fontFamily: FONT }}>
              <span className="flex-1 py-2 text-[15px]">{msg.text}</span>
              {msg.action && (
                <button type="button" className="h-9 cursor-pointer rounded-[10px] px-3 text-[15px] font-semibold hover:bg-white/10" style={{ color: "#64D2FF" }}
                  onClick={() => { msg.action!.onClick(); setMsg(null); }}>
                  {msg.action.label}
                </button>
              )}
              <button type="button" aria-label="Dismiss" title="Dismiss" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full opacity-70 hover:bg-white/10" onClick={() => setMsg(null)}>
                <IClose size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
