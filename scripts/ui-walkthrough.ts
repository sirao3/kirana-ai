/**
 * UI walkthrough (UX-00): drives the real app in the locally installed Chrome/Edge and saves screenshots.
 *
 *   pnpm ui --url http://127.0.0.1:8091 --passcode demo [--widths 412,1440] [--themes light,dark]
 *           [--out .ui-shots] [--browser "C:/Program Files/Google/Chrome/Application/chrome.exe"] [--no-reset]
 *           [--no-axe] [--zoom 2]
 *
 * Per width x theme: landing -> persona sign-in -> shop (assistant tab, Search & plan tab, add "Whole Wheat Atta from
 * Sharma", basket) -> verified quote dialog -> approve -> pay -> tracker -> merchant Sharma (offer, Reject..., Accept,
 * Start preparing) -> wall -> admin (gate, Controls, Ledger, Audit). It never uses the agent chat (no Gemini calls).
 *
 * Accessibility (UX-15): every screenshot is also scanned with axe-core (WCAG 2.x A/AA + best-practice tags); any
 * serious or critical violation fails the run. --no-axe skips it. --zoom 2 sets the root font size to 200 % (large-text
 * check) and skips axe; look at the screenshots for clipping.
 *
 * It RESETS the deployment's data at the start of every width x theme run (use --no-reset to skip; then the flow
 * needs a clean, seeded database). Never run it against a demo that is in use.
 * Exits 0 on success; 1 on any page error, console error or failed step; 2 on bad usage.
 * Uses playwright-core with an installed browser: nothing is downloaded.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "playwright-core";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) {
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : "true";
  }
  return fallback;
}

const BASE = (arg("url", process.env.UI_URL) ?? "").replace(/\/$/, "");
const PASSCODE = arg("passcode", process.env.ADMIN_PASSCODE);
const WIDTHS = (arg("widths", "412,1440") as string).split(",").map(Number);
const THEMES = (arg("themes", "light,dark") as string).split(",") as ("light" | "dark")[];
const OUT = arg("out", ".ui-shots") as string;
const BROWSER = arg("browser", process.env.UI_BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe") as string;
const AXE = arg("no-axe") !== "true" && !arg("zoom");
const ZOOM = Number(arg("zoom", "1"));
const RESET = arg("no-reset") !== "true";

if (!BASE || !PASSCODE || WIDTHS.some((w) => !(w > 0)) || THEMES.some((t) => t !== "light" && t !== "dark")) {
  console.error(
    'usage: pnpm ui --url <base url> --passcode <admin passcode> [--widths 412,1440] [--themes light,dark] [--out .ui-shots] [--browser <chrome/edge exe>] [--no-reset]',
  );
  process.exit(2);
}
if (!existsSync(BROWSER)) {
  console.error(`browser not found: ${BROWSER}\npass --browser <path to chrome.exe or msedge.exe> (no browser is downloaded)`);
  process.exit(2);
}

const errors: string[] = [];
let shots = 0;
let axeScans = 0;
const axeMinor = new Map<string, number>();

async function sessionFor(body: object): Promise<unknown> {
  const r = await fetch(`${BASE}/auth/persona`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST /auth/persona ${r.status}`);
  return r.json();
}

async function resetData(): Promise<void> {
  const admin = (await sessionFor({ role: "admin", passcode: PASSCODE })) as { token: string };
  const r = await fetch(`${BASE}/admin/api/reset`, { method: "POST", headers: { authorization: `Bearer ${admin.token}` } });
  if (!r.ok) throw new Error(`POST /admin/api/reset ${r.status}`);
}

/** Sign in through the API and store the session the way the app does (sessionStorage `kiranaai.session`). */
async function signIn(p: Page, body: object): Promise<void> {
  const s = (await sessionFor(body)) as { token: string; role: string; sub: string; name: string };
  await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await p.evaluate((v) => sessionStorage.setItem("kiranaai.session", JSON.stringify(v)), { token: s.token, role: s.role, sub: s.sub, name: s.name });
}

async function run(browser: Browser, width: number, scheme: "light" | "dark"): Promise<void> {
  const tag = `${width}-${scheme}`;
  const narrow = width < 840;
  const tall = width < 600;
  const label = (page: string) => `${tag} ${page}`;
  mkdirSync(OUT, { recursive: true });

  if (RESET) await resetData();

  async function newPage(name: string): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width, height: tall ? 860 : 900 }, colorScheme: scheme });
    if (ZOOM !== 1) await ctx.addInitScript(`new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.style.setProperty("font-size", "${ZOOM * 100}%", "important"); o.disconnect(); } }).observe(document, { childList: true });`);
    const p = await ctx.newPage();
    p.setDefaultTimeout(20_000);
    p.on("pageerror", (e) => errors.push(`${label(name)} pageerror: ${e.message}`));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(`${label(name)} console: ${m.text().slice(0, 200)}`);
    });
    return p;
  }
  let n = 0;
  const shot = async (p: Page, name: string, fullPage = false) => {
    n += 1;
    await p.screenshot({ path: join(OUT, `${String(n).padStart(2, "0")}-${name}-${tag}.png`), fullPage });
    shots += 1;
    if (AXE) {
      // Animations (scale-in / sheet-up) make axe sample mid-transition colours; wait for them to finish.
      await p.waitForTimeout(350);
      const res = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
      axeScans += 1;
      for (const v of res.violations) {
        if (v.impact === "serious" || v.impact === "critical") {
          const targets = v.nodes.slice(0, 3).map((nd) => nd.target.join(" ")).join(" | ");
          errors.push(`${label(name)} axe ${v.impact} ${v.id}: ${v.help} [${v.nodes.length}] e.g. ${targets}`);
        } else axeMinor.set(v.id, (axeMinor.get(v.id) ?? 0) + 1);
      }
    }
  };
  const settle = (p: Page, ms = 700) => p.waitForTimeout(ms);

  // 1. Landing.
  const c = await newPage("customer");
  await c.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await c.getByRole("button", { name: /Start demo/ }).waitFor();
  await settle(c, 500);
  await shot(c, "landing", true);

  // 2-3. Customer: shop.
  await signIn(c, { role: "customer", id: "cust_priya" });
  await c.goto(`${BASE}/shop`, { waitUntil: "domcontentloaded" });
  await c.getByRole("tab", { name: /Assistant/ }).waitFor();
  await settle(c);
  await shot(c, "shop-assistant");

  // 2b. UX-14: delivery address sheet, a farther address, and its effect on search; then back to the default address.
  const openAddress = () => c.getByRole("button", { name: /Delivering to/ }).click();
  await c.getByRole("button", { name: /Delivering to Indiranagar/ }).waitFor();
  await openAddress();
  await c.getByRole("radio", { name: /CV Raman Nagar/ }).waitFor();
  await settle(c, 500);
  await shot(c, "address-sheet", true);
  await c.getByRole("radio", { name: /CV Raman Nagar/ }).click();
  await c.getByText("3 of 5 stores deliver here", { exact: false }).waitFor();
  await settle(c, 500);
  await shot(c, "address-sheet-far", true);
  await c.getByRole("button", { name: "Done", exact: true }).click();
  await c.getByRole("tab", { name: /Search & plan/ }).click();
  await c.getByRole("searchbox", { name: "Search products" }).fill("atta");
  await c.keyboard.press("Enter");
  await c.getByText("Doesn't deliver to you").first().waitFor();
  await settle(c, 500);
  await shot(c, "search-out-of-radius");
  await openAddress();
  await c.getByRole("radio", { name: /Indiranagar/ }).click();
  await c.getByText("All 5 stores deliver", { exact: false }).waitFor();
  await c.getByRole("button", { name: "Done", exact: true }).click();
  await c.getByRole("tab", { name: /Search & plan/ }).click();
  await c.getByRole("combobox", { name: "Search products" }).fill("atta");
  await c.getByRole("option").first().waitFor(); // UX-13: suggestion list
  await settle(c, 300);
  await shot(c, "shop-suggest");
  await c.keyboard.press("Enter");
  const add = c.getByRole("button", { name: /Add Whole Wheat Atta from Sharma/ });
  await add.waitFor();
  await settle(c, 500);
  await shot(c, "shop-search");
  await add.click();
  await settle(c);
  await shot(c, "shop-added");
  if (narrow) {
    await c.getByRole("button", { name: /Basket, / }).click();
    await settle(c);
    await shot(c, "basket-sheet");
  }
  await c.getByRole("button", { name: "Get verified quote" }).click();
  await c.getByRole("button", { name: /^Approve/ }).waitFor();
  await settle(c);
  await shot(c, "quote-dialog");
  await c.getByRole("button", { name: /^Approve/ }).click();
  await c.getByRole("button", { name: /^Pay/ }).waitFor();
  await settle(c);
  await shot(c, "approved");
  await c.getByRole("button", { name: /^Pay/ }).click();
  await c.waitForURL(/\/shop\/orders\//);
  await settle(c, 2500);
  await shot(c, "order-tracker", true);

  // 4. Merchant: Sharma gets the offer.
  const m = await newPage("merchant");
  await signIn(m, { role: "merchant", id: "store_sharma" });
  await m.goto(`${BASE}/merchant`, { waitUntil: "domcontentloaded" });
  // Below 600 px the offer opens as a full-screen takeover (UX-09); act inside it, since the card behind it is inert.
  const offer = width < 600 ? m.getByRole("dialog") : m.locator("body");
  await offer.getByRole("button", { name: "Accept", exact: true }).waitFor();
  await settle(m, 500);
  await shot(m, "merchant-offer", tall);
  await offer.getByRole("button", { name: "Reject…" }).click();
  await settle(m, 400);
  await shot(m, "merchant-reject");
  await offer.getByRole("button", { name: "Back" }).click();
  await offer.getByRole("button", { name: "Accept", exact: true }).click();
  await m.getByRole("button", { name: "Start preparing" }).click();
  await settle(m, 1500);
  await shot(m, "merchant-accepted");
  // Catalogue: a card list below 600 px, a table above (UX-15).
  await m.locator('nav[aria-label]:visible').getByText("Catalogue", { exact: true }).click();
  await m.getByRole("textbox", { name: "Filter products" }).waitFor();
  await settle(m, 800);
  await shot(m, "merchant-catalogue", true);
  await m.locator('nav[aria-label]:visible').getByText("Live", { exact: true }).click();
  await settle(c, 1500);
  await shot(c, "order-after-accept", true);

  // 5. Wall.
  const w = await newPage("wall");
  await w.goto(`${BASE}/wall`, { waitUntil: "domcontentloaded" });
  await settle(w, 2500);
  await shot(w, "wall");

  // 6. Admin: gate, then Controls, Ledger, Audit.
  const a = await newPage("admin");
  await a.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await a.getByLabel("Passcode", { exact: true }).waitFor();
  await shot(a, "admin-gate");
  await a.getByLabel("Passcode", { exact: true }).fill(PASSCODE!);
  await a.keyboard.press("Enter");
  await a.getByText("Demo readiness").first().waitFor();
  await settle(a, 1200);
  await shot(a, "admin-controls", true);
  await a.locator('nav[aria-label="Admin"]:visible').getByText("Ledger").click();
  await settle(a, 1000);
  await shot(a, "admin-ledger");
  await a.locator('nav[aria-label="Admin"]:visible').getByText("Audit").click();
  await settle(a, 1000);
  await a.locator("button[aria-expanded]").first().click().catch(() => {});
  await settle(a, 600);
  await shot(a, "admin-audit");

  // 7. Merchant Earnings (UX-11): deliver the order, then open the tab.
  for (const step of ["Mark ready", "Out for delivery", "Mark delivered"]) {
    await m.getByRole("button", { name: step }).click();
    await settle(m, 600);
  }
  await m.locator('nav[aria-label="Store"]:visible').getByText("Earnings").click();
  await settle(m, 1500);
  await shot(m, "merchant-earnings");

  for (const p of [c, m, w, a]) await p.context().close();
  console.log(`  ${tag}: ${n} screenshots`);
}

async function main(): Promise<void> {
const browser = await chromium.launch({ executablePath: BROWSER });
try {
  for (const scheme of THEMES) {
    for (const width of WIDTHS) {
      try {
        await run(browser, width, scheme);
      } catch (e) {
        errors.push(`${width}-${scheme} step failed: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }
} finally {
  await browser.close();
}

console.log(`${shots} screenshots in ${OUT}/`);
if (AXE) console.log(`axe: ${axeScans} scans; moderate/minor (not failing): ${[...axeMinor].map(([k, v]) => `${k}x${v}`).join(", ") || "none"}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n${[...new Set(errors)].join("\n")}`);
  process.exit(1);
}
console.log("no page or console errors");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
