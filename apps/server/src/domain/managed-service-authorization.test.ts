import { describe, expect, it, vi } from "vitest";
import type { Db } from "../db.js";
import { authorizeManagedServiceToken } from "./managed-service.js";

describe("managed-service token authorization", () => {
  it("loads the canonical MCP mapping required by the runtime gate", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from managed_service_access_token token")) {
        return {
          rowCount: 1,
          rows: [{
            credential_id: "credential-id",
            managed_service_id: "managed-service-id",
            expires_at: new Date(Date.now() + 60_000),
            revoked_at: null,
            principal_token_epoch: "principal-epoch",
            service_token_epoch: "service-epoch",
            permission_epoch_snapshot: "permission-epoch",
            active_revision_epoch_snapshot: 4,
            token_environment: "production",
            credential_active: true,
            credential_revoked_at: null,
            credential_deleted_at: null,
            credential_expires_at: null,
            current_principal_token_epoch: "principal-epoch",
            code: "KCML0002",
            service_kind: "MCP",
            legacy_mcp_server_id: "legacy-server-id",
            public_hostname: "kcml0002.example.test",
            resource_uri: "https://kcml0002.example.test/mcp",
            lifecycle_state: "ACTIVE",
            operational_state: "HEALTHY",
            api_state: "ENABLED",
            enabled: true,
            active_revision_id: "revision-id",
            active_revision_epoch: 4,
            environment: "production",
            monitoring_enabled: true,
            monitoring_profile_digest: "sha256:monitoring",
            review_approved_at: "2026-01-01T00:00:00.000Z",
            review_due_at: "2027-01-01T00:00:00.000Z",
            review_interval_days: 365,
            current_service_token_epoch: "service-epoch",
            permission_epoch: "permission-epoch",
            active_revision_validation_state: "VALID"
          }]
        };
      }
      if (sql.includes("from managed_service_permission permission")) {
        return { rowCount: 1, rows: [{ scope_name: "mcp.invoke" }] };
      }
      if (sql.startsWith("update managed_service_access_token")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const db = { query } as unknown as Db;

    const decision = await authorizeManagedServiceToken(db, {
      tokenDigest: Buffer.from("digest"),
      audience: "https://kcml0002.example.test/mcp",
      environment: "production",
      requiredScopes: ["mcp.invoke"],
      correlationId: "correlation-id",
      operationId: "mcp.invoke"
    });

    expect(decision).toMatchObject({ allow: true, reasonCode: "allow", serviceId: "managed-service-id" });
    const authorizationSql = String(query.mock.calls[0]?.[0]);
    expect(authorizationSql).toContain("ms.legacy_mcp_server_id");
    expect(authorizationSql).toContain("ms.public_hostname");
    expect(authorizationSql).toContain("ms.resource_uri");
  });
});
