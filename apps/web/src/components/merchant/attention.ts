import { formatINR } from "../../lib/format";

/** Tab title while offers wait: alternates with the plain title when `phase` is false (background flashing). */
export function flashTitle(base: string, count: number, totalPaise: number, phase: boolean): string {
  if (!phase) return base;
  const amount = totalPaise > 0 ? ` ${formatINR(totalPaise)}` : "";
  return `(${count}) New offer${amount} — ${base}`;
}

/** Favicon with a red badge dot, drawn on a canvas (no asset files). Null if canvas is unavailable. */
export function offerBadgeIcon(): string | null {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#2e6b34";
    g.beginPath();
    g.roundRect(4, 4, 56, 56, 14);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = "bold 38px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("K", 32, 34);
    g.fillStyle = "#ba1a1a";
    g.beginPath();
    g.arc(46, 18, 16, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = 3;
    g.stroke();
    return c.toDataURL("image/png");
  } catch {
    return null;
  }
}
