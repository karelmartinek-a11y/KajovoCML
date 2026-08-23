declare module "*browser-automation-runtime.mjs" {
  export type BrowserAutomationStepResult = {
    index: number;
    action: string;
    status: "SUCCEEDED" | "FAILED";
    startedAt: string;
    completedAt: string;
    output?: unknown;
    errorCode?: string;
  };
  export type BrowserAutomationResult = {
    status: "SUCCEEDED";
    output: Record<string, unknown>;
    steps: BrowserAutomationStepResult[];
  };
  export function validateManifest(manifest: unknown): Record<string, unknown>;
  export function runBrowserAutomation(input: {
    manifest: unknown;
    input?: Record<string, unknown>;
    workspace: string;
    sessionId: string;
    chromiumBinary?: string;
    allowLocal?: boolean;
    signal?: AbortSignal;
  }): Promise<BrowserAutomationResult>;
}
