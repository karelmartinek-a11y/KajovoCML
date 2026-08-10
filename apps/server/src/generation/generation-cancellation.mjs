export async function runWithCancellationPolling({ assertActive, isCancelled, operation, onCheckError = () => {}, pollMs = 500 }) {
  const controller = new AbortController();
  let checking = false;
  const check = async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try { await assertActive(); }
    catch (error) {
      if (isCancelled(error)) controller.abort(error);
      else onCheckError(error);
    } finally { checking = false; }
  };
  await check();
  if (controller.signal.aborted) throw controller.signal.reason;
  const timer = setInterval(() => { void check(); }, Math.max(10, Number(pollMs) || 500));
  timer.unref?.();
  try { return await operation(controller.signal); }
  finally { clearInterval(timer); }
}

export function throwIfCancellationSignalled(signal, fallback = () => new Error("generation_job_cancelled")) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : fallback();
}
