declare module "*browser-automation-runtime.mjs" {
  export type BrowserAutomationStepResult = {
    index: number | string;
    action: string;
    status: "SUCCEEDED" | "FAILED" | "UNCERTAIN";
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
    resolveSecret?: (stableName: string) => Promise<string>;
  }): Promise<BrowserAutomationResult>;
}

declare module "*playwright-session.mjs" {
  export type BrowserSessionState = {
    url: string;
    title: string;
    text: string;
    viewport: { width: number; height: number } | null;
    targetId: string;
    targets: Array<{ id: string; url: string }>;
    pages: Array<{ targetId: string; url: string }>;
    locators: Array<{ locator: string; tag: string; text: string; type: string | null }>;
    elements: Array<{ locator: string; accessibleName: string; text: string; value: string }>;
  };
  export type BrowserScreenshot = { body: Buffer; url: string; title: string; width: number | null; height: number | null };
  export class PlaywrightBrowserSession {
    constructor(input: { chromiumBinary?: string; workspace: string; sessionId: string; allowLocal?: boolean });
    open(value: string): Promise<BrowserSessionState>;
    state(): Promise<BrowserSessionState>;
    screenshot(): Promise<BrowserScreenshot>;
    close(): Promise<void>;
  }
}
