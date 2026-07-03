import { describe, expect, it } from "vitest";
import { RunQueue } from "../src/queue/queue.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("RunQueue", () => {
  it("runs jobs and returns their results", async () => {
    const queue = new RunQueue(2);
    const { promise } = queue.enqueue("g1", async () => 42);
    await expect(promise).resolves.toBe(42);
  });

  it("serializes jobs with the same key", async () => {
    const queue = new RunQueue(4);
    const order: string[] = [];
    const first = deferred<void>();

    const a = queue.enqueue("g1", async () => {
      order.push("a-start");
      await first.promise;
      order.push("a-end");
    });
    const b = queue.enqueue("g1", async () => {
      order.push("b-start");
    });

    await tick();
    expect(order).toEqual(["a-start"]);
    first.resolve();
    await Promise.all([a.promise, b.promise]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("runs different keys concurrently up to the global limit", async () => {
    const queue = new RunQueue(2);
    const gate = deferred<void>();
    let running = 0;
    let peak = 0;

    const job = () => async () => {
      running++;
      peak = Math.max(peak, running);
      await gate.promise;
      running--;
    };

    const jobs = [
      queue.enqueue("g1", job()),
      queue.enqueue("g2", job()),
      queue.enqueue("g3", job()),
    ];
    await tick();
    expect(peak).toBe(2);
    expect(queue.depth).toBe(1);
    gate.resolve();
    await Promise.all(jobs.map((j) => j.promise));
    expect(peak).toBe(2);
  });

  it("does not starve other keys while one key is blocked", async () => {
    const queue = new RunQueue(2);
    const gate = deferred<void>();
    const order: string[] = [];

    const blocked = queue.enqueue("g1", async () => {
      order.push("g1-first");
      await gate.promise;
    });
    const sameKey = queue.enqueue("g1", async () => {
      order.push("g1-second");
    });
    const otherKey = queue.enqueue("g2", async () => {
      order.push("g2");
    });

    await tick();
    expect(order).toEqual(["g1-first", "g2"]);
    gate.resolve();
    await Promise.all([blocked.promise, sameKey.promise, otherKey.promise]);
    expect(order).toEqual(["g1-first", "g2", "g1-second"]);
  });

  it("propagates job errors without breaking the queue", async () => {
    const queue = new RunQueue(1);
    const failing = queue.enqueue("g1", async () => {
      throw new Error("boom");
    });
    await expect(failing.promise).rejects.toThrow("boom");
    const next = queue.enqueue("g1", async () => "ok");
    await expect(next.promise).resolves.toBe("ok");
  });

  it("pauses dispatching while pauseFor is active", async () => {
    const queue = new RunQueue(1);
    queue.pauseFor(30);
    let ran = false;
    const { promise } = queue.enqueue("g1", async () => {
      ran = true;
    });
    await tick();
    expect(ran).toBe(false);
    await promise;
    expect(ran).toBe(true);
  });

  it("reports keyDepth including the running job", async () => {
    const queue = new RunQueue(1);
    const gate = deferred<void>();
    queue.enqueue("g1", async () => {
      await gate.promise;
    });
    queue.enqueue("g1", async () => {});
    await tick();
    expect(queue.keyDepth("g1")).toBe(2);
    expect(queue.keyDepth("g2")).toBe(0);
    gate.resolve();
  });
});
