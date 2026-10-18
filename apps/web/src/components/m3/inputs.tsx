import { forwardRef, useId, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from "react";
import { cx, Icon, IconButton } from "./core";

// ---------- Filled text field (persistent floating label, supporting/error text) ----------

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "prefix" | "size"> {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  supportingText?: ReactNode;
  error?: string | null;
  leadingIcon?: string;
  prefix?: string;
  suffix?: string;
  trailing?: ReactNode;
  /** Shorter field for dense rows. */
  dense?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, value, onValueChange, supportingText, error, leadingIcon, prefix, suffix, trailing, dense, className, id, disabled, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  const helpId = `${fieldId}-help`;
  const floated = !!prefix || !!suffix;
  const help = error ?? supportingText;
  return (
    <div className={cx("min-w-0", className)}>
      <div
        className={cx(
          "group relative flex items-center rounded-t-xs bg-surface-container-highest",
          "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-on-surface-variant after:transition-all focus-within:after:h-0.5",
          error ? "after:bg-error! focus-within:after:bg-error" : "focus-within:after:bg-primary",
          disabled && "opacity-38",
          dense ? "h-12" : "h-14",
        )}
      >
        {leadingIcon && <Icon name={leadingIcon} className="ml-3 text-on-surface-variant" />}
        <div className={cx("relative flex h-full min-w-0 flex-1 items-end", leadingIcon ? "pl-3" : "pl-4", trailing ? "pr-1" : "pr-4", dense ? "pb-1.5" : "pb-2")}>
          {prefix && <span className="mr-0.5 type-body-large text-on-surface-variant">{prefix}</span>}
          <input
            ref={ref}
            id={fieldId}
            value={value}
            placeholder=" "
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={help ? helpId : undefined}
            onChange={(e) => onValueChange(e.target.value)}
            className="peer w-full min-w-0 bg-transparent type-body-large text-on-surface caret-primary outline-none focus-visible:outline-none"
            {...rest}
          />
          {suffix && <span className="ml-1 type-body-large text-on-surface-variant">{suffix}</span>}
          <label
            htmlFor={fieldId}
            className={cx(
              "pointer-events-none absolute truncate transition-all duration-150 ease-standard",
              leadingIcon ? "left-3" : "left-4",
              "right-4",
              error ? "text-error" : "text-on-surface-variant group-focus-within:text-primary",
              dense ? "top-1" : "top-2",
              "type-body-small",
              !floated && (dense ? "peer-placeholder-shown:top-3 peer-placeholder-shown:type-body-large" : "peer-placeholder-shown:top-4 peer-placeholder-shown:type-body-large"),
              !floated && (dense ? "peer-focus:top-1! peer-focus:type-body-small!" : "peer-focus:top-2! peer-focus:type-body-small!"),
            )}
          >
            {label}
            {rest.required && <span aria-hidden> *</span>}
          </label>
        </div>
        {error && !trailing && <Icon name="error" className="mr-3 text-error" />}
        {trailing}
      </div>
      {help && (
        <p id={helpId} className={cx("px-4 pt-1 type-body-small", error ? "text-error" : "text-on-surface-variant")}>
          {help}
        </p>
      )}
    </div>
  );
});

export function SelectField({ label, children, className, supportingText, id, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; supportingText?: ReactNode }) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={cx("min-w-0", className)}>
      <div className="group relative h-14 rounded-t-xs bg-surface-container-highest after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-on-surface-variant focus-within:after:h-0.5 focus-within:after:bg-primary">
        <label htmlFor={fieldId} className="pointer-events-none absolute left-4 right-10 top-2 truncate type-body-small text-on-surface-variant group-focus-within:text-primary">
          {label}
        </label>
        <select
          id={fieldId}
          className="h-full w-full cursor-pointer appearance-none bg-transparent pb-1.5 pl-4 pr-10 pt-5 type-body-large text-on-surface outline-none focus-visible:outline-none [&>option]:bg-surface-container [&>option]:text-on-surface"
          {...rest}
        >
          {children}
        </select>
        <Icon name="arrow_drop_down" className="pointer-events-none absolute right-3 top-4 text-on-surface-variant" />
      </div>
      {supportingText && <p className="px-4 pt-1 type-body-small text-on-surface-variant">{supportingText}</p>}
    </div>
  );
}

/** Compact outlined number cell for data tables (accessible name via `label`). */
export const CellField = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & { label: string; state?: "idle" | "saving" | "error"; prefix?: string }>(function CellField(
  { label, state = "idle", prefix, className, ...rest },
  ref,
) {
  return (
    <span
      className={cx(
        "inline-flex h-10 items-center rounded-xs border bg-surface px-2 transition-colors focus-within:border-2 focus-within:px-[7px]",
        state === "error" ? "border-error focus-within:border-error" : "border-outline focus-within:border-primary",
        state === "saving" && "opacity-60",
        className,
      )}
    >
      {prefix && <span className="mr-0.5 type-body-medium text-on-surface-variant">{prefix}</span>}
      <input ref={ref} aria-label={label} aria-invalid={state === "error" || undefined} className="w-full min-w-0 bg-transparent text-right type-body-medium tabular-nums text-on-surface outline-none focus-visible:outline-none" {...rest} />
    </span>
  );
});

/** M3 search bar: a pill on surface-container-high with a leading search icon. Submitting runs onSubmit. */
export function SearchBar({ value, onValueChange, onSubmit, placeholder, label, trailing, busy, autoFocus, inputProps }: {
  /** Extra attributes for the input (combobox ARIA, key handlers). */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  value: string;
  onValueChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder: string;
  label: string;
  trailing?: ReactNode;
  busy?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <form
      role="search"
      className="flex h-14 items-center gap-1 rounded-full bg-surface-container-high pl-4 pr-1 transition-shadow focus-within:shadow-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Icon name="search" className="text-on-surface-variant" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        {...inputProps}
        onChange={(e) => onValueChange(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent px-2 type-body-large text-on-surface outline-none placeholder:text-on-surface-variant focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && !busy && <IconButton icon="close" label="Clear search" type="button" onClick={() => onValueChange("")} />}
      {trailing}
    </form>
  );
}

// ---------- Selection ----------

/** M3 switch: applies immediately. `label` is shown beside it unless `hideLabel`. */
export function Switch({ checked, onChange, label, hideLabel, disabled, busy, className, labelClassName }: {
  labelClassName?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cx("group inline-flex min-h-12 shrink-0 cursor-pointer items-center gap-3 rounded-full disabled:cursor-not-allowed disabled:opacity-38 focus-visible:outline-none", className)}
    >
      {!hideLabel && <span className={cx("type-label-large text-on-surface", labelClassName)}>{label}</span>}
      <span
        className={cx(
          "relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border-2 transition-colors duration-200 ease-standard group-focus-visible:outline-3 group-focus-visible:outline-offset-2 group-focus-visible:outline-secondary",
          checked ? "border-primary bg-primary" : "border-outline bg-surface-container-highest",
        )}
      >
        <span
          className={cx(
            "absolute flex items-center justify-center rounded-full transition-all duration-200 ease-standard",
            "before:absolute before:-inset-2 before:rounded-full before:bg-current before:opacity-0 group-hover:before:opacity-8",
            checked ? "left-[22px] h-6 w-6 bg-on-primary text-on-primary-container" : "left-1.5 h-4 w-4 bg-outline text-surface-container-highest group-active:left-0.5 group-active:h-7 group-active:w-7",
          )}
        >
          {checked && <Icon name="check" size={16} className="relative" />}
        </span>
      </span>
    </button>
  );
}

export function Checkbox({ checked, onChange, label, disabled, describedBy }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; describedBy?: string }) {
  return (
    <label className={cx("inline-flex min-h-12 cursor-pointer items-center gap-3 type-body-large text-on-surface", disabled && "cursor-not-allowed opacity-38")}>
      <span className="state-layer flex h-10 w-10 items-center justify-center rounded-full text-primary">
        <input type="checkbox" className="h-[18px] w-[18px] cursor-pointer accent-primary" checked={checked} disabled={disabled} aria-describedby={describedBy} onChange={(e) => onChange(e.target.checked)} />
      </span>
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/** Single-select segmented button. */
export function SegmentedButton<T extends string>({ value, onChange, options, label, className }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: string; badge?: number; badgeLabel?: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("inline-flex min-h-10 overflow-hidden rounded-full border border-outline", className)}>
      {options.map((o, i) => {
        const sel = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={sel}
            onClick={() => onChange(o.value)}
            className={cx(
              "state-layer flex flex-1 cursor-pointer items-center justify-center gap-2 px-4 type-label-large",
              i > 0 && "border-l border-outline",
              sel ? "bg-secondary-container text-on-secondary-container" : "text-on-surface",
            )}
          >
            {sel ? <Icon name="check" size={18} /> : o.icon && <Icon name={o.icon} size={18} />}
            {o.label}
            {!!o.badge && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 type-label-small text-on-error" aria-label={o.badgeLabel}>
                {o.badge > 99 ? "99+" : o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Chips ----------

const CHIP = "state-layer inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-2 rounded-sm border type-label-large disabled:cursor-not-allowed disabled:opacity-38";

/** Assist chip: a contextual action related to nearby content. */
export function AssistChip({ icon, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string }) {
  return (
    <button type="button" className={cx(CHIP, "border-outline-variant text-on-surface", icon ? "pl-2 pr-4" : "px-4", className)} {...rest}>
      {icon && <Icon name={icon} size={18} className="text-primary" />}
      {children}
    </button>
  );
}

/** Suggestion chip: a dynamically suggested reply/prompt. Wraps long text. */
export function SuggestionChip({ children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cx(CHIP, "h-auto min-h-8 whitespace-normal border-outline-variant px-4 py-1.5 text-left text-on-surface-variant", className)} {...rest}>
      {children}
    </button>
  );
}

/** Filter chip: toggles a selection (single- or multi-select). */
export function FilterChip({ selected, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(CHIP, selected ? "border-transparent bg-secondary-container pl-2 pr-4 text-on-secondary-container" : "border-outline-variant px-4 text-on-surface-variant", className)}
      {...rest}
    >
      {selected && <Icon name="check" size={18} />}
      {children}
    </button>
  );
}

/** Input chip: a user-entered item with a remove button. */
export function InputChip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove: () => void; removeLabel: string }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1 rounded-sm border border-outline-variant pl-3 type-label-large text-on-surface-variant">
      {children}
      <button type="button" aria-label={removeLabel} title={removeLabel} onClick={onRemove} className="state-layer touch-target flex h-8 w-8 cursor-pointer items-center justify-center rounded-full">
        <Icon name="close" size={18} />
      </button>
    </span>
  );
}

/** − n + quantity stepper built from icon buttons. */
export function QtyStepper({ value, onChange, min = 1, disabled, label }: { value: number; onChange: (v: number) => void; min?: number; disabled?: boolean; label: string }) {
  return (
    <span role="group" aria-label={label} className="inline-flex items-center rounded-full border border-outline-variant">
      <IconButton icon="remove" label={`Decrease ${label.toLowerCase()}`} size={32} disabled={disabled || value <= min} onClick={() => onChange(value - 1)} />
      <span className="w-7 text-center type-label-large tabular-nums text-on-surface" aria-live="polite">{value}</span>
      <IconButton icon="add" label={`Increase ${label.toLowerCase()}`} size={32} disabled={disabled} onClick={() => onChange(value + 1)} />
    </span>
  );
}

/** Arrow-key roving focus for a horizontal group of buttons (tabs, rails). */
export function rovingKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const n = items.length;
  const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n : (i + 1) % n;
  items[next]!.focus();
  items[next]!.click();
}
