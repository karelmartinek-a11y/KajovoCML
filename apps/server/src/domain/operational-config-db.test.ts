import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadBootstrapConfig } from "../config.js";
import { createDb, type Db } from "../db.js";
import { decryptMfaSecret, decryptVaultSecret, encryptMfaSecret } from "../security/secrets.js";
import { listOperationalConfig, loadConfigFromDb, rotateMfaEncryptionKey, updateOperationalConfig } from "./operational-config.js";

const enabled = process.env.KCML_TEST_DATABASE === "1";
const vaultKey = Buffer.alloc(32, 73);

describe.skipIf(!enabled)("operational configuration PostgreSQL integration", () => {
  let db: Db;
  const bootstrap = loadBootstrapConfig({
    NODE_ENV: "test",
    KCML_PROCESS_ROLE: "web",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://localhost/kcml_test",
    CONFIG_VAULT_MASTER_KEY_BASE64: vaultKey.toString("base64"),
    CONFIG_VAULT_MASTER_KEY_ID: "db-test-v1"
  });

  beforeAll(() => { db = createDb(bootstrap); });
  beforeEach(async () => {
    await db.query("truncate table operational_config_setting cascade");
  });
  afterAll(async () => db.end());

  it("stores typed JSON values and encrypted secrets and loads them through the runtime provider", async () => {
    await updateOperationalConfig(db, bootstrap, null, "00000000-0000-4000-8000-000000000051", "publicBaseDomain", "example.invalid", 0);
    await updateOperationalConfig(
      db,
      bootstrap,
      null,
      "00000000-0000-4000-8000-000000000052",
      "accessTokenHmacKey",
      Buffer.alloc(32, 19).toString("base64"),
      0
    );

    const rows = await db.query(
      "select key,value_json,secret_ciphertext,is_secret,version from operational_config_setting order by key"
    );
    expect(rows.rows.find((row) => row.key === "publicBaseDomain")).toMatchObject({
      value_json: "example.invalid",
      is_secret: false,
      version: 1
    });
    const secretRow = rows.rows.find((row) => row.key === "accessTokenHmacKey");
    expect(secretRow).toMatchObject({ value_json: null, is_secret: true, version: 1 });
    expect(String(secretRow?.secret_ciphertext)).toMatch(/^vault:v1:/);

    const effective = await loadConfigFromDb(db, bootstrap);
    expect(effective.PUBLIC_BASE_DOMAIN).toBe("example.invalid");
    expect(effective.ACCESS_TOKEN_HMAC_KEY_BASE64.equals(Buffer.alloc(32, 19))).toBe(true);

    const view = await listOperationalConfig(db, effective);
    expect(view.find((item) => item.key === "accessTokenHmacKey")).toMatchObject({
      value: null,
      configured: true,
      version: 1
    });
    await expect(updateOperationalConfig(
      db,
      bootstrap,
      null,
      "00000000-0000-4000-8000-000000000053",
      "publicBaseDomain",
      "new.example.invalid",
      0
    )).rejects.toMatchObject({ message: "config_version_conflict", statusCode: 409 });
  });

  it("re-encrypts every enabled MFA account while rotating the DB-backed key", async () => {
    const oldKey = Buffer.alloc(32, 31);
    const nextKey = Buffer.alloc(32, 32);
    await db.query("update admin_account set mfa_enabled=false,mfa_secret=null");
    await updateOperationalConfig(db, bootstrap, null, "00000000-0000-4000-8000-000000000061", "mfaEncryptionKey", oldKey.toString("base64"), 0);
    const account = await db.query(
      `insert into admin_account(username,mfa_enabled,mfa_secret,active,activated_at)
       values ('mfa-rotation-db-test',true,null,true,now())
       on conflict (username) do update set mfa_enabled=true,active=true,activated_at=now()
       returning id`
    );
    const accountId = String(account.rows[0].id);
    const oldCiphertext = encryptMfaSecret("JBSWY3DPEHPK3PXP", oldKey, {
      subjectId: accountId,
      purpose: "admin_totp",
      keyId: "mfa-config-v1"
    });
    await db.query("update admin_account set mfa_secret=$2 where id=$1", [accountId, oldCiphertext]);

    await expect(rotateMfaEncryptionKey(db, {
      ...bootstrap,
      MFA_ENCRYPTION_KEY_BASE64: oldKey,
      MFA_ALLOW_PLAINTEXT_LEGACY: false
    }, accountId, "00000000-0000-4000-8000-000000000062", nextKey.toString("base64"), 1))
      .resolves.toEqual({ reencryptedAccounts: 1 });

    const rotated = await db.query("select mfa_secret from admin_account where id=$1", [accountId]);
    expect(String(rotated.rows[0].mfa_secret)).not.toBe(oldCiphertext);
    expect(decryptMfaSecret(String(rotated.rows[0].mfa_secret), nextKey, { subjectId: accountId, purpose: "admin_totp" }))
      .toBe("JBSWY3DPEHPK3PXP");
    const setting = await db.query("select secret_ciphertext,version from operational_config_setting where key='mfaEncryptionKey'");
    expect(setting.rows[0].version).toBe(2);
    expect(decryptVaultSecret(String(setting.rows[0].secret_ciphertext), new Map([["db-test-v1", vaultKey]]), "mfaEncryptionKey"))
      .toBe(nextKey.toString("base64"));
  });
});
