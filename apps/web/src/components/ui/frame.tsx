// KiranaAI design kit, part 4: the app frame for the customer, merchant and admin apps.
// ≥ 840 px: a glass sidebar (brand, context, destinations, account). Below: a compact top bar and a translucent tab bar.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useMedia } from "../../lib/useMedia";
import { C, FONT, soft, spring } from "./kit";
import { cx } from "./controls";

export interface FrameNav {
  key: string;
  label: string;
  icon: ReactNode;
  to?: string;
  onSelect?: () => void;
  badge?: number;
}

export interface FrameAccount {
  name: string;
  role: string;
  switchLabel?: string;
  onSwitch: () => void;
}

function Target({ item, active, className, children }: { item: FrameNav; active: boolean; className: string; children: ReactNode }) {
  const common = { className, "aria-current": active ? ("page" as const) : undefined };
  return item.to ? <Link to={item.to} {...common} onClick={item.onSelect}>{children}</Link> : <button type="button" {...common} onClick={item.onSelect}>{children}</button>;
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function Brand({ context }: { context?: ReactNode }) {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label="KiranaAI home">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[13px] font-bold text-white" style={{ background: C.green }}>K</span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-tight" style={{ color: C.label }}>KiranaAI</span>
        {context && <span className="block truncate text-[12px] leading-tight" style={{ color: C.secondary }}>{context}</span>}
      </span>
    </Link>
  );
}

function AccountButton({ account, compact }: { account: FrameAccount; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Account: ${account.name}`}
        className={cx("flex cursor-pointer items-center gap-2.5 rounded-[12px] text-left transition-colors hover:bg-black/[0.04]", compact ? "p-1" : "w-full p-2")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold" style={{ background: "#E5E5EA", color: C.label }}>{initials(account.name)}</span>
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium" style={{ color: C.label }}>{account.name}</span>
            <span className="block text-[12px] first-letter:uppercase" style={{ color: C.secondary }}>{account.role}</span>
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, scale: 0.94, y: compact ? -4 : 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={soft}
            className={cx("absolute z-50 w-56 overflow-hidden rounded-[14px] bg-white py-1", compact ? "right-0 top-11 origin-top-right" : "bottom-14 left-0 origin-bottom-left")}
            style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.16)" }}>
            <p className="px-4 pb-1 pt-2 text-[12px]" style={{ color: C.secondary }}>Signed in as {account.name}</p>
            <button role="menuitem" type="button" onClick={() => { setOpen(false); account.onSwitch(); }} className="block w-full cursor-pointer px-4 py-2.5 text-left text-[15px] hover:bg-black/[0.04]" style={{ color: C.blue }}>
              {account.switchLabel ?? "Switch persona"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Customer, merchant and admin apps share this frame. Pages render their own large title and content. */
export function AppFrame({ nav, active, label, context, account, children, maxWidth = 1120 }: {
  nav: FrameNav[];
  active: string;
  label: string;
  context?: ReactNode;
  account?: FrameAccount;
  children: ReactNode;
  maxWidth?: number;
}) {
  const wide = useMedia("(min-width: 840px)");
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--snackbar-offset", wide ? "0px" : "84px");
    return () => { root.style.removeProperty("--snackbar-offset"); };
  }, [wide]);

  if (wide) {
    return (
      <div className="flex min-h-dvh" style={{ background: C.bg, fontFamily: FONT, color: C.label }}>
        <nav aria-label={label} className="sticky top-0 flex h-dvh w-[248px] shrink-0 flex-col px-3 pb-3 pt-5"
          style={{ background: "rgba(246,246,248,0.8)", backdropFilter: "blur(30px) saturate(180%)", WebkitBackdropFilter: "blur(30px) saturate(180%)", boxShadow: "inset -0.5px 0 0 rgba(0,0,0,0.1)" }}>
          <div className="px-2 pb-6"><Brand context={context} /></div>
          <ul className="space-y-0.5">
            {nav.map((it) => {
              const sel = it.key === active;
              return (
                <li key={it.key} className="relative">
                  {sel && <motion.span layoutId={`frame-sel-${label}`} transition={spring} className="absolute inset-0 rounded-[10px]" style={{ background: "rgba(0,0,0,0.06)" }} />}
                  <Target item={it} active={sel} className="relative flex h-10 w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 text-left text-[15px] transition-colors hover:bg-black/[0.03]">
                    <span style={{ color: sel ? C.green : C.secondary }}>{it.icon}</span>
                    <span className="flex-1" style={{ color: C.label, fontWeight: sel ? 600 : 400 }}>{it.label}</span>
                    {!!it.badge && <span className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-semibold text-white" style={{ background: C.red }} aria-label={`${it.badge} pending`}>{it.badge}</span>}
                  </Target>
                </li>
              );
            })}
          </ul>
          {account && <div className="mt-auto"><AccountButton account={account} /></div>}
        </nav>
        <main className="min-w-0 flex-1 px-10 pb-12 pt-8">
          <div className="mx-auto w-full" style={{ maxWidth }}>{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh" style={{ background: C.bg, fontFamily: FONT, color: C.label }}>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 px-4"
        style={{ background: "rgba(245,245,247,0.82)", backdropFilter: "blur(30px) saturate(180%)", WebkitBackdropFilter: "blur(30px) saturate(180%)", boxShadow: "inset 0 -0.5px 0 rgba(0,0,0,0.1)" }}>
        <div className="min-w-0 flex-1"><Brand context={context} /></div>
        {account && <AccountButton account={account} compact />}
      </header>
      <main className="px-4 pb-28 pt-4">{children}</main>
      {nav.length > 1 && (
        <nav aria-label={label} className="fixed inset-x-0 bottom-0 z-30 flex h-[64px] pb-[env(safe-area-inset-bottom)]"
          style={{ background: "rgba(250,250,252,0.86)", backdropFilter: "blur(30px) saturate(180%)", WebkitBackdropFilter: "blur(30px) saturate(180%)", boxShadow: "inset 0 0.5px 0 rgba(0,0,0,0.12)" }}>
          {nav.map((it) => {
            const sel = it.key === active;
            return (
              <Target key={it.key} item={it} active={sel} className="relative flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5">
                <span className="relative" style={{ color: sel ? C.green : "#8E8E93" }}>
                  {it.icon}
                  {!!it.badge && <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white" style={{ background: C.red }} aria-label={`${it.badge} pending`}>{it.badge}</span>}
                </span>
                <span className="text-[10px] font-medium" style={{ color: sel ? C.green : "#8E8E93" }}>{it.label}</span>
              </Target>
            );
          })}
        </nav>
      )}
    </div>
  );
}
