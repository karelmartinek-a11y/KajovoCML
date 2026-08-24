import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { decryptMfaSecret } from "../security/secrets.js";

/**
 * Resolve deployment smoke MFA from the same canonical OWNER record used by
 * the application. The optional deployment setting is only a fallback for an
 * account that has not enrolled MFA; it never overrides enrolled DB MFA.
 */
export async function resolveAdminTotpSecret(
  db: Db,
  config: Pick<AppConfig, "ADMIN_BOOTSTRAP_USERNAME" | "ADMIN_TOTP_SECRET" | "MFA_ENCRYPTION_KEY_BASE64" | "MFA_ALLOW_PLAINTEXT_LEGACY">
): Promise<string | undefined> {
  const result = await db.query(
    "select id,mfa_enabled,mfa_secret from admin_account where username=$1 and active=true",
    [config.ADMIN_BOOTSTRAP_USERNAME]
  );
  const account = result.rows[0] as { id?: unknown; mfa_enabled?: unknown; mfa_secret?: unknown } | undefined;
  if (account?.mfa_enabled === true && typeof account.mfa_secret === "string" && account.mfa_secret.length > 0) {
    return decryptMfaSecret(account.mfa_secret, config.MFA_ENCRYPTION_KEY_BASE64, {
      allowLegacyPlaintext: config.MFA_ALLOW_PLAINTEXT_LEGACY,
      subjectId: String(account.id),
      purpose: "admin_totp"
    });
  }
  return config.ADMIN_TOTP_SECRET?.trim() || undefined;
}
