// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ui-helpers.js", () => ({
  api: vi.fn(async (url: string) => {
    if (url === "/api/browser-automations") return { automations: [{ id: "automation-1", code: "invoice_sync", stableKey: "invoice_sync", displayName: "Invoice sync", purpose: "Read-only fixture", status: "DISABLED", activeRevisionId: "revision-1", activeRevision: 1, activeDigest: "sha256:fixture", activeVerificationStatus: "PENDING", lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, createdAt: "2026-08-23T08:00:00Z", updatedAt: "2026-08-23T08:00:00Z" }] };
    if (url === "/api/browser-automations/automation-1") return { automation: { id: "automation-1", code: "invoice_sync", stableKey: "invoice_sync", displayName: "Invoice sync", purpose: "Read-only fixture", status: "DISABLED", activeRevisionId: "revision-1", activeRevision: 1, activeDigest: "sha256:fixture", activeVerificationStatus: "PENDING", lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, createdAt: "2026-08-23T08:00:00Z", updatedAt: "2026-08-23T08:00:00Z", revision: { id: "revision-1", number: 1, manifest: { schemaVersion: "kcml.browser-automation.v1", steps: [{ action: "NAVIGATE", url: "https://example.com" }] }, canonicalJson: "{}", digest: "sha256:fixture", status: "PREFLIGHTED", verificationStatus: "PENDING", createdAt: "2026-08-23T08:00:00Z", activatedAt: null }, authBindings: [] } };
    if (url === "/api/browser-automations/automation-1/runs") return { runs: [] };
    throw new Error(`unexpected:${url}`);
  }),
  csrf: () => "csrf",
  formatDate: (value: string) => value,
  prettyJson: (value: unknown) => JSON.stringify(value)
}));

import { BrowserAutomationsPage } from "./browser-automations-page.js";

afterEach(() => cleanup());

describe("Browser automation administration", () => {
  it("renders real revision status and does not present static preflight as activation", async () => {
    render(<BrowserAutomationsPage />);
    expect(await screen.findByRole("heading", { name: "Invoice sync" })).toBeTruthy();
    expect(screen.getByText("PREFLIGHTED · PENDING")).toBeTruthy();
    expect(screen.getByText(/Preflight ověří manifest a digest/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zapnout" })).toBeTruthy();
  });
});
