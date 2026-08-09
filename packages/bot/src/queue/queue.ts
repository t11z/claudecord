/**
 * Serial-per-key queue with a global concurrency cap. Each Claude run spawns
 * a CLI subprocess, so the global semaphore is load-bearing for host sizing.
 * Keys are Discord user IDs: one run at a time per user, fair FIFO globally.
 * Runs are billed to individual users' own subscriptions, so a rate limit or
 * backoff on one user's key must never block anyone else's.
 */

interface Job {
  key: string;
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class RunQueue {
  private readonly pending: Job[] = [];
  private readonly activeKeys = new Set<string>();
  private running = 0;
  private readonly pausedUntil = new Map<string, number>();

  constructor(private readonly globalLimit: number) {
    if (globalLimit < 1) throw new Error("globalLimit must be >= 1");
  }

  /**
   * Enqueue work under a key. Returns the queue position at enqueue time
   * (0 = starts immediately) and a promise for the job's result.
   */
  enqueue<T>(key: string, fn: () => Promise<T>): { position: number; promise: Promise<T> } {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const position = this.pending.length + this.running;
    this.pending.push({ key, fn: fn as () => Promise<unknown>, resolve, reject });
    queueMicrotask(() => this.pump());
    return { position, promise: promise as Promise<T> };
  }

  /**
   * Pause dispatching for a single key (rate-limit backoff). Running jobs and
   * every other key are unaffected.
   */
  pauseKey(key: string, ms: number): void {
    const until = Date.now() + ms;
    if (until > (this.pausedUntil.get(key) ?? 0)) {
      this.pausedUntil.set(key, until);
      setTimeout(() => this.pump(), ms + 1);
    }
  }

  get depth(): number {
    return this.pending.length;
  }

  get activeRuns(): number {
    return this.running;
  }

  keyDepth(key: string): number {
    return this.pending.filter((j) => j.key === key).length + (this.activeKeys.has(key) ? 1 : 0);
  }

  private pump(): void {
    const now = Date.now();
    while (this.running < this.globalLimit) {
      const index = this.pending.findIndex(
        (j) => !this.activeKeys.has(j.key) && (this.pausedUntil.get(j.key) ?? 0) <= now,
      );
      if (index === -1) return;
      const job = this.pending.splice(index, 1)[0]!;
      this.running++;
      this.activeKeys.add(job.key);
      job
        .fn()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running--;
          this.activeKeys.delete(job.key);
          this.pump();
        });
    }
  }
}
