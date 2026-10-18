import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx, Icon, IconButton } from "./core";

/**
 * Opens/closes a native modal <dialog> and returns focus to whatever opened it. Browsers restore focus on close()
 * themselves, but not when the trigger was re-rendered or the dialog was unmounted, so remember it explicitly.
 */
export function useModalDialog(ref: React.RefObject<HTMLDialogElement | null>, open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
    }
    if (!open && d.open) {
      d.close();
      const o = opener.current;
      opener.current = null;
      if (o && o.isConnected) o.focus();
    }
  }, [open, ref]);
  useEffect(
    () => () => {
      // Unmounted while open (e.g. route change): still hand focus back.
      const o = opener.current;
      if (o && o.isConnected) o.focus();
    },
    [],
  );
}

// ---------- Dialog (native <dialog>: focus trap, Esc and inert background come from the browser) ----------

export function Dialog({
  open, onClose, title, icon, children, actions, fullScreenOnCompact, dismissible = true, className, wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Below 600 px the dialog fills the window with a top bar (M3 full-screen dialog). */
  fullScreenOnCompact?: boolean;
  /** False while a transaction is in flight: Esc and scrim clicks are ignored. */
  dismissible?: boolean;
  className?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useModalDialog(ref, open);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && dismissible) onClose();
      }}
      className={cx(
        "m-auto max-h-[calc(100dvh-48px)] w-[calc(100%-48px)] overflow-hidden rounded-xl bg-surface-container-high p-0 text-on-surface shadow-3 open:flex open:animate-scale-in open:flex-col",
        wide ? "max-w-2xl" : "max-w-[560px] sm:min-w-[320px]",
        fullScreenOnCompact && "max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-full max-sm:rounded-none max-sm:open:animate-sheet-up",
        className,
      )}
    >
      {open && (
        <>
          {fullScreenOnCompact && (
            <header className="flex h-16 shrink-0 items-center gap-1 px-1 sm:hidden">
              <IconButton icon="close" label="Close" onClick={onClose} disabled={!dismissible} />
              <h2 id={titleId} className="min-w-0 flex-1 truncate type-title-large">{title}</h2>
            </header>
          )}
          <div className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-2", fullScreenOnCompact ? "max-sm:pt-0 sm:pt-6" : "pt-6")}>
            {icon && <Icon name={icon} className={cx("mb-4 self-center text-secondary", fullScreenOnCompact && "max-sm:hidden")} />}
            <h2 id={fullScreenOnCompact ? undefined : titleId} className={cx("mb-4 type-headline-small text-on-surface", icon && "text-center", fullScreenOnCompact && "max-sm:hidden")}>
              {title}
            </h2>
            <div className="type-body-medium text-on-surface-variant">{children}</div>
          </div>
          {actions && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pb-6 pt-4">{actions}</footer>}
        </>
      )}
    </dialog>
  );
}

// ---------- Modal bottom sheet ----------

export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref, open);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="mx-auto mb-0 mt-auto max-h-[90dvh] w-full max-w-[640px] overflow-hidden rounded-t-xl bg-surface-container-low p-0 text-on-surface shadow-1 open:flex open:animate-sheet-up open:flex-col"
    >
      {open && (
        <>
          <div className="flex shrink-0 justify-center pb-1 pt-4">
            <button aria-label={`Close ${title}`} onClick={onClose} className="h-4 w-12 cursor-pointer rounded-full p-1.5">
              <span className="block h-1 w-8 rounded-full bg-on-surface-variant/40 mx-auto" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">{children}</div>
        </>
      )}
    </dialog>
  );
}

// ---------- Snackbar ----------

interface SnackbarMsg {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
}
const SnackbarCtx = createContext<(text: string, action?: SnackbarMsg["action"]) => void>(() => undefined);

export function useSnackbar() {
  return useContext(SnackbarCtx);
}

/** One snackbar at a time, bottom-centre (above the navigation bar on compact windows), 4 s, polite live region. */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<SnackbarMsg | null>(null);
  const idRef = useRef(0);
  const show = useCallback((text: string, action?: SnackbarMsg["action"]) => setMsg({ id: ++idRef.current, text, action }), []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg((m) => (m?.id === msg.id ? null : m)), msg.action ? 6000 : 4000);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <SnackbarCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--snackbar-offset,0px)+16px)] z-50 flex justify-center px-4">
        {msg && (
          <div key={msg.id} className="pointer-events-auto flex min-h-12 w-full max-w-[560px] animate-scale-in items-center gap-2 rounded-xs bg-inverse-surface py-1 pl-4 pr-2 text-inverse-on-surface shadow-3 sm:w-auto sm:min-w-[344px]">
            <span className="flex-1 py-2 type-body-medium">{msg.text}</span>
            {msg.action && (
              <button
                className="state-layer h-10 cursor-pointer rounded-full px-3 type-label-large text-inverse-primary"
                onClick={() => {
                  msg.action!.onClick();
                  setMsg(null);
                }}
              >
                {msg.action.label}
              </button>
            )}
            <button aria-label="Dismiss" title="Dismiss" className="state-layer flex h-10 w-10 cursor-pointer items-center justify-center rounded-full" onClick={() => setMsg(null)}>
              <Icon name="close" size={20} />
            </button>
          </div>
        )}
      </div>
    </SnackbarCtx.Provider>
  );
}

// ---------- Menu ----------

export interface MenuItem {
  label: string;
  icon?: string;
  onSelect: () => void;
  supporting?: string;
}

/** Anchored menu. `trigger` gets the toggle props; arrow keys move between items, Esc closes. */
export function Menu({ trigger, items, header, align = "end" }: {
  trigger: (p: { onClick: () => void; "aria-haspopup": "menu"; "aria-expanded": boolean }) => ReactNode;
  items: MenuItem[];
  header?: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={box} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-haspopup": "menu", "aria-expanded": open })}
      {open && (
        <div
          role="menu"
          className={cx("absolute top-full z-40 mt-1 min-w-[200px] max-w-[280px] animate-scale-in rounded-xs bg-surface-container py-2 shadow-2", align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left")}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              (box.current?.firstElementChild as HTMLElement | null)?.focus();
            }
            if (e.key === "Tab") return setOpen(false);
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const els = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
            const i = els.indexOf(document.activeElement as HTMLElement);
            const next = e.key === "Home" ? 0 : e.key === "End" ? els.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length;
            els[next]?.focus();
          }}
        >
          {header && <div className="px-3 pb-2 pt-1">{header}</div>}
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className="state-layer flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 text-left text-on-surface focus-visible:outline-none focus-visible:before:opacity-10"
              onClick={() => {
                setOpen(false);
                (box.current?.firstElementChild as HTMLElement | null)?.focus(); // focus returns to the trigger
                it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} className="text-on-surface-variant" />}
              <span className="min-w-0">
                <span className="block type-body-large">{it.label}</span>
                {it.supporting && <span className="block type-body-small text-on-surface-variant">{it.supporting}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
