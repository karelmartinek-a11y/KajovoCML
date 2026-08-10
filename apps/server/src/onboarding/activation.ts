import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ActivationConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import type { OnboardingManifest } from "../domain/registration.js";
import { hashPasswordLikeSecret, issueOpaqueSecret } from "../security/secrets.js";

async function jsonRequest(url: string, init: RequestInit): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(65_000), redirect: "manual" });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

function assertStatus(response: Response, expected: number, code: string): void {
  if (response.status !== expected) throw new Error(`${code}:${response.status}`);
}

export function matchesExpectedResult(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((item, index) => matchesExpectedResult(actual[index], item));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(
      ([key, value]) => Object.hasOwn(actual, key)
        && matchesExpectedResult((actual as Record<string, unknown>)[key], value)
    );
  }
  return isDeepStrictEqual(actual, expected);
}

async function createSystemCredential(db: Db, serverId: string): Promise<{ id: string; publicId: string; secret: string }> {
  const secret = issueOpaqueSecret();
  const hash = await hashPasswordLikeSecret(secret.value);
  return tx(db, async (client) => {
    const number = await client.query("select nextval('kaja_number_seq') as number");
    const publicId = `Kaja${String(Number(number.rows[0].number)).padStart(4, "0")}`;
    const inserted = await client.query(
      `insert into kaja_credential(public_id,label,secret_hash,secret_fingerprint,expires_at)
       values ($1,'System monitoring probe',$2,$3,now()+interval '15 minutes') returning id`,
      [publicId, hash, secret.fingerprint]
    );
    const id = String(inserted.rows[0].id);
    await client.query("insert into kaja_permission(credential_id,server_id,access_level) values ($1,$2,'EXECUTE')", [id, serverId]);
    return { id, publicId, secret: secret.value };
  });
}

async function revokeSystemCredential(db: Db, credentialId: string): Promise<void> {
  await tx(db, async (client) => {
    await client.query("update access_token set revoked_at=coalesce(revoked_at,now()) where credential_id=$1", [credentialId]);
    await client.query("update kaja_permission set revoked_at=coalesce(revoked_at,now()) where credential_id=$1", [credentialId]);
    await client.query("update kaja_credential set active=false,revoked_at=coalesce(revoked_at,now()),deleted_at=coalesce(deleted_at,now()),revocation_epoch=gen_random_uuid() where id=$1", [credentialId]);
  });
}

async function rpc(hostname: string, token: string | null, method: string, params?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return jsonRequest(`https://${hostname}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params })
  });
}

export async function runSyntheticMonitoringProbe(
  db: Db,
  config: Pick<ActivationConfig, "AUTH_HOST">,
  server: { id: string; hostname: string; toolName: string },
  manifest: OnboardingManifest
): Promise<{ correlationId: string }> {
  const credential = await createSystemCredential(db, server.id);
  let accessToken = "";
  try {
    const resource = `https://${server.hostname}/mcp`;
    const token = await jsonRequest(`https://${config.AUTH_HOST}/oauth/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${encodeURIComponent(credential.publicId)}:${encodeURIComponent(credential.secret)}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "client_credentials", resource }).toString()
    });
    assertStatus(token.response, 200, "monitor_oauth_failed");
    accessToken = String((token.body as { access_token?: string }).access_token ?? "");
    if (!accessToken) throw new Error("monitor_access_token_missing");
    const call = await rpc(server.hostname, accessToken, "tools/call", { name: server.toolName, arguments: manifest.testContract.safeInput });
    assertStatus(call.response, 200, "monitor_synthetic_call_failed");
    const output = (call.body as { result?: { structuredContent?: unknown }; error?: unknown }).result?.structuredContent;
    if ((call.body as { error?: unknown }).error || !matchesExpectedResult(output, manifest.testContract.expectedResult)) throw new Error("monitor_synthetic_result_mismatch");
    const correlationId = call.response.headers.get("x-correlation-id");
    if (!correlationId) throw new Error("monitor_correlation_missing");
    return { correlationId };
  } finally {
    await revokeSystemCredential(db, credential.id);
    accessToken = "";
  }
}
