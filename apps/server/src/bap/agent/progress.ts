import type { AgentTurnProgress, AgentTurnStep } from "@kiranaai/shared";

export const TURN_TTL_MS = 5 * 60_000;
const MAX_STEPS = 16;
const MAX_TURNS = 500;

export const TURN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

interface Entry {
  steps: AgentTurnStep[];
  done: boolean;
  expiresAt: number;
}

/**
 * In-memory live progress of agent turns, keyed by `customerId:turnId` so one customer can never read
 * another's turn. Entries expire 5 min after their last write; expiry is swept lazily on access (no timers).
 */
export class TurnProgressStore {
  private readonly turns = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  private sweep(): void {
    const t = this.now();
    for (const [k, e] of this.turns) if (e.expiresAt <= t) this.turns.delete(k);
    // Hard cap against a flood of turn ids: drop the oldest inserted.
    while (this.turns.size > MAX_TURNS) this.turns.delete(this.turns.keys().next().value as string);
  }

  private touch(e: Entry): void {
    e.expiresAt = this.now() + TURN_TTL_MS;
  }

  private key = (customerId: string, turnId: string) => `${customerId}:${turnId}`;

  start(customerId: string, turnId: string): void {
    this.sweep();
    this.turns.set(this.key(customerId, turnId), { steps: [], done: false, expiresAt: this.now() + TURN_TTL_MS });
  }

  /** A tool began running. Returns the step index for finishStep. */
  beginStep(customerId: string, turnId: string, tool: string): number {
    const e = this.turns.get(this.key(customerId, turnId));
    if (!e || e.steps.length >= MAX_STEPS) return -1;
    e.steps.push({ tool, ok: null, startedAt: new Date(this.now()).toISOString(), endedAt: null, summary: null });
    this.touch(e);
    return e.steps.length - 1;
  }

  finishStep(customerId: string, turnId: string, index: number, r: { ok: boolean; summary: string }): void {
    const e = this.turns.get(this.key(customerId, turnId));
    const s = e?.steps[index];
    if (!e || !s) return;
    s.ok = r.ok;
    s.endedAt = new Date(this.now()).toISOString();
    s.summary = r.summary;
    this.touch(e);
  }

  finish(customerId: string, turnId: string): void {
    const e = this.turns.get(this.key(customerId, turnId));
    if (!e) return;
    e.done = true;
    this.touch(e);
  }

  get(customerId: string, turnId: string): AgentTurnProgress | null {
    this.sweep();
    const e = this.turns.get(this.key(customerId, turnId));
    return e ? { steps: e.steps.map((s) => ({ ...s })), done: e.done } : null;
  }
}
