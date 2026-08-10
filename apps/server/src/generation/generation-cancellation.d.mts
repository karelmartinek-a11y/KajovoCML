export function runWithCancellationPolling<T>(input: {
  assertActive: () => Promise<void>;
  isCancelled: (error: unknown) => boolean;
  operation: (signal: AbortSignal) => Promise<T>;
  onCheckError?: (error: unknown) => void;
  pollMs?: number;
}): Promise<T>;
export function throwIfCancellationSignalled(signal?: AbortSignal, fallback?: () => Error): void;
