import type { BecknAction, CallbackAction, Envelope } from "@kiranaai/shared";

export class BecknTimeoutError extends Error {
  constructor(readonly messageId: string, readonly action: string, ms: number) {
    super(`no ${action} for ${messageId} within ${ms} ms`);
  }
}

interface Entry {
  items: Envelope[];
  onItem: (env: Envelope) => void;
}

/**
 * In-memory waiters keyed by (message_id, callback action). This is why Cloud Run is
 * capped at one instance (PRD §13.1).
 *
 * Register BEFORE sending the request: callbacks can arrive before the ACK does.
 *   const reply = waiters.waitFor(msgId, "on_select", 5000);
 *   await becknSend(...);
 *   const env = await reply;
 */
export class Waiters {
  private entries = new Map<string, Entry>();

  private key(messageId: string, action: BecknAction) {
    return `${messageId}|${action}`;
  }

  /** Resolves with the first callback (which may carry `error`); rejects with BecknTimeoutError. */
  waitFor<A extends CallbackAction>(messageId: string, action: A, timeoutMs: number): Promise<Envelope<A>> {
    const key = this.key(messageId, action);
    return new Promise<Envelope<A>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.entries.delete(key);
        reject(new BecknTimeoutError(messageId, action, timeoutMs));
      }, timeoutMs);
      this.entries.set(key, {
        items: [],
        onItem: (env) => {
          clearTimeout(timer);
          this.entries.delete(key);
          resolve(env as Envelope<A>);
        },
      });
    });
  }

  /** Collects every callback that arrives within windowMs (e.g. on_search from several BPPs). */
  collect<A extends CallbackAction>(messageId: string, action: A, windowMs: number): Promise<Envelope<A>[]> {
    const key = this.key(messageId, action);
    const entry: Entry = { items: [], onItem: (env) => entry.items.push(env) };
    this.entries.set(key, entry);
    return new Promise((resolve) =>
      setTimeout(() => {
        this.entries.delete(key);
        resolve(entry.items as Envelope<A>[]);
      }, windowMs),
    );
  }

  /** Called by the BAP callback receiver. Returns true if someone was waiting. */
  deliver(env: Envelope): boolean {
    const entry = this.entries.get(this.key(env.context.message_id, env.context.action));
    if (!entry) return false;
    entry.onItem(env);
    return true;
  }

  get size(): number {
    return this.entries.size;
  }
}
