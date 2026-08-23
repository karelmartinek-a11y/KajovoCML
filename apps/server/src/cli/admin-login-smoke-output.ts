export type AdminLoginSmokeOutput = {
  username: string;
  mfaUsed: boolean;
  csrfToken: string;
  sessionCookie: string;
  csrfCookie: string;
};

/**
 * The public/default smoke output is deliberately metadata-only.  The
 * credential-bearing form is reserved for the in-process reference smoke
 * caller, which consumes it through a pipe and never writes it to a log or
 * temporary file.
 */
export function serializeAdminLoginSmokeOutput(input: AdminLoginSmokeOutput, includeCredentials: boolean): string {
  const safe = {
    ok: true,
    username: input.username,
    mfaUsed: input.mfaUsed,
    sessionCookiePresent: Boolean(input.sessionCookie),
    csrfCookiePresent: Boolean(input.csrfCookie),
    csrfContractValid: Boolean(input.csrfToken) && input.csrfToken === input.csrfCookie
  };
  return `${JSON.stringify(includeCredentials ? {
    ...safe,
    csrfToken: input.csrfToken,
    sessionCookie: input.sessionCookie,
    csrfCookie: input.csrfCookie
  } : safe)}\n`;
}
