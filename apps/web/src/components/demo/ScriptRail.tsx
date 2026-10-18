import { Button, cx, Icon } from "../m3";
import type { DemoView, StepView } from "./steps";

/**
 * Thin stepper along the top of the cockpit. The current step's hint sits underneath; steps tick themselves.
 * When the current step happens in the view that is not showing, the hint offers to switch.
 */
export function ScriptRail({ steps, onOpenLedger, view, onSwitchView }: { steps: StepView[]; onOpenLedger: () => void; view: DemoView; onSwitchView: (v: DemoView) => void }) {
  const current = steps.find((s) => s.status === "current");
  const allDone = !current;
  return (
    <section aria-label="Demo script" className="border-b border-outline-variant bg-surface-container-low px-4 py-2 sm:px-6">
      <ol className="flex items-center gap-1 overflow-x-auto">
        {steps.map((s, i) => (
          <li key={s.key} className="flex shrink-0 items-center gap-1" aria-current={s.status === "current" ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={cx("h-0.5 w-4 rounded-full lg:w-8", s.status === "todo" ? "bg-outline-variant" : "bg-primary")} />}
            <span
              className={cx(
                "flex h-9 items-center gap-2 rounded-full pl-1 pr-3 type-label-large transition-colors",
                s.status === "done" && "bg-primary-container text-on-primary-container",
                s.status === "current" && "bg-primary text-on-primary",
                s.status === "todo" && "text-on-surface-variant",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "flex h-7 w-7 items-center justify-center rounded-full type-label-medium",
                  s.status === "done" && "bg-primary text-on-primary",
                  s.status === "current" && "bg-on-primary text-primary",
                  s.status === "todo" && "border border-outline",
                )}
              >
                {s.status === "done" ? <Icon name="check" size={18} /> : i + 1}
              </span>
              <span>
                {s.label}
                <span className="sr-only"> — {s.status === "done" ? "done" : s.status === "current" ? "current step" : "not started"}</span>
              </span>
              {s.detail && s.status !== "todo" && <span className="hidden type-label-medium opacity-80 xl:inline">· {s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-1.5 flex min-h-6 flex-wrap items-center gap-x-3 type-body-medium text-on-surface" aria-live="polite">
        {allDone ? (
          <>
            <Icon name="verified" size={20} className="text-primary" /> Demo complete. Reset to run it again.
          </>
        ) : (
          <>
            <span className="type-label-large text-primary">Next:</span>
            <span className="min-w-0 flex-1">{current.hint}{current.detail ? ` (${current.detail})` : ""}</span>
            {current.view && current.view !== view && (
              <Button size="sm" variant="tonal" icon={current.view === "stores" ? "storefront" : "person"} onClick={() => onSwitchView(current.view!)}>
                Go to {current.view === "stores" ? "Stores" : "Customer"}
              </Button>
            )}
            {current.key === "ledger" && (
              <Button size="sm" variant="tonal" icon="open_in_new" onClick={onOpenLedger}>Open ledger</Button>
            )}
          </>
        )}
      </p>
    </section>
  );
}
