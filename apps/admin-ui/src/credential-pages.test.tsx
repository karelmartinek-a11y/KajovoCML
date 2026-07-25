// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CredentialsPage } from "./credential-pages.js";
import type { AccessTokenCredential, Component } from "./types.js";

afterEach(() => cleanup());

describe("credential terminology", () => {
  it("uses access token terminology for the long-lived access token registry", () => {
    const credential: AccessTokenCredential = {
      id: "credential-1",
      publicId: "Kaja0001",
      label: "CI klient",
      fingerprint: "fingerprint",
      active: true,
      revokedAt: null,
      deletedAt: null,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      expiresAt: null,
      permissionCount: 1,
      activeAccessTokenCount: 1,
      lastTokenIssuedAt: "2026-07-16T00:01:00.000Z",
      lastTokenExpiresAt: "2026-07-16T01:01:00.000Z",
      lastUsedAt: "2026-07-16T00:02:00.000Z"
    };
    render(
      <CredentialsPage
        credentials={[credential]}
        components={[]}
        onOpenCreate={vi.fn()}
        onEditPermissions={vi.fn()}
        onRename={vi.fn()}
        onConfirm={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByRole("heading", { name: "Přístupové tokeny" })).toBeTruthy();
    expect(screen.getByText(/dlouhodobých přístupových tokenů/i)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Poslední vydání krátkodobého tokenu" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Poslední použití" })).toBeTruthy();
  });

  it("keeps component access tokens separate from onboarding tokens in the access-token registry", () => {
    const component = {
      id: "component-1", code: "KCML0002", displayName: "WhatsApp", hostname: "whatsapp.example.test", category: "MCP", registrationType: "EXTERNAL", role: "SERVICE", owners: {}, contacts: {}, description: "", lifecycleState: "ACTIVE", activationState: "ACTIVE", operationalState: "HEALTHY", monitoringState: "HEALTHY", recertificationState: "VALID", enabled: true, ingressEnabled: true, pulseEnabled: true, egressEnabled: true, revision: "1.0.0", capabilities: [], protocols: [], transports: [], permissionCount: 0, credentialCount: 1, policyEpoch: 1, releaseVersion: "test", createdAt: "2026-07-16T00:00:00.000Z", updatedAt: "2026-07-16T00:00:00.000Z", audit: { gapState: "CONTIGUOUS", highestReceivedSequence: 0, highestAcknowledgedSequence: 0, currentEventHash: null, integrityState: "VERIFIED", integrityReason: null }, accessTokens: [{ id: "component-token-1", fingerprint: "component-fingerprint", audience: "*", scope_names: ["mcp.tools.call"], issued_at: "2026-07-16T00:00:00.000Z", last_used_at: null, revoked_at: null, rotated_at: null, rotation_reason: null }]
    } satisfies Component;
    render(<CredentialsPage credentials={[]} components={[component]} onOpenCreate={vi.fn()} onEditPermissions={vi.fn()} onRename={vi.fn()} onConfirm={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Dlouhodobé přístupové tokeny komponent" })).toBeTruthy();
    expect(screen.getByText("KCML0002")).toBeTruthy();
    expect(screen.getByText("mcp.tools.call")).toBeTruthy();
    expect(screen.getByText(/onboardingový token sem nepatří/i)).toBeTruthy();
  });
});
