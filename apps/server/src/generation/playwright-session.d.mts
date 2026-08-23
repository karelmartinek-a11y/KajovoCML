export class PlaywrightBrowserSession {
  constructor(options: { chromiumBinary?: string; workspace: string; sessionId: string; allowLocal?: boolean });
  start(): Promise<void>;
  open(url: string): Promise<unknown>;
  loadHtmlForTest(html: string): Promise<unknown>;
  state(): Promise<unknown>;
  click(locator: string | Record<string, unknown>): Promise<unknown>;
  fill(locator: string | Record<string, unknown>, value: string): Promise<unknown>;
  fillSecret(locator: string | Record<string, unknown>, value: string): Promise<unknown>;
  select(locator: string | Record<string, unknown>, value: string): Promise<unknown>;
  check(locator: string | Record<string, unknown>): Promise<unknown>;
  uncheck(locator: string | Record<string, unknown>): Promise<unknown>;
  readValue(locator: string | Record<string, unknown>): Promise<string>;
  readText(locator: string | Record<string, unknown>): Promise<string>;
  press(key: string): Promise<unknown>;
  press(locator: string | Record<string, unknown> | null, key: string): Promise<unknown>;
  upload(locator: string | Record<string, unknown>, filePath: string): Promise<unknown>;
  download(locator: string | Record<string, unknown>, destination: string): Promise<unknown>;
  switchPage(targetId: string): Promise<unknown>;
  wait(options: { locator?: string | Record<string, unknown> | null; selector?: string | Record<string, unknown> | null; text?: string | null; urlIncludes?: string | null; readyState?: string | null; timeoutMs?: number }): Promise<unknown>;
  observe(predicate: Record<string, unknown>): Promise<boolean>;
  close(): Promise<void>;
}
