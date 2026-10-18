// KiranaAI design kit, part 2: controls. Same proportions everywhere: 32 / 44 / 54 pt heights, 10–16 pt radii.
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { motion } from "motion/react";
import { C, IMinus, IPlus, ISearch, Spinner, spring } from "./kit";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Buttons ----------

export type ButtonVariant = "primary" | "secondary" | "tinted" | "plain" | "destructive" | "danger";
const BTN: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: C.label, color: "#fff" },
  secondary: { background: C.fill, color: C.label },
  tinted: { background: "rgba(31,138,62,0.12)", color: C.green },
  plain: { background: "transparent", color: C.blue },
  destructive: { background: "rgba(229,55,43,0.10)", color: C.red },
  danger: { background: C.red, color: "#fff" },
};
const SIZE = { sm: "h-8 px-3 text-[13px] rounded-[10px] gap-1.5", md: "h-11 px-4 text-[15px] rounded-[12px] gap-2", lg: "h-[54px] px-6 text-[17px] rounded-[16px] gap-2" } as const;

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onDrag" | "onDragEnd" | "onDragStart" | "style"> {
  variant?: ButtonVariant;
  size?: keyof typeof SIZE;
  icon?: ReactNode;
  busy?: boolean;
  full?: boolean;
  style?: React.CSSProperties;
}

/** The one button. Press compresses to 0.97; busy swaps the icon for a spinner and keeps the width. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, busy, full, disabled, className, children, style, type = "button", ...rest },
  ref,
) {
  const off = disabled || busy;
  return (
    <motion.button ref={ref} type={type} disabled={off} aria-busy={busy || undefined} whileTap={off ? undefined : { scale: 0.97 }} transition={spring}
      className={cx("inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap font-semibold transition-opacity disabled:cursor-default disabled:opacity-45", SIZE[size], full && "w-full", className)}
      style={{ ...BTN[variant], ...style }} {...rest}>
      {busy ? <Spinner size={size === "lg" ? 20 : 16} color={variant === "primary" || variant === "danger" ? "#fff" : C.secondary} /> : icon}
      {children}
    </motion.button>
  );
});

/** Icon-only button; `label` is the accessible name and the tooltip. */
export function IconButton({ label, children, size = 36, className, style, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onDrag" | "onDragEnd" | "onDragStart"> & { label: string; size?: number }) {
  return (
    <motion.button type="button" aria-label={label} title={label} whileTap={{ scale: 0.92 }} transition={spring}
      className={cx("inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-black/[0.05] disabled:cursor-default disabled:opacity-40", className)}
      style={{ width: size, height: size, color: C.secondary, ...style }} {...rest}>
      {children}
    </motion.button>
  );
}

// ---------- Segmented control ----------

/** iOS segmented control. The thumb slides between peers. */
export function Segmented<T extends string>({ value, onChange, options, label, className, size = "md" }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; badge?: number }[]; label: string; className?: string; size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="tablist" aria-label={label} className={cx("inline-flex rounded-[10px] p-[2px]", className)} style={{ background: "rgba(118,118,128,0.12)" }}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={sel} onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === value);
              if (e.key === "ArrowRight") onChange(options[(i + 1) % options.length]!.value);
              if (e.key === "ArrowLeft") onChange(options[(i - 1 + options.length) % options.length]!.value);
            }}
            tabIndex={sel ? 0 : -1}
            className={cx("relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium", size === "sm" ? "h-7 px-3 text-[13px]" : "h-8 px-4 text-[14px]")}
            style={{ color: C.label }}>
            {sel && <motion.span layoutId={`seg-${id}`} transition={spring} className="absolute inset-0 rounded-[8px] bg-white" style={{ boxShadow: "0 3px 8px rgba(0,0,0,0.12), 0 3px 1px rgba(0,0,0,0.04)" }} />}
            <span className={cx("relative", sel && "font-semibold")}>{o.label}</span>
            {!!o.badge && <span className="relative flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white" style={{ background: C.red }}>{o.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Switch ----------

export function Switch({ checked, onChange, label, hideLabel, disabled, busy, className }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hideLabel?: boolean; disabled?: boolean; busy?: boolean; className?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={hideLabel ? label : undefined} aria-busy={busy || undefined} disabled={disabled || busy}
      onClick={() => onChange(!checked)} className={cx("inline-flex shrink-0 cursor-pointer items-center gap-2.5 disabled:cursor-default disabled:opacity-50", className)}>
      {!hideLabel && <span className="text-[15px]" style={{ color: C.label }}>{label}</span>}
      <motion.span className="relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full p-[2px]" initial={false}
        animate={{ backgroundColor: checked ? "#34C759" : "rgba(120,120,128,0.24)" }} transition={{ duration: 0.2 }}>
        <motion.span className="h-[27px] w-[27px] rounded-full bg-white" initial={false} animate={{ x: checked ? 20 : 0 }} transition={spring}
          style={{ boxShadow: "0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.16)" }} />
      </motion.span>
    </button>
  );
}

// ---------- Fields ----------

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix" | "onChange" | "value"> {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  prefix?: ReactNode;
  suffix?: ReactNode;
  trailing?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
}

/** Label above, rounded filled field, 2 pt accent ring on focus, help or error below (linked for screen readers). */
export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, value, onValueChange, prefix, suffix, trailing, help, error, hideLabel, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  const hid = `${fid}-help`;
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={fid} className={cx("mb-1.5 block text-[13px] font-medium", hideLabel && "sr-only")} style={{ color: C.secondary }}>{label}</label>
      <div className="flex h-11 items-center gap-1.5 rounded-[12px] bg-white px-3 focus-within:ring-2"
        style={{ boxShadow: `inset 0 0 0 1px ${error ? C.red : "rgba(60,60,67,0.18)"}`, ["--tw-ring-color" as string]: error ? C.red : C.blue }}>
        {prefix && <span className="text-[15px]" style={{ color: C.secondary }}>{prefix}</span>}
        <input ref={ref} id={fid} value={value} onChange={(e) => onValueChange(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={help || error ? hid : undefined}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#AEAEB2]" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }} {...rest} />
        {suffix && <span className="text-[15px]" style={{ color: C.secondary }}>{suffix}</span>}
        {trailing}
      </div>
      {(error || help) && <p id={hid} className="mt-1.5 text-[12px]" style={{ color: error ? C.red : C.secondary }}>{error ?? help}</p>}
    </div>
  );
});

/** Search field: magnifier, rounded 12, optional spinner and trailing control. The label is visually hidden. */
export const SearchField = forwardRef<HTMLInputElement, Omit<FieldProps, "prefix" | "suffix" | "help" | "error" | "hideLabel"> & { busy?: boolean }>(function SearchField(
  { label, value, onValueChange, trailing, busy, className, ...rest },
  ref,
) {
  return (
    <div className={cx("flex h-11 items-center gap-2 rounded-[12px] px-3", className)} style={{ background: "rgba(118,118,128,0.12)" }}>
      <span style={{ color: C.secondary }}><ISearch size={17} /></span>
      <input ref={ref} type="search" aria-label={label} value={value} onChange={(e) => onValueChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#8E8E93]" style={{ color: C.label }} {...rest} />
      {busy && <Spinner size={15} />}
      {trailing}
    </div>
  );
});

/** − n + stepper for pack counts. */
export function Stepper({ value, onChange, min = 1, max = 99, label, disabled }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string; disabled?: boolean }) {
  const btn = "flex h-8 w-9 cursor-pointer items-center justify-center disabled:cursor-default disabled:opacity-35";
  return (
    <span role="group" aria-label={label} className="inline-flex items-center rounded-[10px]" style={{ background: C.fill }}>
      <button type="button" className={btn} aria-label={`Fewer: ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)} style={{ color: C.label }}><IMinus size={15} /></button>
      <span className="min-w-6 text-center text-[15px] font-semibold" style={{ fontVariantNumeric: "tabular-nums", color: C.label }} aria-live="polite">{value}</span>
      <button type="button" className={btn} aria-label={`More: ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} style={{ color: C.label }}><IPlus size={15} /></button>
    </span>
  );
}

/** Pill toggle for a small set of choices (reasons, filters). */
export function Chip({ selected, children, onClick, className }: { selected?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick}
      className={cx("inline-flex min-h-8 cursor-pointer items-center rounded-full px-3 text-[13px] font-medium transition-colors", className)}
      style={selected ? { background: C.label, color: "#fff" } : { background: C.fill, color: C.label }}>
      {children}
    </button>
  );
}

/** Native checkbox with a 44 pt row. */
export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]", disabled && "cursor-default opacity-50")} style={{ color: C.label }}>
      <input type="checkbox" className="h-[18px] w-[18px] cursor-pointer" style={{ accentColor: C.green }} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
