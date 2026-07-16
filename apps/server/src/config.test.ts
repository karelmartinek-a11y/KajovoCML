import { mkdtemp, rm, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBootstrapConfig, loadConfig, mutableRuntimeConfigEnvKeys } from "./config.js";

const secret = Buffer.alloc(32, 1).toString("base64");
const envBase = {
  DATABASE_URL: "postgres://localhost/kcml"
};
const tempDirs: string[] = [];
const configTestTmpdir = process.env.KCML_CONFIG_TEST_TMPDIR ?? tmpdir();

async function tempFile(name: string, value: string, mode = 0o600): Promise<string> {
  const dir = await mkdtemp(path.join(configTestTmpdir, "kcml-config-test-"));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  await writeFile(file, value, "utf8");
  await chmod(file, mode);
  return file;
}

async function tempCredentialFile(name: string, value: string, directoryMode = 0o700, fileMode = 0o440): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(path.join(configTestTmpdir, "kcml-credentials-test-"));
  tempDirs.push(directory);
  await chmod(directory, directoryMode);
  const file = path.join(directory, name);
  await writeFile(file, value, "utf8");
  await chmod(file, fileMode);
  return { directory, file };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("configuration gates", () => {
  it("accepts canonical base64 secrets and rejects non-canonical padding", () => {
    expect(() => loadConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).not.toThrow();
    expect(() => loadConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: `${secret}\n`,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).toThrow();
  });

  it("rejects undersized secret material", () => {
    expect(() => loadConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(8).toString("base64"),
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).toThrow();
  });

  it("accepts the existing GitHub API authorization for the onboarding worker", () => {
    expect(() => loadConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64"),
      ONBOARDING_WORKER_ENABLED: "true",
      GITHUB_OWNER: "example",
      GITHUB_REPO: "repository",
      GITHUB_TOKEN: "github-token-with-sufficient-length",
      OCI_IMAGE_NAMESPACE: "example/handlers",
      OCI_CERTIFICATE_IDENTITY: "https://github.com/example/repository/.github/workflows/onboarding-build.yml@refs/heads/main"
    })).not.toThrow();
  });

  it("requires least-privilege secret matrices per role", () => {
    expect(() => loadConfig({
      KCML_PROCESS_ROLE: "worker",
      ...envBase,
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      ONBOARDING_WORKER_ENABLED: "true",
      GITHUB_OWNER: "example",
      GITHUB_REPO: "repository",
      GITHUB_TOKEN: "github-token-with-sufficient-length",
      OCI_IMAGE_NAMESPACE: "example/handlers",
      OCI_CERTIFICATE_IDENTITY: "https://github.com/example/repository/.github/workflows/onboarding-build.yml@refs/heads/main"
    })).not.toThrow();
    expect(() => loadConfig({
      KCML_PROCESS_ROLE: "web",
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64")
    })).toThrow();
    expect(() => loadConfig({
      KCML_PROCESS_ROLE: "migrate",
      ...envBase,
      ONBOARDING_WORKER_ENABLED: "true"
    })).not.toThrow();
  });

  it("rejects reused security keys and invalid log levels", () => {
    expect(() => loadConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: secret,
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).toThrow();
    expect(() => loadConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64"),
      LOG_LEVEL: "verbose"
    })).toThrow();
  });

  it("accepts a configurable bootstrap admin username and rejects unsafe variants", () => {
    expect(() => loadConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64"),
      ADMIN_BOOTSTRAP_USERNAME: "owner.admin"
    })).not.toThrow();
    expect(() => loadConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64"),
      ADMIN_BOOTSTRAP_USERNAME: "Owner Admin"
    })).toThrow();
  });

  it("requires explicit production hosts and rejects invalid hostnames and ports", () => {
    expect(() => loadConfig({
      ...envBase,
      NODE_ENV: "production",
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64"),
      BUILD_ID: "release-1"
    })).toThrow();
    expect(() => loadConfig({
      ...envBase,
      NODE_ENV: "production",
      PUBLIC_BASE_DOMAIN: "hcasc.cz",
      ADMIN_HOST: "https://admin.hcasc.cz",
      AUTH_HOST: "auth.hcasc.cz",
      REGISTER_HOST: "register.hcasc.cz",
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64"),
      BUILD_ID: "release-1"
    })).toThrow();
    expect(() => loadConfig({
      ...envBase,
      PORT: "65536",
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).toThrow();
  });

  it("rejects direct production ADMIN_TOTP_SECRET env and accepts secure *_FILE input", async () => {
    const totpFile = await tempFile("admin_totp", "JBSWY3DPEHPK3PXP");
    const productionBase = {
      ...envBase,
      NODE_ENV: "production",
      KCML_PROCESS_ROLE: "web",
      PUBLIC_BASE_DOMAIN: "hcasc.cz",
      ADMIN_HOST: "admin.hcasc.cz",
      AUTH_HOST: "auth.hcasc.cz",
      REGISTER_HOST: "register.hcasc.cz",
      BUILD_ID: "release-1",
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    };
    expect(() => loadConfig({
      ...productionBase,
      ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXP"
    })).toThrow();
    expect(() => loadConfig({
      ...productionBase,
      ADMIN_TOTP_SECRET_FILE: totpFile
    })).not.toThrow();
    expect(() => loadConfig({
      ...productionBase,
      ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXP"
    }, { allowAdminTotpSecret: true })).not.toThrow();
  });

  it("rejects unsafe production secret files", async () => {
    const worldReadable = await tempFile("secret", secret, 0o644);
    const oversized = await tempFile("oversized", "A".repeat(SECRET_FILE_BYTES));
    const { directory: systemdCredentialsDirectory, file: systemdCredentialFile } = await tempCredentialFile("secret", secret);
    const { directory: looseCredentialsDirectory, file: looseCredentialFile } = await tempCredentialFile("secret", secret);
    await chmod(looseCredentialsDirectory, 0o755);
    const symlinkDir = await mkdtemp(path.join(configTestTmpdir, "kcml-config-symlink-"));
    tempDirs.push(symlinkDir);
    const symlinkPath = path.join(symlinkDir, "secret-link");
    await symlink(worldReadable, symlinkPath);
    const productionBase = {
      ...envBase,
      NODE_ENV: "production",
      PUBLIC_BASE_DOMAIN: "hcasc.cz",
      ADMIN_HOST: "admin.hcasc.cz",
      AUTH_HOST: "auth.hcasc.cz",
      REGISTER_HOST: "register.hcasc.cz",
      BUILD_ID: "release-1"
    };
    expect(() => loadConfig({
      ...productionBase,
      CREDENTIALS_DIRECTORY: systemdCredentialsDirectory,
      ACCESS_TOKEN_HMAC_KEY_BASE64_FILE: systemdCredentialFile,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).not.toThrow();
    expect(() => loadConfig({
      ...productionBase,
      CREDENTIALS_DIRECTORY: looseCredentialsDirectory,
      ACCESS_TOKEN_HMAC_KEY_BASE64_FILE: looseCredentialFile,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).toThrow();
    expect(() => loadConfig({
      ...productionBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64_FILE: worldReadable,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).toThrow();
    expect(() => loadConfig({
      ...productionBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64_FILE: symlinkPath,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).toThrow();
    expect(() => loadConfig({
      ...productionBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64_FILE: oversized,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64")
    })).toThrow();
  });

  it("exposes a bootstrap-only loader without mutable runtime keys", () => {
    const bootstrap = loadBootstrapConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64"),
      LOG_LEVEL: "debug",
      MONITOR_INTERVAL_MS: "30000",
      ONBOARDING_WORKER_INTERVAL_MS: "25000"
    });

    expect(mutableRuntimeConfigEnvKeys).toEqual([
      "ONBOARDING_WORKER_INTERVAL_MS",
      "MONITOR_INTERVAL_MS",
      "LOG_LEVEL",
      "UI_TIME_ZONE"
    ]);
    expect("LOG_LEVEL" in bootstrap).toBe(false);
    expect("MONITOR_INTERVAL_MS" in bootstrap).toBe(false);
    expect("ONBOARDING_WORKER_INTERVAL_MS" in bootstrap).toBe(false);
    expect("UI_TIME_ZONE" in bootstrap).toBe(false);
  });

  it("keeps the compatibility runtime loader including mutable values", () => {
    const config = loadConfig({
      ...envBase,
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret,
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: Buffer.alloc(32, 3).toString("base64"),
      SESSION_SECRET_BASE64: Buffer.alloc(32, 4).toString("base64"),
      CSRF_SECRET_BASE64: Buffer.alloc(32, 5).toString("base64"),
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 6).toString("base64"),
      LOG_LEVEL: "debug",
      MONITOR_INTERVAL_MS: "30000",
      ONBOARDING_WORKER_INTERVAL_MS: "25000"
    });

    expect(config.LOG_LEVEL).toBe("debug");
    expect(config.MONITOR_INTERVAL_MS).toBe(30000);
    expect(config.ONBOARDING_WORKER_INTERVAL_MS).toBe(25000);
  });
});

const SECRET_FILE_BYTES = 16 * 1024 + 1;
