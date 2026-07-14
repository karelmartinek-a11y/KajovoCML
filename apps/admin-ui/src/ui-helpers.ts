import { isExpiredAdminSession, SESSION_EXPIRED_EVENT } from "./session-auth.js";
import type { KajaCredential } from "./types.js";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch((): { error?: string } => ({ error: res.statusText })) as { error?: string };
    if (isExpiredAdminSession(res.status, body.error)) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new Error(describeApiError(body.error ?? res.statusText));
  }
  return res.json() as Promise<T>;
}

export function describeApiError(code: string): string {
  const map: Record<string, string> = {
    unauthorized: "Relace vypršela. Přihlaste se prosím znovu.",
    invalid_login: "Přihlášení se nepodařilo. Zkontrolujte jméno, heslo a MFA kód.",
    login_rate_limited: "Bylo zaznamenáno příliš mnoho pokusů o přihlášení. Chvíli počkejte a zkuste to znovu.",
    csrf_failed: "Bezpečnostní kontrola formuláře selhala. Obnovte stránku a akci zopakujte.",
    invalid_permissions: "Oprávnění nejsou v platném formátu.",
    invalid_label: "Zadané označení není platné.",
    invalid_expiration: "Datum expirace musí být v budoucnosti.",
    suppression_must_be_future: "Konec potlačení musí být v budoucnosti.",
    handler_unavailable: "Server v této verzi aplikace nemá dostupný handler.",
    manifest_test_contract_missing: "Server nemá zaregistrovaný testovací kontrakt pro bezpečný test.",
    rate_limit_exceeded: "Byl překročen povolený limit volání. Zkuste to znovu později.",
    weak_password: "Nové heslo musí mít alespoň 12 znaků.",
    invalid_mfa_secret: "MFA tajemství musí mít alespoň 16 znaků."
  };
  return map[code] ?? code;
}

export function csrf(): string {
  return document.cookie.split("; ").find((row) => row.startsWith("__Host-kcml_csrf="))?.split("=")[1] ?? "";
}

export function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("cs-CZ", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Prague"
    }).format(new Date(value))
    : "-";
}

export function formatLocalDateTimeInput(value: Date): string {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function statusClass(credential: KajaCredential): string {
  if (credential.revokedAt || !credential.active) return "danger";
  if (credential.expiresAt && new Date(credential.expiresAt).getTime() - Date.now() < 7 * 24 * 3600 * 1000) return "warn";
  return "ok";
}

export function recertificationState(reviewDueAt: string | null): { tone: "neutral" | "warning" | "danger"; label: string } {
  if (!reviewDueAt) return { tone: "neutral", label: "Bez data revize" };
  const deltaMs = new Date(reviewDueAt).getTime() - Date.now();
  if (deltaMs <= 0) return { tone: "danger", label: "Revize po splatnosti" };
  if (deltaMs <= 14 * 24 * 3600 * 1000) return { tone: "warning", label: "Blíží se revize" };
  return { tone: "neutral", label: "Revize naplánována" };
}
