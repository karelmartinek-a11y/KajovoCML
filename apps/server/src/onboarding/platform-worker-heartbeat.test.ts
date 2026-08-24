import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db.js";
import { runWithPeriodicPlatformWorkerHeartbeat } from "./platform-worker-heartbeat.js";

describe("periodic platform worker heartbeat", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps readiness heartbeat fresh while a long operation is still running", async () => {
    vi.useFakeTimers();
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    let complete: ((value: string) => void) | undefined;
    const operation = new Promise<string>((resolve) => { complete = resolve; });

    const running = runWithPeriodicPlatformWorkerHeartbeat(
      { query } as unknown as Db,
      { workerKind: "GENERATION", workerId: "generation-test", buildId: "build-test" },
      () => operation,
      30_000
    );

    await vi.advanceTimersByTimeAsync(95_000);
    expect(query).toHaveBeenCalledTimes(3);
    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(calls.every((call) => call[1]?.[3] === false)).toBe(true);

    complete?.("done");
    await expect(running).resolves.toBe("done");
  });

  it("fails the worker iteration if its periodic heartbeat cannot be persisted", async () => {
    vi.useFakeTimers();
    const query = vi.fn(async () => { throw new Error("heartbeat_write_failed"); });
    let complete: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => { complete = resolve; });

    const running = runWithPeriodicPlatformWorkerHeartbeat(
      { query } as unknown as Db,
      { workerKind: "GENERATION", workerId: "generation-test", buildId: "build-test" },
      () => operation,
      30_000
    );

    await vi.advanceTimersByTimeAsync(30_000);
    complete?.();
    await expect(running).rejects.toThrow("heartbeat_write_failed");
  });
});
