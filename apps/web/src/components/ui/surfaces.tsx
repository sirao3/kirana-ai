// KiranaAI design kit, part 3: surfaces. Group through spacing and inset grouped lists, not boxes around everything.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { secondsUntil } from "../../lib/format";
import { useMedia } from "../../lib/useMedia";
import { C, IChevron, IClose, IInfo, IWarning, cardShadow, ease, sheet as sheetSpring, soft } from "./kit";
import { cx, IconButton } from "./controls";

/** White content card, 20 pt radius, soft elevation. */
export function Card({ children, className, padding = 20, style, as: As = "section", ...rest }: { children: ReactNode; className?: string; padding?: number; style?: React.CSSProperties; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cx("rounded-[20px] bg-white", className)} style={{ padding, boxShadow: cardShadow, ...style }} {...rest}>
      {children}
    </As>
  );
}

/** Large title header (34 pt) with optional subtitle and trailing actions. */
export function LargeTitle({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.025em] sm:text-[34px]" style={{ color: C.label }}>{title}</h1>
        {subtitle && <p className="mt-1 text-[15px]" style={{ color: C.secondary }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Small uppercase section label above a group. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-end justify-between gap-3 px-1">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: C.tertiary }}>{children}</h2>
      {action}
    </div>
  );
}

/** Inset grouped list (iOS Settings). Rows are separated by hairlines inset past the leading accessory. */
export function Group({ title, footer, action, children, className }: { title?: ReactNode; footer?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {title && <SectionLabel action={action}>{title}</SectionLabel>}
      <ul className="overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)" }}>{children}</ul>
      {footer && <p className="mt-1.5 px-1 text-[12px] leading-[1.45]" style={{ color: C.secondary }}>{footer}</p>}
    </section>
  );
}

/** One row of a Group. Navigation rows get a chevron; `trailing` holds a value, switch or button. */
export function Row({ title, subtitle, leading, trailing, detail, onClick, chevron, destructive, className }: {
  title: ReactNode; subtitle?: ReactNode; leading?: ReactNode; trailing?: ReactNode; detail?: ReactNode; onClick?: () => void; chevron?: boolean; destructive?: boolean; className?: string;
}) {
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1 py-2.5">
        <span className="block text-[15px] leading-[1.3]" style={{ color: destructive ? C.red : C.label }}>{title}</span>
        {subtitle && <span className="mt-0.5 block text-[13px] leading-[1.35]" style={{ color: C.secondary }}>{subtitle}</span>}
      </span>
      {detail && <span className="shrink-0 text-[15px]" style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }}>{detail}</span>}
      {trailing && <span className="flex shrink-0 items-center">{trailing}</span>}
      {(chevron ?? !!onClick) && <span style={{ color: C.tertiary }}><IChevron size={15} /></span>}
    </>
  );
  return (
    <li className={cx("[&+li]:border-t-[0.5px]", className)} style={{ borderColor: C.sep }}>
      {onClick ? (
        <button type="button" onClick={onClick} className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 text-left transition-colors hover:bg-black/[0.025] active:bg-black/[0.05]">{body}</button>
      ) : (
        <div className="flex min-h-11 items-center gap-3 px-4">{body}</div>
      )}
    </li>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
const TONE_FG: Record<Tone, string> = { neutral: C.secondary, good: C.green, warn: "#B25E00", bad: C.red, info: C.blue };
const TONE_BG: Record<Tone, string> = { neutral: C.fill, good: "#E9F6EC", warn: "#FFF4E0", bad: "#FDECEA", info: "#EAF3FF" };

/** Status as coloured text with a dot. Never colour alone: the text always says it. */
export function StatusText({ tone = "neutral", children, dot = true, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[13px] font-medium", className)} style={{ color: TONE_FG[tone] }}>
      {dot && <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: TONE_FG[tone] }} />}
      {children}
    </span>
  );
}

/** Small tinted label, for the rare status that needs a container (e.g. a table cell). */
export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className="inline-flex items-center whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-[12px] font-semibold" style={{ background: TONE_BG[tone], color: TONE_FG[tone] }}>{children}</span>;
}

/** Inline notice next to the affected content, with an optional recovery action. */
export function Notice({ tone = "info", title, children, action, className, live = true }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; live?: boolean }) {
  return (
    <div role={live ? (tone === "bad" ? "alert" : "status") : undefined} className={cx("flex flex-wrap items-start gap-3 rounded-[14px] px-4 py-3", className)} style={{ background: TONE_BG[tone] }}>
      <span className="mt-px" style={{ color: TONE_FG[tone] }}>{tone === "bad" || tone === "warn" ? <IWarning size={18} /> : <IInfo size={18} />}</span>
      <div className="min-w-0 flex-1 text-[14px] leading-[1.45]" style={{ color: C.label }}>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div style={{ color: title ? C.secondary : C.label }}>{children}</div>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

/** Empty state: what is absent, why, and one next action. No illustration. */
export function EmptyState({ title, children, action, className }: { title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-12 text-center", className)}>
      <p className="text-[17px] font-semibold" style={{ color: C.label }}>{title}</p>
      {children && <p className="mt-1 max-w-sm text-[15px] leading-[1.45]" style={{ color: C.secondary }}>{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Loading placeholder that keeps the layout. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <motion.span aria-hidden className={cx("block rounded-[8px]", className)} style={{ background: "#ECECEF", ...style }} animate={{ opacity: [0.6, 1, 0.6] }} transition={{ repeat: Infinity, duration: 1.4 }} />;
}

/** Live mm:ss to an ISO time; calls onDone once at zero. */
export function Countdown({ until, onDone }: { until: string | null; onDone?: () => void }) {
  const [left, setLeft] = useState(() => secondsUntil(until));
  useEffect(() => {
    setLeft(secondsUntil(until));
    const t = setInterval(() => {
      const s = secondsUntil(until);
      setLeft(s);
      if (s === 0) { clearInterval(t); onDone?.(); }
    }, 250);
    return () => clearInterval(t);
  }, [until, onDone]);
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>;
}

// ---------- Sheet / Alert ----------

/** Modal sheet: slides up from the bottom on phones, a centred panel from 840 px. Esc and scrim close it; focus enters and returns. */
export function Sheet({ open, onClose, title, children, footer, dismissible = true, width = 520 }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; dismissible?: boolean; width?: number;
}) {
  const wide = useMedia("(min-width: 840px)");
  const panel = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement;
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("[autofocus], input, button:not([data-close]), [href], select, textarea, [tabindex]:not([tabindex='-1'])");
      (first ?? panel.current)?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) close.current();
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        const [a, z] = [f[0]!, f[f.length - 1]!];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); (back.current as HTMLElement | null)?.focus?.(); };
  }, [open, dismissible]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" style={{ fontFamily: "inherit" }}>
          <motion.div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.28)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={ease}
            onClick={dismissible ? onClose : undefined} />
          <motion.div ref={panel} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} tabIndex={-1}
            initial={wide ? { opacity: 0, scale: 0.96, y: 12 } : { y: "100%" }} animate={wide ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }} exit={wide ? { opacity: 0, scale: 0.97 } : { y: "100%" }}
            transition={wide ? soft : sheetSpring}
            className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white outline-none"
            style={{ maxWidth: wide ? width : undefined, borderRadius: wide ? 22 : "22px 22px 0 0", boxShadow: "0 24px 60px rgba(0,0,0,0.22)", paddingBottom: wide ? 0 : "env(safe-area-inset-bottom)" }}>
            {!wide && <div className="mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-full" style={{ background: "#D1D1D6" }} />}
            <header className="flex items-center gap-2 px-5 pb-2 pt-4">
              <h2 className="min-w-0 flex-1 text-[20px] font-bold tracking-[-0.02em]" style={{ color: C.label }}>{title}</h2>
              {dismissible && <IconButton data-close label="Close" onClick={onClose} style={{ background: C.fill }} size={30}><IClose size={14} /></IconButton>}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-1">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Alert for consequential decisions: short message, explicit action labels. */
export function Alert({ open, onClose, title, message, actions, children }: { open: boolean; onClose: () => void; title: string; message?: ReactNode; actions: ReactNode; children?: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} width={420} footer={actions}>
      {message && <p className="text-[15px] leading-[1.45]" style={{ color: C.secondary }}>{message}</p>}
      {children}
    </Sheet>
  );
}
