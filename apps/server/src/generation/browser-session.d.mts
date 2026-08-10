export type BrowserState = {
  url: string;
  title: string;
  readyState: string;
  text: string;
  targetId: string;
  pages: Array<{ targetId: string; title: string; url: string; active: boolean }>;
  elements: Array<Record<string, unknown> & { locator?: string; accessibleName?: string }>;
};
export class BrowserSession {
  constructor(input: { chromiumBinary: string; workspace: string; sessionId: string; allowLocal?: boolean });
  start(): Promise<void>;
  open(url: string): Promise<BrowserState>;
  loadHtmlForTest(html: string): Promise<BrowserState>;
  state(): Promise<BrowserState>;
  switchPage(targetId: string): Promise<BrowserState>;
  click(locator: string): Promise<BrowserState>;
  fill(locator: string, value: string): Promise<{ ok: true; locator: string }>;
  readValue(locator: string): Promise<string>;
  select(locator: string, value: string): Promise<Record<string, unknown>>;
  press(key: string): Promise<BrowserState>;
  wait(input: { locator?: string | null; selector?: string | null; text?: string | null; urlIncludes?: string | null; readyState?: string | null; timeoutMs?: number }): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
