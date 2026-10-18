// Records the §14 demo in the /demo cockpit with a voice-over and captions → .video/kiranaai-demo.mp4.
//
//   node scripts/demo-video/make.mjs [tts|record|compose|all]      (default all)
//   env: BASE (hosted URL), PASSCODE (default: gcloud secret admin-passcode), UI_BROWSER, FFMPEG_DIR, NO_CAPTIONS=1
//
// tts:     Cloud Text-to-Speech (gcloud user token, billed to orbi-kirana-hack) → .video/tts/<id>.wav, cached by text.
// record:  RESETS the deployment, then drives Chrome headless with a drawn cursor; CDP screencast frames → .video/frames,
//          beat start times → .video/timeline.json. Each beat lasts max(its actions, its narration).
// compose: frames + narration at the beat times + captions (.srt, burned in) → mp4 (1920x1080, 30 fps).
import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { NARRATION, VOICE } from "./narration.mjs";

const BASE = (process.env.BASE ?? "https://kiranaai-769889659635.us-central1.run.app").replace(/\/$/, "");
const OUT = resolve(".video");
const BROWSER = process.env.UI_BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const VW = 1440, VH = 810, DSF = 1920 / 1440; // CSS viewport → 1920x1080 frames
const GAP_MS = 600; // pause after each narration line
const stage = process.argv[2] ?? "all";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
mkdirSync(OUT, { recursive: true });

function ffmpegBin(name) {
  if (process.env.FFMPEG_DIR) return join(process.env.FFMPEG_DIR, name);
  const root = join(process.env.LOCALAPPDATA ?? "", "Microsoft/WinGet/Packages");
  const pkg = existsSync(root) && readdirSync(root).find((d) => d.startsWith("Gyan.FFmpeg"));
  if (pkg) {
    const build = readdirSync(join(root, pkg)).find((d) => d.startsWith("ffmpeg-"));
    if (build) return join(root, pkg, build, "bin", name);
  }
  return name; // on PATH
}

/** WAV (LINEAR16) duration in seconds from the header. */
function wavSeconds(file) {
  const b = readFileSync(file);
  const rate = b.readUInt32LE(24), bytesPerSec = b.readUInt32LE(28);
  let i = 12;
  while (i < b.length - 8) {
    const id = b.toString("ascii", i, i + 4), size = b.readUInt32LE(i + 4);
    if (id === "data") return size / bytesPerSec;
    i += 8 + size;
  }
  return (b.length - 44) / (rate * 2);
}

// ---------------------------------------------------------------- tts
async function tts() {
  const dir = join(OUT, "tts");
  mkdirSync(dir, { recursive: true });
  const token = sh("gcloud auth print-access-token");
  const index = {};
  for (const { id, text } of NARRATION) {
    const hash = createHash("sha1").update(JSON.stringify([VOICE, text])).digest("hex").slice(0, 10);
    const file = join(dir, `${id}-${hash}.wav`);
    if (!existsSync(file)) {
      const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "x-goog-user-project": "orbi-kirana-hack", "content-type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: VOICE.languageCode, name: VOICE.name },
          audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000, speakingRate: VOICE.speakingRate },
        }),
      });
      if (!r.ok) throw new Error(`tts ${id}: ${r.status} ${await r.text()}`);
      writeFileSync(file, Buffer.from((await r.json()).audioContent, "base64"));
    }
    index[id] = { file, seconds: wavSeconds(file), text };
  }
  writeFileSync(join(OUT, "tts.json"), JSON.stringify(index, null, 2));
  const total = Object.values(index).reduce((s, v) => s + v.seconds, 0);
  console.log(`tts: ${NARRATION.length} lines, ${total.toFixed(1)} s of speech`);
  return index;
}

// ---------------------------------------------------------------- record
const CURSOR = `(() => {
  const ensure = () => {
    let c = document.getElementById("__cur");
    if (!c && document.documentElement) {
      c = document.createElement("div");
      c.id = "__cur";
      c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6.9 3.9 7.4-3 1.5-3.9-7.5L4 20z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      c.style.cssText = "position:fixed;left:0;top:0;width:26px;height:26px;pointer-events:none;z-index:2147483647;transform:translate(" + (window.__cx ?? -50) + "px," + (window.__cy ?? -50) + "px)";
      document.documentElement.appendChild(c);
    }
    return c;
  };
  addEventListener("mousemove", (e) => { window.__cx = e.clientX; window.__cy = e.clientY; const c = ensure(); if (c) c.style.transform = "translate(" + (e.clientX - 3) + "px," + (e.clientY - 2) + "px)"; }, true);
  addEventListener("mousedown", (e) => {
    const r = document.createElement("div");
    r.style.cssText = "position:fixed;left:" + (e.clientX - 18) + "px;top:" + (e.clientY - 18) + "px;width:36px;height:36px;border-radius:50%;background:rgba(255,149,0,.45);pointer-events:none;z-index:2147483646;transition:transform .45s ease-out,opacity .45s ease-out";
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = "scale(1.9)"; r.style.opacity = "0"; });
    setTimeout(() => r.remove(), 600);
  }, true);
})();`;

async function api(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.json();
}

async function record() {
  const lines = existsSync(join(OUT, "tts.json")) ? JSON.parse(readFileSync(join(OUT, "tts.json"), "utf8")) : await tts();
  const passcode = process.env.PASSCODE ?? sh("gcloud secrets versions access latest --secret=admin-passcode --project orbi-kirana-hack");
  const adminSession = await api("POST", "/auth/persona", null, { role: "admin", passcode });
  const admin = adminSession.token;
  await api("POST", "/admin/api/reset", admin);
  await api("PATCH", "/admin/api/config", admin, { offerWindowSeconds: 45 });

  const frameDir = join(OUT, "frames");
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: BROWSER, args: ["--hide-scrollbars"] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF });
  await ctx.addInitScript(CURSOR);
  const p = await ctx.newPage();
  p.setDefaultTimeout(30_000);
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));

  // Screencast: frames arrive on repaint only; each is shown until the next one.
  const frames = [];
  const cdp = await ctx.newCDPSession(p);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const n = frames.length;
    const file = `f${String(n).padStart(6, "0")}.jpg`;
    writeFileSync(join(frameDir, file), Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });

  const click = async (loc, { hold = 250 } = {}) => {
    await loc.waitFor({ state: "visible" });
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 });
    await sleep(hold);
    await p.mouse.down();
    await sleep(90);
    await p.mouse.up();
  };
  const hover = async (loc) => {
    const b = await loc.boundingBox();
    if (b) await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  };
  const offer = (store) => p.getByRole("alertdialog", { name: new RegExp(`New order for ${store}`) });
  const cta = () => p.getByRole("button", { name: /Quantities look right|Get verified total|Pay ₹/ });

  const beats = {
    intro: async () => { await sleep(4000); await p.mouse.move(VW * 0.62, VH * 0.45, { steps: 40 }); },
    map: async () => {
      await sleep(lines.map.seconds * 1000 - 2200);
      await click(p.getByRole("button", { name: /Start the live demo/ }).first());
    },
    cockpit: async () => {
      await p.getByRole("button", { name: "Send" }).waitFor();
      await sleep(1500);
      await hover(p.getByRole("textbox", { name: "Message the assistant" }));
    },
    ask: async () => {
      const box = p.getByRole("textbox", { name: "Message the assistant" });
      await click(box);
      await p.keyboard.press("Control+A");
      await p.keyboard.press("Backspace");
      await sleep(300);
      await p.keyboard.type("Weekly groceries for 4, under 1500 rupees: atta, toor dal, milk, tea.", { delay: 38 });
      await sleep(500);
      await click(p.getByRole("button", { name: "Send" }));
    },
    thinking: async () => {
      await cta().waitFor({ timeout: 120_000 });
      // Real Gemini plans the basket; the rest of the script needs the §14 one (Sharma, Gupta, Lakshmi).
      const cust = (await api("POST", "/auth/persona", null, { role: "customer", id: "cust_priya" })).token;
      const basket = await api("GET", "/bap/basket", cust);
      const stores = new Set(JSON.stringify(basket).match(/store_[a-z]+/g) ?? []);
      console.log("agent basket stores:", [...stores].join(", "));
    },
    basket: async () => {
      await sleep(1200);
      const card = p.getByText(/Sharma/).first();
      await hover(card).catch(() => {});
      await sleep(lines.basket.seconds * 1000 - 3500);
      if (/Quantities look right/.test((await cta().textContent()) ?? "")) await click(cta());
    },
    quote: async () => {
      await sleep(800);
      if (/Get verified total/.test((await cta().textContent()) ?? "")) await click(cta());
      await p.getByRole("button", { name: /Pay ₹/ }).waitFor({ timeout: 30_000 }).catch(() => {});
      await sleep(500);
      if (/Pay ₹/.test((await cta().textContent()) ?? "")) await click(cta());
      await p.getByRole("dialog", { name: "Approve and pay" }).waitFor({ timeout: 30_000 });
    },
    pay: async () => {
      const btn = p.getByRole("button", { name: /Approve and pay ₹/ });
      await hover(btn);
      await sleep(lines.pay.seconds * 1000 - 2500);
      await click(btn);
      await sleep(1500);
    },
    offers: async () => {
      await sleep(1500);
      await click(p.getByRole("tab", { name: /^Stores/ }));
      await offer("Sharma").waitFor();
    },
    accept: async () => {
      await click(offer("Sharma").getByRole("button", { name: "Accept" }));
    },
    decline: async () => {
      const lak = offer("Lakshmi");
      await click(lak.getByRole("button", { name: "Decline" }));
      await sleep(700);
      const chip = lak.getByRole("button", { name: /out of stock/i }).first();
      if (await chip.count()) { await click(chip); await sleep(400); }
      await click(lak.getByRole("button", { name: "Decline" }));
      await offer("Annapurna").waitFor();
    },
    annapurna: async () => {
      await sleep(1200);
      await click(offer("Annapurna").getByRole("button", { name: "Accept" }));
    },
    timeout: async () => {
      await hover(offer("Gupta")).catch(() => {});
      await offer("Balaji").waitFor({ timeout: 90_000 });
    },
    balaji: async () => {
      await sleep(1500);
      await click(offer("Balaji").getByRole("button", { name: "Accept" }));
    },
    deliver: async () => {
      for (let i = 0; i < 40; i++) {
        const btn = p.getByRole("button", { name: /^(Start packing|Mark ready|Out for delivery|Mark delivered) at / }).first();
        if (!(await btn.count())) { if (i > 0) break; await sleep(800); continue; }
        const label = (await btn.getAttribute("aria-label").catch(() => "")) ?? "";
        await click(btn, { hold: 120 }).catch(() => {});
        await sleep(label.startsWith("Out for delivery") ? 2200 : 500);
      }
    },
    settled: async () => {
      await click(p.getByRole("tab", { name: /^Customer/ }));
      await p.getByText(/Everything arrived/).waitFor({ timeout: 60_000 }).catch(() => console.log("warn: no 'Everything arrived'"));
    },
    jeera: async () => {
      await click(p.getByRole("button", { name: "Start a new order" }));
      const box = p.getByRole("textbox", { name: "Message the assistant" });
      await sleep(1200);
      await click(box);
      await p.keyboard.press("Control+A");
      await p.keyboard.press("Backspace");
      await p.keyboard.type("250 g jeera bhi chahiye", { delay: 45 });
      await sleep(400);
      await click(p.getByRole("button", { name: "Send" }));
      await p.getByText(/100\s?g/i).last().waitFor({ timeout: 90_000 }).catch(() => console.log("warn: no 100 g reply"));
      await sleep(1500);
    },
    ledger: async () => {
      await p.evaluate((s) => sessionStorage.setItem("kiranaai.session", JSON.stringify(s)), { token: adminSession.token, role: adminSession.role, sub: adminSession.sub, name: adminSession.name });
      await p.goto(BASE + "/admin");
      await click(p.getByRole("button", { name: "Ledger" }).or(p.getByRole("link", { name: "Ledger" })).or(p.getByRole("tab", { name: "Ledger" })).first());
      await sleep(2500);
      await p.mouse.move(VW * 0.55, VH * 0.5, { steps: 30 });
    },
    audit: async () => {
      await click(p.getByRole("button", { name: "Audit" }).or(p.getByRole("link", { name: "Audit" })).or(p.getByRole("tab", { name: "Audit" })).first());
      await sleep(1200);
      // The order's transaction (100+ rows), not the newest one (the jeera search).
      await click(p.getByText(/^\d{2,} rows/).first());
      await sleep(1800);
      await p.mouse.move(VW * 0.62, VH * 0.55, { steps: 25 });
      await p.mouse.wheel(0, 300);
    },
    arch: async () => {
      await p.goto(BASE + "/");
      await sleep(4000);
      await p.mouse.move(VW * 0.6, VH * 0.4, { steps: 40 });
    },
    outro: async () => {},
  };

  await p.goto(BASE + "/");
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await sleep(300);
  const timeline = [];
  const t0 = Date.now() / 1000;
  for (const { id } of NARRATION) {
    const start = Date.now() / 1000;
    timeline.push({ id, start });
    console.log(`${(start - t0).toFixed(1).padStart(6)}s  ${id}`);
    await Promise.all([beats[id](), sleep(lines[id].seconds * 1000 + GAP_MS)]);
  }
  await sleep(1500);
  const end = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");
  await browser.close();
  writeFileSync(join(OUT, "timeline.json"), JSON.stringify({ frames, timeline, end }, null, 2));
  console.log(`record: ${frames.length} frames, ${(end - t0).toFixed(1)} s`, errs.length ? errs.slice(0, 5) : "no page errors");

  await api("POST", "/admin/api/reset", admin).catch((e) => console.log("warn: reset failed", e.message));
}

// ---------------------------------------------------------------- compose
const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p2 = (n, w = 2) => String(n).padStart(w, "0");
  return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${p2(Math.floor(ms / 1000) % 60)},${p2(ms % 1000, 3)}`;
};

/** Split a line into caption chunks of ≤ ~62 chars at sentence/clause boundaries. */
function chunks(text) {
  const MAX = 62;
  const parts = text.match(/[^.!?:;]+[.!?:;]*\s*/g) ?? [text];
  const out = [];
  for (const part of parts) {
    let s = part.trim();
    while (s.length > MAX) {
      let cut = s.lastIndexOf(", ", MAX);
      if (cut < 24) cut = s.lastIndexOf(" ", MAX);
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

function compose() {
  const { frames, timeline, end } = JSON.parse(readFileSync(join(OUT, "timeline.json"), "utf8"));
  const lines = JSON.parse(readFileSync(join(OUT, "tts.json"), "utf8"));
  const t0 = frames[0].t;
  const ffmpeg = ffmpegBin("ffmpeg");

  // Video: resample the repaint-driven frames to exact 30 fps (latest frame at each tick), as hard links.
  // (The concat demuxer pads sub-frame durations, which made the video ~5 % longer than the audio.)
  const cfr = join(OUT, "cfr");
  rmSync(cfr, { recursive: true, force: true });
  mkdirSync(cfr);
  const ticks = Math.ceil((end - t0) * 30);
  for (let k = 0, i = 0; k < ticks; k++) {
    while (i + 1 < frames.length && frames[i + 1].t <= t0 + k / 30) i++;
    linkSync(join(OUT, "frames", frames[i].file), join(cfr, `${String(k).padStart(6, "0")}.jpg`));
  }

  // Captions, timed by character share of each line's audio.
  let srt = "", n = 0;
  for (const { id, start } of timeline) {
    const { seconds, text } = lines[id];
    const cs = chunks(text);
    const total = cs.reduce((s, c) => s + c.length, 0);
    let t = start - t0;
    for (const c of cs) {
      const d = (seconds * c.length) / total;
      srt += `${++n}\n${srtTime(t)} --> ${srtTime(t + d)}\n${c}\n\n`;
      t += d;
    }
  }
  writeFileSync(join(OUT, "kiranaai-demo.srt"), srt);

  // Audio: each line delayed to its beat; mixed without normalisation.
  const inputs = timeline.flatMap(({ id }) => ["-i", lines[id].file]);
  const delays = timeline.map(({ start }, i) => {
    const ms = Math.round((start - t0) * 1000);
    return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`;
  });
  const mix = `${timeline.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timeline.length}:normalize=0:dropout_transition=0,apad[aout]`;
  // Captions sit over the map, right of the 580 px customer card (srt PlayRes is 384 wide: 1 unit = 5 px).
  const burn = process.env.NO_CAPTIONS === "1" ? "" : `,subtitles=kiranaai-demo.srt:force_style='FontName=Segoe UI,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H50000000,BorderStyle=3,Outline=3,Shadow=0,MarginL=128,MarginR=12,MarginV=14'`;
  const filter = [`[0:v]scale=1920:1080:flags=lanczos,format=yuv420p${burn}[vout]`, ...delays, mix].join(";");
  const args = ["-y", "-framerate", "30", "-i", "cfr/%06d.jpg", ...inputs, "-filter_complex", filter, "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", "kiranaai-demo.mp4"];
  const r = spawnSync(ffmpeg, args, { cwd: OUT, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed:\n${r.stderr.slice(-3000)}`);
  console.log(`compose: ${join(OUT, "kiranaai-demo.mp4")} (${(end - t0).toFixed(1)} s)`);
}

if (stage === "tts" || stage === "all") await tts();
if (stage === "record" || stage === "all") await record();
if (stage === "compose" || stage === "all") compose();
