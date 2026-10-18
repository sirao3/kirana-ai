// Drives the /demo cockpit end to end against a running app and saves screenshots to .ui-shots/hood.
// RESETS the data. Usage: BASE=http://localhost:5173 UI_BROWSER=/usr/bin/google-chrome [WINDOW=20] [PASSCODE=demo] node scripts/cockpit-walk.mjs
// Ask → (swap in the §14 basket, since the local fake agent plans its own) → pay → accept Sharma, decline Lakshmi,
// accept Annapurna, let Gupta time out, accept Balaji → advance every store to Delivered → settled.
import { chromium } from "playwright-core";
const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = ".ui-shots/hood";
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900);
const j = async (m, p, token, body) => {
  const r = await fetch(BASE + p, { method: m, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${await r.text()}`);
  return r.json();
};
const admin = (await j("POST", "/auth/persona", null, { role: "admin", passcode: process.env.PASSCODE ?? "demo" })).token;
await j("POST", "/admin/api/reset", admin);
await j("PATCH", "/admin/api/config", admin, { offerWindowSeconds: Number(process.env.WINDOW ?? 20) });
const b = await chromium.launch({ executablePath: process.env.UI_BROWSER ?? "/usr/bin/google-chrome" });
const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && !/404/.test(m.text()) && errs.push(m.text()));
let n = 0;
const shot = async (name) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png` });
const t0 = Date.now();
const log = (s) => console.log(((Date.now() - t0) / 1000).toFixed(1) + "s", s);
await p.goto(BASE + "/demo");
await p.getByRole("button", { name: "Send" }).waitFor();
await p.waitForTimeout(1500);
await shot("idle");
await p.getByRole("button", { name: "Send" }).click();
log("asked");
await p.waitForTimeout(1200);
await shot("thinking");
await p.getByRole("button", { name: /Quantities look right|Get verified total|Pay ₹/ }).waitFor({ timeout: 60000 });
// The local fake agent builds its own basket; swap in the §14 basket the real model plans (Sharma, Gupta, Lakshmi).
const cust = (await j("POST", "/auth/persona", null, { role: "customer", id: "cust_priya" })).token;
const plan = await j("POST", "/bap/plan", cust, { needs: [{ query: "atta", qty: 1 }, { query: "toor dal", qty: 2 }, { query: "tea", qty: 1 }, { query: "milk", qty: 8 }], budgetPaise: 150000 });
await j("PUT", "/bap/basket", cust, { items: plan.choices.map((c) => ({ listingId: c.offer.listingId, qty: c.qty, reason: c.reason })), planReasons: plan.reasons });
await p.waitForTimeout(2500);
await shot("basket");
log("basket");
const cta = p.getByRole("button", { name: /Quantities look right|Get verified total|Pay ₹/ });
await cta.click();
await p.getByRole("dialog", { name: "Approve and pay" }).waitFor({ timeout: 30000 });
await p.waitForTimeout(900);
await shot("pay-sheet");
log("sheet");
await p.getByRole("button", { name: /Approve and pay ₹/ }).click();
await p.waitForTimeout(700);
await shot("paying");
await p.getByRole("tab", { name: /^Stores/ }).click(); // store actions live in the Stores view
await p.getByRole("alertdialog", { name: /New order for Sharma/ }).waitFor({ timeout: 30000 });
await p.waitForTimeout(1200);
await shot("offers");
log("offers");
await p.getByRole("alertdialog", { name: /New order for Sharma/ }).getByRole("button", { name: "Accept" }).click();
await p.waitForTimeout(1500);
const lak = p.getByRole("alertdialog", { name: /New order for Lakshmi/ });
await lak.getByRole("button", { name: "Decline" }).click();
await p.waitForTimeout(600);
await shot("decline-reason");
await lak.getByRole("button", { name: "Decline" }).click();
log("lakshmi declined");
await p.getByRole("alertdialog", { name: /New order for Annapurna/ }).waitFor({ timeout: 30000 });
await p.waitForTimeout(1500);
await shot("reassigned");
await p.getByRole("alertdialog", { name: /New order for Annapurna/ }).getByRole("button", { name: "Accept" }).click();
log("annapurna accepted; waiting for gupta to time out");
await p.getByRole("alertdialog", { name: /New order for Balaji/ }).waitFor({ timeout: 90000 });
await p.waitForTimeout(1500);
await shot("gupta-expired");
await p.getByRole("alertdialog", { name: /New order for Balaji/ }).getByRole("button", { name: "Accept" }).click();
log("balaji accepted");
await p.waitForTimeout(1500);
await shot("all-accepted");
// Advance every busy store to delivered via the pin buttons.
for (let i = 0; i < 40; i++) {
  const btn = p.getByRole("button", { name: /^(Start packing|Mark ready|Out for delivery|Mark delivered) at / }).first();
  if (!(await btn.count())) break;
  const label = (await btn.getAttribute("aria-label", { timeout: 2000 }).catch(() => null)) ?? "";
  if (!label) continue;
  await btn.click({ timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(label.startsWith("Out for delivery") ? 2500 : 700);
  if (label.startsWith("Out for delivery") && i < 12) await shot("on-the-way");
}
await p.getByRole("tab", { name: /^Customer/ }).click();
await p.waitForTimeout(7000);
await shot("settled");
log("done");
console.log(errs.length ? errs.slice(0, 5) : "no page errors");
await b.close();
