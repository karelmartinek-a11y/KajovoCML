export const SESSION_EXPIRED_EVENT = "kcml:session-expired";
export const REAUTH_REQUIRED_EVENT = "kcml:reauth-required";

export function isExpiredAdminSession(status: number, errorCode: string | undefined): boolean {
  return status === 401 && errorCode === "unauthorized";
}
