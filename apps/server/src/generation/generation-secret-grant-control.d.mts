export type GenerationSecretGrantControlInput<TSecret = unknown, TComponent = { componentId: string }> = {
  stableSecretName: string;
  elementKeys?: string[];
  findActiveSecret: (stableName: string) => Promise<TSecret | null | undefined>;
  grantPlatform: (secret: TSecret) => Promise<void>;
  listComponents: (elementKeys: string[]) => Promise<TComponent[]>;
  grantComponent: (secret: TSecret, component: TComponent) => Promise<void>;
};
export function grantGenerationSecretBeforeResume<TSecret = unknown, TComponent extends { componentId: string } = { componentId: string }>(input: GenerationSecretGrantControlInput<TSecret, TComponent>): Promise<{ available: boolean; stableName: string; grantedElementKeys: string[]; componentIds: string[] }>;
export function resumeGenerationAfterSatisfiedInputs(input: {
  resumeState: string;
  ensureIntegrationGrants: () => Promise<void>;
  setState: (state: string) => Promise<void>;
  clearResumeState: () => Promise<void>;
  appendCompleteEvent: (state: string) => Promise<void>;
}): Promise<void>;
