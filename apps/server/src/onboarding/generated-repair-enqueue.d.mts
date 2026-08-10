export function generatedRepairEnqueueAlertType(componentId: string): string;

export function attemptGeneratedRepairEnqueue<T>(input: {
  enqueue: () => Promise<T>;
  onFailure: (error: unknown) => Promise<void>;
  onRecovered: (result: T) => Promise<void>;
}): Promise<T | null>;

export function attemptGeneratedRepairEnqueueWithCmlEvidence<T>(input: {
  componentId: string;
  correlationId: string;
  evidence: Record<string, unknown>;
  enqueue: () => Promise<T>;
  withTransaction: (operation: (client: unknown) => Promise<void>) => Promise<void>;
  raiseAlert: (client: unknown, input: Record<string, unknown>) => Promise<unknown>;
  appendAudit: (client: unknown, input: Record<string, unknown>) => Promise<unknown>;
  closeAlert: (client: unknown, input: Record<string, unknown>) => Promise<unknown>;
  logEvidenceFailure?: (payload: Record<string, unknown>) => void;
  logCloseFailure?: (payload: Record<string, unknown>) => void;
}): Promise<T | null>;
