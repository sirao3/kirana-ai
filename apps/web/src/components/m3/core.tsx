import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { secondsUntil } from "../../lib/format";

/*
 * Material 3 building blocks for the web app (custom implementation; no official M3 web library).
 * Every component uses the semantic colour roles from index.css, M3 state layers and focus rings.
 */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Icon (Material Symbols Rounded) ----------

export function Icon({ name, filled, size = 24, className = "", label }: { name: string; filled?: boolean; size?: number; className?: string; label?: string }) {
  return (
    <span
      className={cx("material-symbols-rounded", filled && "filled", className)}
      style={{ fontSize: size, width: size, height: size }}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {name}
    </span>
  );
}

// ---------- Buttons ----------

export type ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "elevated" | "danger" | "danger-outlined";
const BUTTON: Record<ButtonVariant, string> = {
  filled: "bg-primary text-on-primary hover:shadow-1",
  tonal: "bg-secondary-container text-on-secondary-container hover:shadow-1",
  outlined: "border border-outline-variant text-primary",
  text: "text-primary",
  elevated: "bg-surface-container-low text-primary shadow-1 hover:shadow-2",
  danger: "bg-error text-on-error hover:shadow-1",
  "danger-outlined": "border border-error text-error",
};
const BUTTON_DISABLED: Record<ButtonVariant, string> = {
  filled: "disabled:bg-on-surface/12",
  tonal: "disabled:bg-on-surface/12",
  outlined: "disabled:border-on-surface/12",
  text: "",
  elevated: "disabled:bg-on-surface/12",
  danger: "disabled:bg-on-surface/12",
  "danger-outlined": "disabled:border-on-surface/12",
};
const SIZE = {
  sm: "h-8 px-3 gap-1.5 type-label-large",
  md: "h-10 px-6 gap-2 type-label-large",
  lg: "h-14 px-8 gap-2.5 type-title-medium",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof SIZE;
  icon?: string;
  trailingIcon?: string;
  loading?: boolean;
  /** M3 Expressive: the shape morphs from round to squarer while pressed. Use on hero actions only. */
  expressive?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "filled", size = "md", icon, trailingIcon, loading, expressive, className, children, disabled, ...rest },
  ref,
) {
  const iconSize = size === "lg" ? 24 : 18;
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "state-layer touch-target inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-full",
        "transition-[box-shadow,border-radius,background-color] duration-200 ease-standard",
        "disabled:cursor-not-allowed disabled:text-on-surface/38 disabled:shadow-none",
        BUTTON[variant],
        BUTTON_DISABLED[variant],
        SIZE[size],
        icon && size === "md" && "pl-4",
        trailingIcon && size === "md" && "pr-4",
        expressive && "active:rounded-lg",
        className,
      )}
      {...rest}
    >
      {loading ? <CircularProgress size={iconSize} /> : icon && <Icon name={icon} size={iconSize} />}
      {children}
      {trailingIcon && !loading && <Icon name={trailingIcon} size={iconSize} />}
    </button>
  );
});

export type IconButtonVariant = "standard" | "filled" | "tonal" | "outlined";
const ICON_BUTTON: Record<IconButtonVariant, string> = {
  standard: "text-on-surface-variant",
  filled: "bg-primary text-on-primary disabled:bg-on-surface/12",
  tonal: "bg-secondary-container text-on-secondary-container disabled:bg-on-surface/12",
  outlined: "border border-outline-variant text-on-surface-variant disabled:border-on-surface/12",
};

/** Icon-only button. `label` is required: it is the accessible name and the tooltip. */
export function IconButton({
  icon, label, variant = "standard", selected, size = 40, filledIcon, className, ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { icon: string; label: string; variant?: IconButtonVariant; selected?: boolean; size?: 32 | 40 | 48; filledIcon?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={selected}
      className={cx(
        "state-layer touch-target inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:text-on-surface/38",
        ICON_BUTTON[variant],
        selected && variant === "standard" && "text-primary",
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} size={size === 32 ? 20 : 24} filled={filledIcon || selected} />
    </button>
  );
}

/** FAB / extended FAB: only for the screen's dominant action. */
export function Fab({ icon, label, extended, className, variant = "primary", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; extended?: ReactNode; variant?: "primary" | "surface" }) {
  return (
    <button
      aria-label={extended ? undefined : label}
      title={extended ? undefined : label}
      className={cx(
        "state-layer inline-flex h-14 cursor-pointer items-center justify-center gap-3 rounded-lg shadow-3 transition-shadow duration-200 hover:shadow-[0_6px_10px_4px_rgb(0_0_0/0.15),0_2px_3px_rgb(0_0_0/0.3)]",
        variant === "primary" ? "bg-primary-container text-on-primary-container" : "bg-surface-container-high text-primary",
        extended ? "px-4 pr-5 type-label-large" : "w-14",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
      {extended}
    </button>
  );
}

// ---------- Containment ----------

export type CardVariant = "filled" | "elevated" | "outlined";
const CARD: Record<CardVariant, string> = {
  filled: "bg-surface-container-highest",
  elevated: "bg-surface-container-low shadow-1",
  outlined: "bg-surface border border-outline-variant",
};

export function Card({ variant = "outlined", className, children, ...rest }: HTMLAttributes<HTMLElement> & { variant?: CardVariant }) {
  return (
    <section className={cx("rounded-md", CARD[variant], className)} {...rest}>
      {children}
    </section>
  );
}

/** Section heading row inside a page or card: title + optional supporting text and trailing actions. */
export function SectionHeader({ title, subtitle, actions, as: As = "h2", className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; as?: "h1" | "h2" | "h3"; className?: string }) {
  return (
    <header className={cx("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <As className="type-title-medium text-on-surface">{title}</As>
        {subtitle && <p className="type-body-medium text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Divider({ className, inset }: { className?: string; inset?: boolean }) {
  return <hr className={cx("border-0 border-t border-outline-variant", inset && "ml-4", className)} />;
}

// ---------- Status ----------

export type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "error";
const TONE_CONTAINER: Record<Tone, string> = {
  neutral: "bg-surface-container-highest text-on-surface-variant",
  primary: "bg-secondary-container text-on-secondary-container",
  info: "bg-tertiary-container text-on-tertiary-container",
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  error: "bg-error-container text-on-error-container",
};

/** Non-interactive status label. Always carries text (and usually an icon), never colour alone. */
export function StatusLabel({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: string; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 type-label-medium whitespace-nowrap", TONE_CONTAINER[tone], className)}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </span>
  );
}

/** Small count badge anchored to an icon (navigation items). */
export function Badge({ count, label }: { count?: number; label?: string }) {
  if (count === undefined) return <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-error" aria-label={label} />;
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 type-label-small text-on-error" aria-label={label}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Banner-style inline message for persistent state, placed next to the affected content, with an optional recovery action. */
export function InlineMessage({ tone = "info", icon, title, children, action, className, live = true }: {
  tone?: Exclude<Tone, "neutral" | "primary">;
  icon?: string;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  live?: boolean;
}) {
  const defaultIcon = { info: "info", success: "check_circle", warning: "warning", error: "error" }[tone];
  return (
    <div
      role={live ? (tone === "error" ? "alert" : "status") : undefined}
      className={cx("flex flex-wrap items-start gap-3 rounded-md p-4", TONE_CONTAINER[tone], className)}
    >
      <Icon name={icon ?? defaultIcon} className="mt-px" />
      <div className="min-w-0 flex-1 type-body-medium">
        {title && <p className="type-title-small">{title}</p>}
        {children}
      </div>
      {action && <div className="flex w-full justify-end gap-2 sm:w-auto">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon: string; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant">
        <Icon name={icon} size={32} />
      </span>
      <p className="type-title-medium text-on-surface">{title}</p>
      {children && <div className="max-w-sm type-body-medium text-on-surface-variant">{children}</div>}
      {action}
    </div>
  );
}

// ---------- Progress ----------

export function LinearProgress({ value, label, className }: { value?: number; label?: string; className?: string }) {
  const det = value !== undefined;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={det ? 0 : undefined}
      aria-valuemax={det ? 100 : undefined}
      aria-valuenow={det ? Math.round(value * 100) : undefined}
      className={cx("relative h-1 w-full overflow-hidden rounded-full bg-secondary-container", className)}
    >
      {det ? (
        <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-standard" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
      ) : (
        <div className="absolute inset-y-0 animate-indeterminate rounded-full bg-primary" />
      )}
    </div>
  );
}

export function CircularProgress({ size = 24, className, label }: { size?: number; className?: string; label?: string }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cx("animate-spin", className)} role={label ? "progressbar" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={size > 30 ? 4 : 2.5} strokeLinecap="round" strokeDasharray={`${c * 0.7} ${c}`} />
    </svg>
  );
}

/** M3 Expressive-style loading indicator for "the assistant is working" (three pulsing shapes). */
export function LoadingDots({ label = "Working" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-2.5 w-2.5 animate-dots rounded-full bg-primary" style={{ animationDelay: `${i * 160}ms`, borderRadius: i === 1 ? 3 : 999 }} />
      ))}
    </span>
  );
}

// ---------- Time ----------

/** Live "mm:ss" countdown to an ISO time; calls onDone once at zero. */
export function Countdown({ until, onDone }: { until: string | null; onDone?: () => void }) {
  const [left, setLeft] = useState(() => secondsUntil(until));
  useEffect(() => {
    setLeft(secondsUntil(until));
    const t = setInterval(() => {
      const s = secondsUntil(until);
      setLeft(s);
      if (s === 0) {
        clearInterval(t);
        onDone?.();
      }
    }, 250);
    return () => clearInterval(t);
  }, [until, onDone]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return <span className="font-mono tabular-nums">{mm}:{ss}</span>;
}

/** Circular avatar with initials, coloured by a stable hash into the container roles. */
export function Avatar({ name, size = 40, icon }: { name: string; size?: number; icon?: string }) {
  const tones = ["bg-primary-container text-on-primary-container", "bg-secondary-container text-on-secondary-container", "bg-tertiary-container text-on-tertiary-container"];
  const h = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full type-title-medium", tones[h % tones.length])} style={{ width: size, height: size }} aria-hidden>
      {icon ? <Icon name={icon} size={size * 0.55} /> : initials}
    </span>
  );
}
