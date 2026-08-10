export const EXTERNAL_HTTP_METHODS: readonly string[];
export function normalizeExternalMethod(value: unknown, allowedMethods?: Iterable<unknown>): string;
export function normalizeExternalRoute(value: unknown): { pathname: string; search: string; pathAndQuery: string };
export function normalizeExternalHeaders(input?: unknown): Record<string, string>;
export function encodeExternalBody(input: { method?: string; bodyType?: unknown; body?: unknown; payload?: unknown }): { bodyType: string; body?: Buffer; contentType: string | null };
export function applyExternalProviderAuth(input: { authConfig?: Record<string, unknown>; accessToken: string; tokenFingerprint: string; correlationId: string; resolveSecret: (stableName: string) => Promise<{ value: string; fingerprint?: string | null }> }): Promise<{ headers: Record<string,string>; authMode: string; providerSecretFingerprint: string | null }>;
export function externalRouteAllowed(routePattern: unknown, pathname: unknown): boolean;
export function performPinnedHttpsRequest(input: { url: URL | string; method: string; headers?: Record<string,string>; body?: Buffer; timeoutMs: number; address: string; family: number; ca?: string | Buffer }): Promise<{ statusCode: number; headers: Record<string,string>; body: string }>;
