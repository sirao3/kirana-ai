// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Segmented, Sheet, Switch } from "./index";

beforeAll(() => {
  // jsdom has no matchMedia; the Sheet uses it to pick phone vs desktop presentation.
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Basket">
        <button>Inside</button>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("is a labelled modal dialog, closes on Escape and returns focus to the trigger", async () => {
    render(<SheetHarness />);
    const trigger = screen.getByText("Open it");
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Basket" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).not.toBe(trigger); // focus moved into the sheet
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Segmented", () => {
  function T() {
    const [v, setV] = useState("a");
    return <Segmented label="Sections" value={v} onChange={setV} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]} />;
  }
  it("roves focus with arrows, Home and End; only the selected tab is tabbable", () => {
    render(<T />);
    const tab = (n: string) => screen.getByRole("tab", { name: n });
    expect(tab("A").getAttribute("aria-selected")).toBe("true");
    expect(tab("A").tabIndex).toBe(0);
    expect(tab("B").tabIndex).toBe(-1);
    tab("A").focus();
    fireEvent.keyDown(tab("A"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("B"));
    expect(tab("B").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("B"), { key: "End" });
    expect(document.activeElement).toBe(tab("C"));
    fireEvent.keyDown(tab("C"), { key: "ArrowRight" }); // wraps
    expect(document.activeElement).toBe(tab("A"));
    fireEvent.keyDown(tab("A"), { key: "ArrowLeft" }); // wraps back
    expect(document.activeElement).toBe(tab("C"));
    fireEvent.keyDown(tab("C"), { key: "Home" });
    expect(document.activeElement).toBe(tab("A"));
  });
});

describe("Switch", () => {
  it("exposes role=switch with aria-checked and toggles", () => {
    let v = false;
    const { rerender } = render(<Switch label="Open for orders" checked={v} onChange={(n) => (v = n)} />);
    const sw = screen.getByRole("switch", { name: "Open for orders" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(v).toBe(true);
    rerender(<Switch label="Open for orders" checked={v} onChange={(n) => (v = n)} />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });
});
