export type GeneratedCandidateRuntimeSwitchInput = {
  currentPath: string;
  previousReleasePath?: string | null;
  componentCode: string;
  runPrivileged: (operation: "stop" | "restart", componentCode: string) => Promise<unknown>;
};
export function switchGeneratedCandidateRuntime(input: GeneratedCandidateRuntimeSwitchInput): Promise<"RESTORED_PREVIOUS" | "REMOVED_FIRST_CANDIDATE">;
