// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BottomSheet, Dialog, Menu, StatusLabel, Switch, Tabs } from "./index";

beforeAll(() => {
  // jsdom has no <dialog> modal API: emulate open state and focus handling closely enough for focus-return tests.
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
    this.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus();
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

function DialogHarness({ sheet }: { sheet?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      {sheet ? (
        <BottomSheet open={open} onClose={() => setOpen(false)} title="Basket">
          <button>inside</button>
        </BottomSheet>
      ) : (
        <Dialog open={open} onClose={() => setOpen(false)} title="Confirm" actions={<button onClick={() => setOpen(false)}>Done</button>}>
          body
        </Dialog>
      )}
    </>
  );
}

describe("focus return", () => {
  for (const sheet of [false, true]) {
    it(`${sheet ? "BottomSheet" : "Dialog"} returns focus to the trigger on close`, () => {
      render(<DialogHarness sheet={sheet} />);
      const trigger = screen.getByText("Open it");
      trigger.focus();
      fireEvent.click(trigger);
      expect(document.activeElement).not.toBe(trigger); // focus moved into the dialog
      fireEvent.click(sheet ? screen.getByLabelText("Close Basket") : screen.getByText("Done"));
      expect(document.activeElement).toBe(trigger);
    });
  }
});

describe("Tabs", () => {
  function T() {
    const [v, setV] = useState("a");
    return <Tabs label="Sections" value={v} onChange={setV} tabs={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]} />;
  }
  it("roves focus with arrow keys, Home and End; only the selected tab is tabbable", () => {
    render(<T />);
    const tab = (n: string) => screen.getByRole("tab", { name: n });
    expect(tab("A").getAttribute("aria-selected")).toBe("true");
    expect(tab("A").tabIndex).toBe(0);
    expect(tab("B").tabIndex).toBe(-1);
    tab("A").focus();
    fireEvent.keyDown(tab("A"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("B"));
    expect(tab("B").getAttribute("aria-selected")).toBe("true");
    expect(tab("B").tabIndex).toBe(0);
    expect(tab("A").tabIndex).toBe(-1);
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

describe("Menu", () => {
  it("opens with focus on the first item, arrows/Home/End move, Esc and select return focus to the trigger", () => {
    const picked: string[] = [];
    render(
      <Menu
        trigger={(p) => <button {...p}>Account</button>}
        items={[{ label: "One", onSelect: () => picked.push("one") }, { label: "Two", onSelect: () => picked.push("two") }, { label: "Three", onSelect: () => picked.push("three") }]}
      />,
    );
    const trigger = screen.getByText("Account");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const item = (n: string) => screen.getByRole("menuitem", { name: n });
    expect(document.activeElement).toBe(item("One"));
    fireEvent.keyDown(item("One"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Three"));
    fireEvent.keyDown(item("Three"), { key: "Home" });
    expect(document.activeElement).toBe(item("One"));
    fireEvent.keyDown(item("One"), { key: "End" });
    expect(document.activeElement).toBe(item("Three"));
    fireEvent.keyDown(item("Three"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(item("Two"));
    expect(picked).toEqual(["two"]);
    expect(document.activeElement).toBe(trigger);
  });
});

describe("StatusLabel", () => {
  it("grows with its text instead of clipping (min height, not fixed)", () => {
    render(<StatusLabel>Payment pending</StatusLabel>);
    const el = screen.getByText("Payment pending");
    expect(el.className).toContain("min-h-7");
    expect(el.className).not.toMatch(/(^|\s)h-7(\s|$)/);
  });
});
