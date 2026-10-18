import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useThemeMode, type ThemeMode } from "../../lib/theme";
import { Avatar, Badge, cx, Icon, IconButton } from "./core";
import { rovingKeys } from "./inputs";
import { Menu } from "./overlays";

// ---------- Top app bar ----------

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

/** Small top app bar: navigation icon, title, trailing actions. Gains a container tone once content scrolls under it. */
export function TopAppBar({ title, subtitle, leading, actions, className }: { title: ReactNode; subtitle?: ReactNode; leading?: ReactNode; actions?: ReactNode; className?: string }) {
  const scrolled = useScrolled();
  return (
    <header
      className={cx(
        "sticky top-0 z-30 flex h-16 shrink-0 items-center gap-1 px-1 transition-colors duration-200 ease-standard sm:px-3",
        scrolled ? "bg-surface-container" : "bg-surface",
        className,
      )}
    >
      {leading ?? <span className="w-3" />}
      <div className="min-w-0 flex-1 px-1">
        <h1 className="truncate type-title-large text-on-surface">{title}</h1>
        {subtitle && <p className="-mt-0.5 truncate type-body-small text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

/** Brand mark used as the leading element on top-level screens. */
export function BrandMark({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} aria-label="KiranaAI home" className="state-layer flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-primary">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-container text-on-primary-container">
        <Icon name="storefront" filled size={22} />
      </span>
    </Link>
  );
}

const THEME_NEXT: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON: Record<ThemeMode, string> = { system: "brightness_auto", light: "light_mode", dark: "dark_mode" };

export function ThemeToggle() {
  const [mode, setMode] = useThemeMode();
  return <IconButton icon={THEME_ICON[mode]} label={`Theme: ${mode} (switch to ${THEME_NEXT[mode]})`} onClick={() => setMode(THEME_NEXT[mode])} />;
}

/** Avatar button that opens the account menu (who you are + switch persona). */
export function AccountMenu({ name, role, onSwitch, switchLabel = "Switch persona" }: { name: string; role: string; onSwitch: () => void; switchLabel?: string }) {
  return (
    <Menu
      trigger={(p) => (
        <button {...p} aria-label={`Account: ${name}`} title={name} className="state-layer flex h-12 w-12 cursor-pointer items-center justify-center rounded-full">
          <Avatar name={name} size={32} />
        </button>
      )}
      header={
        <div className="flex items-center gap-3">
          <Avatar name={name} />
          <div className="min-w-0">
            <p className="truncate type-title-small text-on-surface">{name}</p>
            <p className="type-body-small capitalize text-on-surface-variant">{role}</p>
          </div>
        </div>
      }
      items={[{ label: switchLabel, icon: "switch_account", onSelect: onSwitch }]}
    />
  );
}

// ---------- Navigation rail / bar ----------

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  to?: string;
  onSelect?: () => void;
  badge?: number;
}

function NavTarget({ item, active, className, children }: { item: NavItem; active: boolean; className: string; children: ReactNode }) {
  const common = { className, "aria-current": active ? ("page" as const) : undefined };
  return item.to ? (
    <Link to={item.to} {...common} onClick={item.onSelect}>{children}</Link>
  ) : (
    <button type="button" {...common} onClick={item.onSelect}>{children}</button>
  );
}

function badgeLabel(item: NavItem) {
  return item.badge ? `${item.badge} pending` : undefined;
}

export function NavigationRail({ items, active, fab, label }: { items: NavItem[]; active: string; fab?: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col items-center gap-3 bg-surface pt-11 sm:flex">
      {fab && <div className="mb-4">{fab}</div>}
      {items.map((it) => {
        const sel = it.key === active;
        return (
          <NavTarget key={it.key} item={it} active={sel} className="group flex w-20 cursor-pointer flex-col items-center gap-1 pb-1 focus-visible:outline-none">
            <span className={cx("state-layer relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ease-standard group-focus-visible:outline-3 group-focus-visible:outline-secondary", sel ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant")}>
              <Icon name={it.icon} filled={sel} />
              {!!it.badge && <Badge count={it.badge} label={badgeLabel(it)} />}
            </span>
            <span className={cx("type-label-medium", sel ? "text-on-surface" : "text-on-surface-variant")}>{it.label}</span>
          </NavTarget>
        );
      })}
    </nav>
  );
}

export function NavigationBar({ items, active, label }: { items: NavItem[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="fixed inset-x-0 bottom-0 z-30 flex h-20 bg-surface-container pb-[env(safe-area-inset-bottom)] sm:hidden">
      {items.map((it) => {
        const sel = it.key === active;
        return (
          <NavTarget key={it.key} item={it} active={sel} className="group flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 focus-visible:outline-none">
            <span className={cx("state-layer relative flex h-8 w-16 items-center justify-center rounded-full transition-colors duration-200 ease-standard group-focus-visible:outline-3 group-focus-visible:outline-secondary", sel ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant")}>
              <Icon name={it.icon} filled={sel} />
              {!!it.badge && <Badge count={it.badge} label={badgeLabel(it)} />}
            </span>
            <span className={cx("type-label-medium", sel ? "text-on-surface" : "text-on-surface-variant")}>{it.label}</span>
          </NavTarget>
        );
      })}
    </nav>
  );
}

/**
 * Adaptive scaffold: navigation bar below 600 px, navigation rail from 600 px; the same destinations in the same order.
 * Sets --snackbar-offset so snackbars clear the navigation bar.
 */
export function AppShell({ nav, active, navLabel, topBar, children, railFab }: {
  nav?: NavItem[];
  active?: string;
  navLabel?: string;
  topBar: ReactNode;
  children: ReactNode;
  railFab?: ReactNode;
}) {
  const hasNav = !!nav?.length;
  useEffect(() => {
    if (!hasNav) return;
    const root = document.documentElement;
    const mq = window.matchMedia("(max-width: 599.98px)");
    const apply = () => root.style.setProperty("--snackbar-offset", mq.matches ? "80px" : "0px");
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      root.style.removeProperty("--snackbar-offset");
    };
  }, [hasNav]);
  return (
    <div className="flex min-h-dvh bg-surface">
      {hasNav && <NavigationRail items={nav!} active={active ?? ""} label={navLabel ?? "Main"} fab={railFab} />}
      <div className={cx("flex min-w-0 flex-1 flex-col", hasNav && "pb-20 sm:pb-0")}>
        {topBar}
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
      {hasNav && <NavigationBar items={nav!} active={active ?? ""} label={navLabel ?? "Main"} />}
    </div>
  );
}

// ---------- Tabs ----------

export function Tabs<T extends string>({ value, onChange, tabs, label, className }: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string; icon?: string; badge?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} onKeyDown={rovingKeys} className={cx("flex border-b border-outline-variant", className)}>
      {tabs.map((t) => {
        const sel = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            id={`tab-${t.value}`}
            aria-selected={sel}
            aria-controls={`panel-${t.value}`}
            tabIndex={sel ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cx("state-layer relative flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 px-4 type-title-small sm:flex-none", sel ? "text-primary" : "text-on-surface-variant")}
          >
            {t.icon && <Icon name={t.icon} size={20} filled={sel} />}
            {t.label}
            {!!t.badge && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 type-label-small text-on-error">{t.badge}</span>}
            <span className={cx("absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary transition-opacity", sel ? "opacity-100" : "opacity-0")} />
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ value, active, children, className }: { value: string; active: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`panel-${value}`} aria-labelledby={`tab-${value}`} hidden={value !== active} className={className}>
      {children}
    </div>
  );
}
