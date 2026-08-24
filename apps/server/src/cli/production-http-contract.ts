export function applyMutationCsrfHeader(headers: Headers, method: string | undefined, csrfToken: string): void {
  if (!method || ["GET", "HEAD"].includes(method.toUpperCase()) || !csrfToken || headers.has("x-csrf-token")) return;
  headers.set("x-csrf-token", csrfToken);
}
