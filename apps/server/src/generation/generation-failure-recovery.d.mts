export type GenerationTechnicalFailureRecoveryInput = {
  phase: string;
  jobKind: "CREATE" | "REPAIR" | "RETRY";
  attempts: number;
  maxAttempts: number;
  componentIds: string[];
  errorMessage: string;
  eventDetails?: Record<string, unknown>;
  setState: (state: string, params: { blocker?: string | null; remediationAttempts?: number }) => Promise<void>;
  appendEvent: (phase: string, eventType: string, message: string, details?: Record<string, unknown>) => Promise<void>;
  failClosedComponent: (componentId: string) => Promise<void>;
  cleanupCandidate: (componentId: string) => Promise<void>;
  restoreRepairBase: () => Promise<void>;
};
export function recoverGenerationTechnicalFailure(input: GenerationTechnicalFailureRecoveryInput): Promise<{ action: "RETRY_INTEGRATING" | "REIMPLEMENT" | "FAILED"; candidateAbandoned: boolean }>;
