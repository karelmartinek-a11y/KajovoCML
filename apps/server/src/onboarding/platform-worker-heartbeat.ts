import type { Db } from "../db.js";

export type PlatformWorkerKind = "COMPONENT_CONTROL" | "COMPONENT_E2E" | "GENERATION" | "BROWSER_AUTOMATION";

export async function recordPlatformWorkerHeartbeat(db: Db, input: {
  workerKind: PlatformWorkerKind;
  workerId: string;
  buildId: string;
  completed: boolean;
  error?: string | null;
}): Promise<void> {
  await db.query(
    `insert into platform_worker_heartbeat(
       worker_kind,worker_id,build_id,started_at,last_heartbeat_at,last_completed_at,last_error
     ) values ($1,$2,$3,now(),now(),case when $4 then now() end,$5)
     on conflict (worker_kind) do update set
       worker_id=excluded.worker_id,
       build_id=excluded.build_id,
       started_at=case when platform_worker_heartbeat.worker_id=excluded.worker_id then platform_worker_heartbeat.started_at else now() end,
       last_heartbeat_at=now(),
       last_completed_at=case when $4 then now() else platform_worker_heartbeat.last_completed_at end,
       last_error=$5,
       updated_at=now()`,
    [input.workerKind, input.workerId, input.buildId, input.completed, input.error?.slice(0, 500) ?? null]
  );
}

export async function runWithPeriodicPlatformWorkerHeartbeat<T>(
  db: Db,
  input: { workerKind: PlatformWorkerKind; workerId: string; buildId: string },
  operation: () => Promise<T>,
  intervalMs = 30_000
): Promise<T> {
  let inFlight: Promise<void> | undefined;
  let heartbeatError: unknown;
  let operationError: unknown;
  let result: T | undefined;
  const heartbeat = () => {
    if (inFlight) return;
    inFlight = recordPlatformWorkerHeartbeat(db, { ...input, completed: false })
      .catch((error: unknown) => { heartbeatError = error; })
      .finally(() => { inFlight = undefined; });
  };
  const timer = setInterval(heartbeat, intervalMs);
  timer.unref();
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  } finally {
    clearInterval(timer);
    if (inFlight) await inFlight;
  }
  if (operationError) throw operationError instanceof Error ? operationError : new Error("platform_worker_operation_failed");
  if (heartbeatError) throw heartbeatError instanceof Error ? heartbeatError : new Error("platform_worker_heartbeat_failed");
  return result as T;
}
