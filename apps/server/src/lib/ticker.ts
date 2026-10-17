/**
 * Periodic background work (offer sweeper, reconciler…).
 *
 * Cloud Run runs with request-based CPU and can scale to zero, so a setInterval alone
 * is not reliable: CPU is only guaranteed while a request is in flight. Jobs therefore
 * run (a) once on boot, (b) on a 1 s interval, and (c) from an onRequest hook when
 * they are overdue. The live screens poll every second, which keeps them timely.
 * A job never overlaps with itself.
 */
export interface TickJob {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
}

interface JobState extends TickJob {
  lastStartedAt: number;
  running: Promise<void> | null;
}

export class Ticker {
  private jobs: JobState[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private onError: (job: string, err: unknown) => void = () => {}) {}

  add(job: TickJob): void {
    this.jobs.push({ ...job, lastStartedAt: 0, running: null });
  }

  /** Runs every overdue job; resolves when those runs finish. Safe to call often. */
  tick(now = Date.now()): Promise<void> {
    const runs: Promise<void>[] = [];
    for (const j of this.jobs) {
      if (j.running) {
        runs.push(j.running);
        continue;
      }
      if (now - j.lastStartedAt < j.everyMs) continue;
      j.lastStartedAt = now;
      j.running = j
        .run()
        .catch((err) => this.onError(j.name, err))
        .finally(() => {
          j.running = null;
        });
      runs.push(j.running);
    }
    return Promise.all(runs).then(() => undefined);
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all(this.jobs.map((j) => j.running));
  }
}
