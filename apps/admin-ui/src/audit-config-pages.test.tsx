// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditPage } from "./audit-page.js";
import { OperationalConfigPage } from "./operational-config-page.js";
import type { AuditEvent, OperationalConfigSetting } from "./types.js";

afterEach(() => cleanup());

const summary: AuditEvent = {
  id: 7,
  event_type: "admin.account.updated",
  actor_type: "admin",
  actor_id: "owner-id",
  object_type: "admin_account",
  object_id: "account-id",
  correlation_id: "00000000-0000-0000-0000-000000000007",
  created_at: "2026-07-16T10:00:00.000Z",
  chain: { sequence: 7, previousHash: "previous", eventHash: "current" }
};

describe("audit and configuration pages", () => {
  it("loads audit payload only through the detail action and reports refresh failures", async () => {
    const user = userEvent.setup();
    const onLoadDetail = vi.fn(async () => ({ ...summary, before_json: { role: "ADMIN" }, after_json: { role: "OWNER" } }));
    render(<AuditPage
      events={[summary]}
      nextCursor={null}
      integrity={null}
      onLoadMore={vi.fn(async () => undefined)}
      onLoadDetail={onLoadDetail}
      onRefresh={vi.fn(async () => { throw new Error("Audit nelze obnovit."); })}
      onRefreshIntegrity={vi.fn(async () => undefined)}
    />);

    expect(screen.queryByText(/"role": "ADMIN"/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Zobrazit" }));
    await waitFor(() => expect(onLoadDetail).toHaveBeenCalledWith(7));
    expect(screen.getByRole("dialog", { name: "Detail auditní události" })).toBeTruthy();
    expect(screen.getByText(/"role": "ADMIN"/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    await waitFor(() => expect(screen.getByText("Audit nelze obnovit.")).toBeTruthy());
  });

  it("reports configuration refresh failures and prevents duplicate refreshes", async () => {
    const user = userEvent.setup();
    let rejectRefresh: ((error: Error) => void) | undefined;
    const onRefresh = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectRefresh = reject; }));
    const setting: OperationalConfigSetting = {
      key: "uiTimeZone",
      envKey: "UI_TIME_ZONE",
      label: "Časové pásmo",
      description: "Časové pásmo administrace.",
      category: "presentation",
      kind: "string",
      appliesTo: ["web"],
      restartRequired: false,
      bootstrapOnly: false,
      source: "database",
      value: "Europe/Prague",
      configured: true,
      version: 1,
      fingerprint: "sha256:configured",
      restartPending: false,
      updatedAt: "2026-07-16T10:00:00.000Z"
    };
    render(<OperationalConfigPage settings={[setting]} onRefresh={onRefresh} onSave={vi.fn(async () => undefined)} />);

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    expect(screen.getByRole("button", { name: "Obnovuji..." })).toHaveProperty("disabled", true);
    rejectRefresh?.(new Error("Konfiguraci nelze načíst."));
    await waitFor(() => expect(screen.getByText("Konfiguraci nelze načíst.")).toBeTruthy());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
