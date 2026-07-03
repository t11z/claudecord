/**
 * Serial-per-key queue with a global concurrency cap. Each Claude run spawns
 * a CLI subprocess, so the global semaphore is load-bearing for host sizing.
 * Keys are guild IDs: one run at a time per guild, fair FIFO globally.
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
  private pausedUntil = 0;

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

  /** Pause dispatching (rate-limit backoff). Running jobs are unaffected. */
  pauseFor(ms: number): void {
    const until = Date.now() + ms;
    if (until > this.pausedUntil) {
      this.pausedUntil = until;
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
    if (Date.now() < this.pausedUntil) return;
    while (this.running < this.globalLimit) {
      const index = this.pending.findIndex((j) => !this.activeKeys.has(j.key));
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
