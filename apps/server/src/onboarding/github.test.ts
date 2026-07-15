import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { GitHubOnboardingClient } from "./github.js";

const secret = (byte: number) => Buffer.alloc(32, byte).toString("base64");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub onboarding authorization", () => {
  it("uses an existing GitHub API token without requesting an App installation token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ workflow_runs: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const config = loadConfig({
      DATABASE_URL: "postgres://localhost/kcml",
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret(1),
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: secret(2),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: secret(3),
      SESSION_SECRET_BASE64: secret(4),
      CSRF_SECRET_BASE64: secret(5),
      MFA_ENCRYPTION_KEY_BASE64: secret(6),
      ONBOARDING_WORKER_ENABLED: "true",
      GITHUB_OWNER: "example",
      GITHUB_REPO: "repository",
      GITHUB_TOKEN: "github-token-with-sufficient-length",
      OCI_IMAGE_NAMESPACE: "example/handlers",
      OCI_CERTIFICATE_IDENTITY: "https://github.com/example/repository/.github/workflows/onboarding-build.yml@refs/heads/main"
    });

    await expect(new GitHubOnboardingClient(config).checkTrustedBuild("abc123")).resolves.toMatchObject({ state: "pending" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/actions/runs");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      authorization: "Bearer github-token-with-sufficient-length"
    });
  });
});
