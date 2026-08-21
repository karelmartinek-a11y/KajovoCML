export class PlaywrightBrowserSession {
  constructor(options: { chromiumBinary?: string; workspace: string; sessionId: string; allowLocal?: boolean });
  start(): Promise<void>;
  open(url: string): Promise<unknown>;
  loadHtmlForTest(html: string): Promise<unknown>;
  state(): Promise<unknown>;
  click(locator: string): Promise<unknown>;
  fill(locator: string, value: string): Promise<unknown>;
  select(locator: string, value: string): Promise<unknown>;
  readValue(locator: string): Promise<string>;
  press(key: string): Promise<unknown>;
  switchPage(targetId: string): Promise<unknown>;
  wait(options: { locator?: string | null; selector?: string | null; text?: string | null; urlIncludes?: string | null; readyState?: string | null; timeoutMs?: number }): Promise<unknown>;
  close(): Promise<void>;
}
