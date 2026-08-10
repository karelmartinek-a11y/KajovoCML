import type { GenerationPlan } from "../domain/generation.js";
export function normalizeGenerationSecretName(value: unknown): string;
export function generatedInputSecretName(jobId: string, key: string): string;
export function generationSecretGrantElementKeys(plan: GenerationPlan, stableName: string): string[];
export function reconcileGenerationPlanSecrets(planInput: GenerationPlan, input: { jobId: string; activeSecretNames?: Iterable<string> }): {
  plan: GenerationPlan;
  activeSecretNames: Set<string>;
  providerGeneratedSecretNames: Set<string>;
  unsatisfiedRequiredInputs: GenerationPlan["missingInputs"];
};
