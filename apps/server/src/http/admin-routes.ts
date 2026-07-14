import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { authenticator } from "otplib";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { appendAudit, verifyAuditChain } from "../domain/audit.js";
import {
  createKajaCredential,
  deleteKajaCredential,
  listKajaCredentials,
  listKajaPermissions,
  replaceKajaPermissions,
  renameKajaCredential,
  revokeKajaCredential
} from "../domain/auth.js";
import { getServerById, listServers } from "../domain/catalog.js";
import { listOperationalConfig, updateOperationalConfig } from "../domain/operational-config.js";
import { matchesExpectedResult } from "../onboarding/activation.js";
import { decryptMfaSecret, encryptMfaSecret, hmacToken } from "../security/secrets.js";
import { getHandler } from "../handlers/registry.js";
import { hostOf, sendError } from "./errors.js";

const SESSION_COOKIE = "__Host-kcml_session";
const CSRF_COOKIE = "__Host-kcml_csrf";
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_BASE_MS = 30 * 1000;
const registrationManifestSchema = z.object({
  testContract: z.object({
    safeInput: z.record(z.unknown()),
    expectedResult: z.unknown()
  })
});
const monitoringProfileSchema = z.object({
  enabled: z.boolean(),
  profile: z.object({
    sloTargets: z.record(z.unknown()),
    probeIntervals: z.record(z.unknown()),
    alertRules: z.array(z.record(z.unknown())),
    runbookRef: z.string().min(1),
    primaryAlertChannel: z.string().min(1),
    backupAlertChannel: z.string().min(1)
  })
});
const adminAccountCreateSchema = z.object({
  username: z.string().trim().min(3).max(120),
  password: z.string().min(12),
  mfaSecret: z.string().trim().min(16).optional().or(z.literal(""))
});
const adminAccountPasswordSchema = z.object({
  nextPassword: z.string().min(12)
});
const adminAccountMfaSchema = z.object({
  enabled: z.boolean(),
  secret: z.string().trim().min(16).optional().or(z.literal(""))
});
const bootstrapSetupSchema = z.object({
  username: z.string().trim().min(3).max(120),
  password: z.string().min(12),
  mfaSecret: z.string().trim().min(16).optional().or(z.literal(""))
});
const operationalConfigUpdateSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()])
});
const loginAttempts = new Map<string, { count: number; lastFailedAt: number; lockedUntil: number }>();

type AdminSession = {
  accountId: string;
  accountName: string;
  sessionId: string;
};

export async function sessionAccount(db: Db, request: FastifyRequest, config: AppConfig): Promise<AdminSession | null> {
  const value = request.cookies[SESSION_COOKIE];
  if (!value) return null;
  const lookupDigest = hmacToken(value, config.SESSION_SECRET_BASE64);
  const indexed = await db.query(
    `select s.id, s.account_id, s.session_hash, a.username
       from admin_session s
       join admin_account a on a.id=s.account_id
      where s.lookup_digest=$1 and s.expires_at > now() and s.revoked_at is null`,
    [lookupDigest]
  );
  if (indexed.rowCount && await argon2.verify(String(indexed.rows[0].session_hash), value)) {
    return {
      accountId: String(indexed.rows[0].account_id),
      accountName: String(indexed.rows[0].username),
      sessionId: String(indexed.rows[0].id)
    };
  }
  const sessions = await db.query(
    `select s.id, s.account_id, s.session_hash, a.username
       from admin_session s
       join admin_account a on a.id=s.account_id
      where s.lookup_digest is null and s.expires_at > now() and s.revoked_at is null`
  );
  for (const row of sessions.rows) {
    if (await argon2.verify(String(row.session_hash), value)) {
      await db.query("update admin_session set lookup_digest=$2 where id=$1 and lookup_digest is null", [row.id, lookupDigest]);
      return {
        accountId: String(row.account_id),
        accountName: String(row.username),
        sessionId: String(row.id)
      };
    }
  }
  return null;
}

export function requireCsrf(request: FastifyRequest): boolean {
  const cookie = request.cookies[CSRF_COOKIE];
  const header = request.headers["x-csrf-token"];
  return Boolean(cookie && header && cookie === header);
}

function loginAttemptKey(request: FastifyRequest, username: string): string {
  const forwarded = request.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : request.ip;
  return `${String(ip ?? "unknown").toLowerCase()}:${username.trim().toLowerCase()}`;
}

function getLoginLockState(request: FastifyRequest, username: string): { blocked: boolean; retryAfterSeconds: number } {
  const key = loginAttemptKey(request, username);
  const state = loginAttempts.get(key);
  if (!state) return { blocked: false, retryAfterSeconds: 0 };
  const now = Date.now();
  if (state.lastFailedAt < now - LOGIN_ATTEMPT_WINDOW_MS && state.lockedUntil <= now) {
    loginAttempts.delete(key);
    return { blocked: false, retryAfterSeconds: 0 };
  }
  if (state.lockedUntil > now) {
    return { blocked: true, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) };
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

function recordLoginFailure(request: FastifyRequest, username: string): void {
  const key = loginAttemptKey(request, username);
  const current = loginAttempts.get(key);
  const now = Date.now();
  const count = !current || current.lastFailedAt < now - LOGIN_ATTEMPT_WINDOW_MS ? 1 : current.count + 1;
  const lockSteps = Math.max(0, count - 3);
  loginAttempts.set(key, {
    count,
    lastFailedAt: now,
    lockedUntil: lockSteps > 0 ? now + LOGIN_LOCK_BASE_MS * 2 ** (lockSteps - 1) : 0
  });
}

function clearLoginFailures(request: FastifyRequest, username: string): void {
  loginAttempts.delete(loginAttemptKey(request, username));
}

async function bootstrapRequired(db: Db): Promise<boolean> {
  const result = await db.query("select count(*)::int as count from admin_account where password_hash is not null");
  return Number(result.rows[0]?.count ?? 0) === 0;
}

function generateRecoveryCode(): string {
  return `${randomBytes(3).toString("hex")}-${randomBytes(3).toString("hex")}-${randomBytes(3).toString("hex")}`.toUpperCase();
}

async function bootstrapAdminAccount(
  db: Db,
  correlationId: string,
  input: unknown,
  encryptionKey: Buffer
): Promise<{ username: string; recoveryCodes: string[] }> {
  const parsed = bootstrapSetupSchema.parse(input);
  const passwordHash = await argon2.hash(parsed.password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const storedMfaSecret = parsed.mfaSecret?.trim() ? encryptMfaSecret(parsed.mfaSecret.trim(), encryptionKey) : null;
  const recoveryCodes = Array.from({ length: 8 }, generateRecoveryCode);
  const recoveryHashes = await Promise.all(recoveryCodes.map((code) => argon2.hash(code, { type: argon2.argon2id, memoryCost: 32768, timeCost: 2, parallelism: 1 })));
  return tx(db, async (client) => {
    const existing = await client.query("select count(*)::int as count from admin_account where password_hash is not null");
    if (Number(existing.rows[0]?.count ?? 0) > 0) throw Object.assign(new Error("bootstrap_closed"), { statusCode: 409 });
    const inserted = await client.query(
      `insert into admin_account(username, password_hash, password_changed_at, mfa_enabled, mfa_secret)
       values ($1,$2,now(),$3,$4)
       returning id, username`,
      [parsed.username, passwordHash, Boolean(storedMfaSecret), storedMfaSecret]
    );
    for (const hash of recoveryHashes) {
      await client.query(
        "insert into admin_recovery_code(account_id, code_hash) values ($1,$2)",
        [inserted.rows[0].id, hash]
      );
    }
    await appendAudit(client, {
      eventType: "admin.bootstrap.completed",
      actorType: "bootstrap",
      objectType: "admin_account",
      objectId: String(inserted.rows[0].id),
      after: { username: inserted.rows[0].username, recoveryCodeCount: recoveryCodes.length, mfaEnabled: Boolean(storedMfaSecret) },
      correlationId
    });
    return { username: String(inserted.rows[0].username), recoveryCodes };
  });
}

async function consumeRecoveryCode(db: Db, accountId: string, code: string): Promise<boolean> {
  if (!code.trim()) return false;
  const result = await db.query(
    "select id, code_hash from admin_recovery_code where account_id=$1 and consumed_at is null order by created_at asc",
    [accountId]
  );
  for (const row of result.rows) {
    if (await argon2.verify(String(row.code_hash), code.trim())) {
      await db.query("update admin_recovery_code set consumed_at=now() where id=$1 and consumed_at is null", [row.id]);
      return true;
    }
  }
  return false;
}

async function setServerEnabled(
  db: Db,
  actorId: string,
  correlationId: string,
  serverId: string,
  enabled: boolean
): Promise<{ registrationState: string; operationalState: string }> {
  return tx(db, async (client) => {
    const current = await client.query(
      `select ms.id, ms.code, ms.enabled, ms.registration_state, ms.operational_state, rr.manifest->'change'->>'reviewDueAt' as review_due_at
         from mcp_server ms
         left join lateral (
           select manifest
             from registration_revision
            where server_id=ms.id
            order by created_at desc
            limit 1
         ) rr on true
        where ms.id=$1 for update`,
      [serverId]
    );
    if (!current.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    const row = current.rows[0];
    const currentEnabled = Boolean(row.enabled);
    const reviewDueAt = typeof row.review_due_at === "string" ? new Date(row.review_due_at) : null;
    const reviewOverdue = Boolean(reviewDueAt && reviewDueAt.getTime() <= Date.now());
    if (currentEnabled === enabled) {
      if (enabled && reviewOverdue) {
        await appendAudit(client, {
          eventType: "mcp_server.enable_blocked",
          actorType: "admin",
          actorId,
          objectType: "mcp_server",
          objectId: serverId,
          after: { code: row.code, reason: "review_due_overdue", reviewDueAt: row.review_due_at },
          correlationId
        });
        throw Object.assign(new Error("recertification_overdue"), { statusCode: 409 });
      }
      return {
        registrationState: String(row.registration_state),
        operationalState: String(row.operational_state)
      };
    }
    if (enabled && reviewOverdue) {
      await appendAudit(client, {
        eventType: "mcp_server.enable_blocked",
        actorType: "admin",
        actorId,
        objectType: "mcp_server",
        objectId: serverId,
        after: { code: row.code, reason: "review_due_overdue", reviewDueAt: row.review_due_at },
        correlationId
      });
      throw Object.assign(new Error("recertification_overdue"), { statusCode: 409 });
    }
    const nextRegistrationState = enabled
      ? (String(row.registration_state) === "REGISTERED_DISABLED" ? "ACTIVE" : String(row.registration_state))
      : (["ACTIVE", "TRIAL"].includes(String(row.registration_state)) ? "REGISTERED_DISABLED" : String(row.registration_state));
    const nextOperationalState = enabled ? "UNKNOWN" : "DISABLED";
    await client.query(
      `update mcp_server
          set enabled=$2,
              registration_state=$3,
              operational_state=$4,
              revocation_epoch=gen_random_uuid(),
              lock_version=lock_version+1,
              updated_at=now()
        where id=$1`,
      [serverId, enabled, nextRegistrationState, nextOperationalState]
    );
    if (!enabled) {
      await client.query("update access_token set revoked_at=coalesce(revoked_at, now()) where server_id=$1", [serverId]);
    }
    await appendAudit(client, {
      eventType: enabled ? "mcp_server.enabled" : "mcp_server.disabled",
      actorType: "admin",
      actorId,
      objectType: "mcp_server",
      objectId: serverId,
      after: { code: row.code, registrationState: nextRegistrationState, operationalState: nextOperationalState },
      correlationId
    });
    return {
      registrationState: nextRegistrationState,
      operationalState: nextOperationalState
    };
  });
}

async function runServerTest(db: Db, serverId: string, correlationId: string, actorId: string): Promise<{
  ok: boolean;
  latencyMs: number;
  output?: unknown;
}> {
  const server = await getServerById(db, serverId);
  if (!server) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  const reviewDueAt = server.reviewDueAt ? new Date(server.reviewDueAt) : null;
  if (reviewDueAt && reviewDueAt.getTime() <= Date.now()) {
    throw Object.assign(new Error("recertification_overdue"), { statusCode: 409 });
  }
  const manifestResult = await db.query(
    `select manifest
       from registration_revision
      where server_id=$1
      order by created_at desc
      limit 1`,
    [serverId]
  );
  if (!manifestResult.rowCount) throw Object.assign(new Error("manifest_not_found"), { statusCode: 404 });
  const parsed = registrationManifestSchema.safeParse(manifestResult.rows[0].manifest);
  if (!parsed.success) throw Object.assign(new Error("manifest_test_contract_missing"), { statusCode: 409 });
  const handler = getHandler(server);
  if (!handler) throw Object.assign(new Error("handler_unavailable"), { statusCode: 503 });
  const started = Date.now();
  const output = await Promise.race([
    handler.invoke(parsed.data.testContract.safeInput, {
      correlationId,
      server,
      logger: {
        info: async (fields, message) => {
          await db.query(
            `insert into runtime_log_event(server_id,level,event_name,fields,correlation_id,image_digest)
             values ($1,'info',$2,$3,$4,$5)`,
            [server.id, String(message ?? "admin.test.info"), JSON.stringify(fields), correlationId, server.imageDigest]
          );
        },
        error: async (fields, message) => {
          await db.query(
            `insert into runtime_log_event(server_id,level,event_name,fields,correlation_id,image_digest)
             values ($1,'error',$2,$3,$4,$5)`,
            [server.id, String(message ?? "admin.test.error"), JSON.stringify(fields), correlationId, server.imageDigest]
          );
        }
      }
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error("handler_timeout"), { statusCode: 504 })), server.timeoutMs);
    })
  ]);
  const latencyMs = Date.now() - started;
  const ok = matchesExpectedResult(output, parsed.data.testContract.expectedResult);
  await appendAudit(db, {
    eventType: ok ? "mcp_server.test.passed" : "mcp_server.test.failed",
    actorType: "admin",
    actorId,
    objectType: "mcp_server",
    objectId: serverId,
    after: { latencyMs, correlationId, ok },
    correlationId
  });
  return { ok, latencyMs, output };
}

async function getMonitoringProfile(db: Db, serverId: string): Promise<{ enabled: boolean; profile: Record<string, unknown> }> {
  const result = await db.query("select enabled, profile from monitoring_profile where server_id=$1", [serverId]);
  if (result.rowCount) {
    return {
      enabled: Boolean(result.rows[0].enabled),
      profile: result.rows[0].profile as Record<string, unknown>
    };
  }
  const manifestResult = await db.query(
    `select manifest
       from registration_revision
      where server_id=$1
      order by created_at desc
      limit 1`,
    [serverId]
  );
  if (!manifestResult.rowCount) throw Object.assign(new Error("monitoring_profile_not_found"), { statusCode: 404 });
  const manifest = manifestResult.rows[0].manifest as { monitoringProfile?: Record<string, unknown> };
  return {
    enabled: false,
    profile: manifest.monitoringProfile ?? {
      sloTargets: {},
      probeIntervals: {},
      alertRules: [],
      runbookRef: "",
      primaryAlertChannel: "",
      backupAlertChannel: ""
    }
  };
}

async function saveMonitoringProfile(
  db: Db,
  actorId: string,
  correlationId: string,
  serverId: string,
  input: unknown
): Promise<{ enabled: boolean; profile: Record<string, unknown> }> {
  const parsed = monitoringProfileSchema.parse(input);
  return tx(db, async (client) => {
    const server = await client.query("select id, code from mcp_server where id=$1 for update", [serverId]);
    if (!server.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    await client.query(
      `insert into monitoring_profile(server_id, profile, enabled)
       values ($1, $2, $3)
       on conflict (server_id) do update
         set profile=excluded.profile,
             enabled=excluded.enabled,
             updated_at=now()`,
      [serverId, parsed.profile, parsed.enabled]
    );
    await appendAudit(client, {
      eventType: "monitoring_profile.updated",
      actorType: "admin",
      actorId,
      objectType: "mcp_server",
      objectId: serverId,
      after: { code: server.rows[0].code, enabled: parsed.enabled, profile: parsed.profile },
      correlationId
    });
    return parsed;
  });
}

async function listAdminSessions(db: Db, accountId: string, currentSessionId: string): Promise<Array<{
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}>> {
  const result = await db.query(
    `select id, created_at, expires_at
       from admin_session
      where account_id=$1 and revoked_at is null and expires_at > now()
      order by created_at desc`,
    [accountId]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    current: String(row.id) === currentSessionId
  }));
}

async function changeAdminPassword(
  db: Db,
  session: AdminSession,
  correlationId: string,
  currentPassword: string,
  nextPassword: string
): Promise<void> {
  const account = await db.query("select password_hash from admin_account where id=$1", [session.accountId]);
  if (!account.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  const currentHash = String(account.rows[0].password_hash ?? "");
  if (!currentHash || !await argon2.verify(currentHash, currentPassword)) {
    throw Object.assign(new Error("invalid_login"), { statusCode: 401 });
  }
  if (nextPassword.length < 12) {
    throw Object.assign(new Error("weak_password"), { statusCode: 400 });
  }
  const nextHash = await argon2.hash(nextPassword, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  await tx(db, async (client) => {
    await client.query("update admin_account set password_hash=$2, password_changed_at=now() where id=$1", [session.accountId, nextHash]);
    await client.query("update admin_session set revoked_at=now() where account_id=$1 and id<>$2 and revoked_at is null", [session.accountId, session.sessionId]);
    await appendAudit(client, {
      eventType: "admin.password.changed",
      actorType: "admin",
      actorId: session.accountId,
      objectType: "admin_account",
      objectId: session.accountId,
      correlationId
    });
  });
}

async function revokeOtherAdminSessions(db: Db, session: AdminSession, correlationId: string): Promise<void> {
  await tx(db, async (client) => {
    await client.query(
      "update admin_session set revoked_at=now() where account_id=$1 and id<>$2 and revoked_at is null",
      [session.accountId, session.sessionId]
    );
    await appendAudit(client, {
      eventType: "admin.sessions.revoked_others",
      actorType: "admin",
      actorId: session.accountId,
      objectType: "admin_account",
      objectId: session.accountId,
      correlationId
    });
  });
}

async function listAdminAccounts(db: Db, currentAccountId: string): Promise<Array<{
  id: string;
  username: string;
  passwordChangedAt: string | null;
  mfaEnabled: boolean;
  createdAt: string;
  activeSessionCount: number;
  recoveryCodeCount: number;
  current: boolean;
}>> {
  const result = await db.query(
    `select a.id, a.username, a.password_changed_at, a.mfa_enabled, a.created_at,
            count(distinct s.id) filter (where s.revoked_at is null and s.expires_at > now())::int as active_session_count,
            count(distinct rc.id) filter (where rc.consumed_at is null)::int as recovery_code_count
       from admin_account a
       left join admin_session s on s.account_id = a.id
       left join admin_recovery_code rc on rc.account_id = a.id
      group by a.id
      order by a.created_at asc`
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    passwordChangedAt: row.password_changed_at ? String(row.password_changed_at) : null,
    mfaEnabled: Boolean(row.mfa_enabled),
    createdAt: String(row.created_at),
    activeSessionCount: Number(row.active_session_count),
    recoveryCodeCount: Number(row.recovery_code_count),
    current: String(row.id) === currentAccountId
  }));
}

async function createAdminAccount(
  db: Db,
  actorId: string,
  correlationId: string,
  input: unknown,
  encryptionKey: Buffer
): Promise<void> {
  const parsed = adminAccountCreateSchema.parse(input);
  const passwordHash = await argon2.hash(parsed.password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const storedMfaSecret = parsed.mfaSecret?.trim() ? encryptMfaSecret(parsed.mfaSecret.trim(), encryptionKey) : null;
  await tx(db, async (client) => {
    const inserted = await client.query(
      `insert into admin_account(username, password_hash, password_changed_at, mfa_enabled, mfa_secret)
       values ($1,$2,now(),$3,$4)
       returning id, username`,
      [parsed.username, passwordHash, Boolean(storedMfaSecret), storedMfaSecret]
    );
    await appendAudit(client, {
      eventType: "admin.account.created",
      actorType: "admin",
      actorId,
      objectType: "admin_account",
      objectId: String(inserted.rows[0].id),
      after: { username: inserted.rows[0].username, mfaEnabled: Boolean(storedMfaSecret) },
      correlationId
    });
  });
}

async function setManagedAdminPassword(db: Db, actorId: string, correlationId: string, accountId: string, nextPassword: string): Promise<void> {
  if (nextPassword.length < 12) throw Object.assign(new Error("weak_password"), { statusCode: 400 });
  const nextHash = await argon2.hash(nextPassword, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  await tx(db, async (client) => {
    const updated = await client.query(
      "update admin_account set password_hash=$2, password_changed_at=now() where id=$1 returning username",
      [accountId, nextHash]
    );
    if (!updated.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    await client.query("update admin_session set revoked_at=now() where account_id=$1 and revoked_at is null", [accountId]);
    await appendAudit(client, {
      eventType: "admin.account.password.set",
      actorType: "admin",
      actorId,
      objectType: "admin_account",
      objectId: accountId,
      after: { username: updated.rows[0].username },
      correlationId
    });
  });
}

async function setManagedAdminMfa(db: Db, actorId: string, correlationId: string, accountId: string, input: unknown, encryptionKey: Buffer): Promise<void> {
  const parsed = adminAccountMfaSchema.parse(input);
  const trimmed = parsed.secret?.trim() ?? "";
  if (parsed.enabled && !trimmed) throw Object.assign(new Error("invalid_mfa_secret"), { statusCode: 400 });
  const storedSecret = parsed.enabled ? encryptMfaSecret(trimmed, encryptionKey) : null;
  await tx(db, async (client) => {
    const updated = await client.query(
      "update admin_account set mfa_enabled=$2, mfa_secret=$3 where id=$1 returning username",
      [accountId, parsed.enabled, storedSecret]
    );
    if (!updated.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    await client.query("update admin_session set revoked_at=now() where account_id=$1 and revoked_at is null", [accountId]);
    await appendAudit(client, {
      eventType: "admin.account.mfa.updated",
      actorType: "admin",
      actorId,
      objectType: "admin_account",
      objectId: accountId,
      after: { username: updated.rows[0].username, mfaEnabled: parsed.enabled },
      correlationId
    });
  });
}

async function revokeAdminAccountSessions(db: Db, actorId: string, correlationId: string, accountId: string): Promise<void> {
  await tx(db, async (client) => {
    const account = await client.query("select username from admin_account where id=$1", [accountId]);
    if (!account.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    await client.query("update admin_session set revoked_at=now() where account_id=$1 and revoked_at is null", [accountId]);
    await appendAudit(client, {
      eventType: "admin.account.sessions.revoked",
      actorType: "admin",
      actorId,
      objectType: "admin_account",
      objectId: accountId,
      after: { username: account.rows[0].username },
      correlationId
    });
  });
}

async function rotateAdminRecoveryCodes(db: Db, actorId: string, correlationId: string, accountId: string): Promise<{ recoveryCodes: string[] }> {
  const recoveryCodes = Array.from({ length: 8 }, generateRecoveryCode);
  const recoveryHashes = await Promise.all(recoveryCodes.map((code) => argon2.hash(code, { type: argon2.argon2id, memoryCost: 32768, timeCost: 2, parallelism: 1 })));
  await tx(db, async (client) => {
    const account = await client.query("select username from admin_account where id=$1", [accountId]);
    if (!account.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    await client.query("update admin_recovery_code set consumed_at=coalesce(consumed_at, now()) where account_id=$1", [accountId]);
    for (const hash of recoveryHashes) {
      await client.query("insert into admin_recovery_code(account_id, code_hash) values ($1,$2)", [accountId, hash]);
    }
    await appendAudit(client, {
      eventType: "admin.account.recovery.rotated",
      actorType: "admin",
      actorId,
      objectType: "admin_account",
      objectId: accountId,
      after: { username: account.rows[0].username, recoveryCodeCount: recoveryCodes.length },
      correlationId
    });
  });
  return { recoveryCodes };
}

export function registerAdminRoutes(app: FastifyInstance, db: Db, config: AppConfig): void {
  app.get("/api/session", async (request, reply) => {
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found");
    const session = await sessionAccount(db, request, config);
    return {
      authenticated: Boolean(session),
      account: session?.accountName ?? null,
      bootstrapRequired: await bootstrapRequired(db)
    };
  });

  app.post("/api/bootstrap/setup", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    try {
      return await bootstrapAdminAccount(db, correlationId, request.body, config.MFA_ENCRYPTION_KEY_BASE64);
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.get("/api/admin-security", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    const account = await db.query(
      "select username, password_changed_at from admin_account where id=$1",
      [session.accountId]
    );
    const sessions = await listAdminSessions(db, session.accountId, session.sessionId);
    return {
      username: String(account.rows[0].username),
      passwordChangedAt: account.rows[0].password_changed_at ? String(account.rows[0].password_changed_at) : null,
      sessions
    };
  });

  app.get("/api/admin-accounts", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    return { accounts: await listAdminAccounts(db, session.accountId) };
  });

  app.get("/api/operational-config", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    try {
      return { settings: await listOperationalConfig(db, config) };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.put("/api/operational-config/:key", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { key } = request.params as { key: string };
    try {
      const parsed = operationalConfigUpdateSchema.parse(request.body);
      await updateOperationalConfig(db, config, session.accountId, correlationId, key, parsed.value);
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.post("/api/login", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const body = request.body as { username?: string; password?: string; totp?: string; recoveryCode?: string };
    const throttle = getLoginLockState(request, body.username ?? "");
    if (throttle.blocked) {
      reply.header("retry-after", String(throttle.retryAfterSeconds));
      await appendAudit(db, { eventType: "admin.login.rate_limited", actorType: "admin", actorId: body.username ?? null, correlationId });
      return sendError(reply, 429, "login_rate_limited", "Too many login attempts", correlationId);
    }
    const result = await db.query("select * from admin_account where username=$1", [body.username ?? ""]);
    if (!result.rowCount || !result.rows[0].password_hash) {
      recordLoginFailure(request, body.username ?? "");
      await appendAudit(db, { eventType: "admin.login.failed", actorType: "admin", actorId: body.username ?? null, correlationId });
      return sendError(reply, 401, "invalid_login", "Invalid credentials", correlationId);
    }
    const account = result.rows[0];
    const passwordOk = await argon2.verify(String(account.password_hash), body.password ?? "");
    const decryptedMfaSecret = account.mfa_enabled && account.mfa_secret
      ? decryptMfaSecret(String(account.mfa_secret), config.MFA_ENCRYPTION_KEY_BASE64)
      : null;
    const totpOk = account.mfa_enabled ? authenticator.check(body.totp ?? "", decryptedMfaSecret ?? "") : true;
    const recoveryOk = account.mfa_enabled && !totpOk
      ? await consumeRecoveryCode(db, String(account.id), body.recoveryCode ?? body.totp ?? "")
      : false;
    const mfaOk = account.mfa_enabled ? totpOk || recoveryOk : true;
    if (!passwordOk || !mfaOk) {
      recordLoginFailure(request, body.username ?? "");
      await appendAudit(db, { eventType: "admin.login.failed", actorType: "admin", actorId: body.username ?? null, correlationId });
      return sendError(reply, 401, "invalid_login", "Invalid credentials", correlationId);
    }
    clearLoginFailures(request, body.username ?? "");
    const session = randomBytes(64).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const sessionHash = await argon2.hash(session, { type: argon2.argon2id, memoryCost: 32768, timeCost: 2, parallelism: 1 });
    const lookupDigest = hmacToken(session, config.SESSION_SECRET_BASE64);
    await db.query(
      "insert into admin_session(account_id, session_hash, lookup_digest, expires_at) values ($1,$2,$3,now()+interval '8 hours')",
      [account.id, sessionHash, lookupDigest]
    );
    reply.setCookie(SESSION_COOKIE, session, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
    reply.setCookie(CSRF_COOKIE, csrf, { httpOnly: false, secure: true, sameSite: "strict", path: "/" });
    await appendAudit(db, { eventType: "admin.login.succeeded", actorType: "admin", actorId: account.id, correlationId });
    if (recoveryOk) {
      await appendAudit(db, { eventType: "admin.login.recovery_code_used", actorType: "admin", actorId: account.id, objectType: "admin_account", objectId: account.id, correlationId });
    }
    return { ok: true, csrfToken: csrf };
  });

  app.post("/api/logout", async (request, reply) => {
    const session = await sessionAccount(db, request, config);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed");
    if (session) await db.query("update admin_session set revoked_at=now() where id=$1 and revoked_at is null", [session.sessionId]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post("/api/admin-password", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const body = request.body as { currentPassword?: unknown; nextPassword?: unknown };
    try {
      await changeAdminPassword(
        db,
        session,
        correlationId,
        typeof body.currentPassword === "string" ? body.currentPassword : "",
        typeof body.nextPassword === "string" ? body.nextPassword : ""
      );
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.post("/api/admin-sessions/revoke-others", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    await revokeOtherAdminSessions(db, session, correlationId);
    return { ok: true };
  });

  app.post("/api/admin-accounts", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    try {
      await createAdminAccount(db, session.accountId, correlationId, request.body, config.MFA_ENCRYPTION_KEY_BASE64);
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.post("/api/admin-accounts/:id/password", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    try {
      const parsed = adminAccountPasswordSchema.parse(request.body);
      await setManagedAdminPassword(db, session.accountId, correlationId, id, parsed.nextPassword);
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.put("/api/admin-accounts/:id/mfa", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    try {
      await setManagedAdminMfa(db, session.accountId, correlationId, id, request.body, config.MFA_ENCRYPTION_KEY_BASE64);
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.post("/api/admin-accounts/:id/sessions/revoke", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    try {
      await revokeAdminAccountSessions(db, session.accountId, correlationId, id);
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.post("/api/admin-accounts/:id/recovery/rotate", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    try {
      return await rotateAdminRecoveryCodes(db, session.accountId, correlationId, id);
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.get("/api/mcp-servers", async (request, reply) => {
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found");
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized");
    return { servers: await listServers(db) };
  });

  app.post("/api/mcp-servers/:id/enabled", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    const body = request.body as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") return sendError(reply, 400, "invalid_enabled", undefined, correlationId);
    try {
      return await setServerEnabled(db, session.accountId, correlationId, id, body.enabled);
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.post("/api/mcp-servers/:id/test", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    try {
      return await runServerTest(db, id, correlationId, session.accountId);
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.get("/api/mcp-servers/:id/monitoring-profile", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    const { id } = request.params as { id: string };
    try {
      return await getMonitoringProfile(db, id);
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.put("/api/mcp-servers/:id/monitoring-profile", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    try {
      return await saveMonitoringProfile(db, session.accountId, correlationId, id, request.body);
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.post("/api/kaja", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const body = request.body as { label?: string; expiresAt?: string | null };
    const label = (body.label ?? "").trim();
    if (label.length < 1 || label.length > 120) return sendError(reply, 400, "invalid_label", "Label is required and must be at most 120 characters", correlationId);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
      return sendError(reply, 400, "invalid_expiration", "Expiration must be in the future", correlationId);
    }
    return await createKajaCredential(db, session.accountId, correlationId, label, expiresAt ? expiresAt.toISOString() : null);
  });

  app.get("/api/kaja", async (request, reply) => {
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found");
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized");
    return { credentials: await listKajaCredentials(db) };
  });

  app.patch("/api/kaja/:id/label", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    const body = request.body as { label?: unknown };
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (label.length < 1 || label.length > 120) {
      return sendError(reply, 400, "invalid_label", "Label is required and must be at most 120 characters", correlationId);
    }
    try {
      await renameKajaCredential(db, session.accountId, correlationId, id, label);
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.post("/api/kaja/:id/revoke", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    try {
      await revokeKajaCredential(db, session.accountId, correlationId, id);
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.post("/api/kaja/:id/delete", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    try {
      await deleteKajaCredential(db, session.accountId, correlationId, id);
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.get("/api/kaja/:id/permissions", async (request, reply) => {
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found");
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized");
    const { id } = request.params as { id: string };
    try {
      return { permissions: await listKajaPermissions(db, id) };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed");
    }
  });

  app.put("/api/kaja/:id/permissions", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized", undefined, correlationId);
    if (!requireCsrf(request)) return sendError(reply, 403, "csrf_failed", undefined, correlationId);
    const { id } = request.params as { id: string };
    const body = request.body as { serverIds?: unknown; permissions?: unknown };
    const permissions = Array.isArray(body.permissions)
      ? body.permissions
      : Array.isArray(body.serverIds)
        ? body.serverIds.map((serverId) => ({ serverId, accessLevel: "EXECUTE" }))
        : null;
    if (!permissions || permissions.some((permission) => {
      if (typeof permission !== "object" || permission === null) return true;
      const item = permission as { serverId?: unknown; accessLevel?: unknown };
      return typeof item.serverId !== "string" || String(item.accessLevel) !== "EXECUTE";
    })) {
      return sendError(reply, 400, "invalid_permissions", "permissions must include serverId and accessLevel", correlationId);
    }
    try {
      await replaceKajaPermissions(db, session.accountId, correlationId, id, permissions as Array<{ serverId: string; accessLevel: "EXECUTE" }>);
      return { ok: true };
    } catch (error) {
      return sendError(reply, Number((error as { statusCode?: number }).statusCode ?? 500), error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
    }
  });

  app.get("/api/audit", async (request, reply) => {
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized");
    const query = request.query as {
      cursor?: string;
      eventType?: string;
      objectId?: string;
      correlationId?: string;
    };
    const clauses = ["1=1"];
    const values: unknown[] = [];
    if (query.cursor) {
      values.push(Number(query.cursor));
      clauses.push(`id < $${values.length}`);
    }
    if (query.eventType && query.eventType !== "all") {
      values.push(query.eventType);
      clauses.push(`event_type = $${values.length}`);
    }
    if (query.objectId) {
      values.push(query.objectId);
      clauses.push(`object_id = $${values.length}`);
    }
    if (query.correlationId) {
      values.push(query.correlationId);
      clauses.push(`correlation_id::text = $${values.length}`);
    }
    const result = await db.query(
      `select id,event_type,actor_type,actor_id,object_type,object_id,correlation_id,created_at,before_json,after_json
         from audit_event
        where ${clauses.join(" and ")}
        order by id desc
        limit 101`,
      values
    );
    const events = result.rows.slice(0, 100);
    return {
      events,
      nextCursor: result.rows.length > 100 ? String(events[events.length - 1]?.id ?? "") : null
    };
  });

  app.get("/api/audit/integrity", async (request, reply) => {
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found");
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized");
    return verifyAuditChain(db);
  });

  app.get("/api/audit/export", async (request, reply) => {
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found");
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized");
    const result = await db.query(
      `select id,event_type,actor_type,actor_id,object_type,object_id,correlation_id,created_at,before_json,after_json,
              encode(prev_hash, 'hex') as prev_hash_hex,
              encode(event_hash, 'hex') as event_hash_hex
         from audit_event
        order by id asc`
    );
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=\"audit-export.json\"");
    return { exportedAt: new Date().toISOString(), events: result.rows };
  });

  app.get("/api/monitoring-probes", async (request, reply) => {
    if (hostOf(request.headers.host) !== config.ADMIN_HOST) return sendError(reply, 404, "not_found");
    const session = await sessionAccount(db, request, config);
    if (!session) return sendError(reply, 401, "unauthorized");
    const result = await db.query(`
      select mpr.id,mpr.server_id,ms.code,ms.hostname,mpr.probe_type,mpr.status,mpr.latency_ms,
             mpr.evidence,mpr.correlation_id,mpr.checked_at
        from monitoring_probe_result mpr
        join mcp_server ms on ms.id=mpr.server_id
       where mpr.checked_at>now()-interval '30 days'
       order by mpr.checked_at desc limit 1000
    `);
    return { probes: result.rows };
  });

  app.get("/health", async (_request, reply) => {
    try {
      await db.query("select 1");
      return { status: "ok", buildId: process.env.GITHUB_SHA ?? "local" };
    } catch {
      return reply.code(503).send({ status: "unready" });
    }
  });
}
