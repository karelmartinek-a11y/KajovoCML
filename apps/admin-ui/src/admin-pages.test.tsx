// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAccountsPage, SecurityPage } from "./admin-pages.js";
import type { AdminAccount, AdminSecurity } from "./types.js";

afterEach(() => cleanup());

describe("admin pages", () => {
  it("shows feedback when revoke-all sessions fails", async () => {
    const user = userEvent.setup();
    const security: AdminSecurity = {
      username: "owner",
      role: "OWNER",
      active: true,
      deploymentManaged: false,
      mfaEnabled: false,
      passwordChangedAt: "2026-07-16T10:00:00.000Z",
      sessions: [
        { id: "session-1", createdAt: "2026-07-16T10:00:00.000Z", expiresAt: "2026-07-17T10:00:00.000Z", current: true },
        { id: "session-2", createdAt: "2026-07-16T11:00:00.000Z", expiresAt: "2026-07-17T11:00:00.000Z", current: false }
      ]
    };
    render(
      <SecurityPage
        security={security}
        onRefresh={vi.fn(async () => undefined)}
        onChangePassword={vi.fn(async () => undefined)}
        onRevokeOtherSessions={vi.fn(async () => undefined)}
        onRevokeSession={vi.fn(async () => undefined)}
        onRevokeAllSessions={vi.fn(async () => { throw new Error("Revokace selhala na serveru."); })}
        onStartMfaEnrollment={vi.fn(async () => ({ enrollmentToken: "token", otpauthUri: "otpauth://totp/KCML:test?secret=ABC", manualSecret: "ABC", expiresAt: "2026-07-17T12:00:00.000Z" }))}
        onVerifyMfaEnrollment={vi.fn(async () => ["AAA-BBB-CCC"])}
      />
    );

    await user.click(screen.getByRole("button", { name: /Odhlásit všechna zařízení/i }));

    await waitFor(() => expect(screen.getAllByText("Revokace selhala na serveru.").length).toBe(1));
  });

  it("disables weak account actions and surfaces recovery rotation output", async () => {
    const user = userEvent.setup();
    const account: AdminAccount = {
      id: "account-1",
      username: "owner-two",
      deploymentManaged: false,
      passwordChangedAt: "2026-07-16T10:00:00.000Z",
      mfaEnabled: false,
      createdAt: "2026-07-16T09:00:00.000Z",
      activeSessionCount: 1,
      recoveryCodeCount: 8,
      current: false,
      role: "OWNER",
      active: true
    };
    render(
      <AdminAccountsPage
        accounts={[account]}
        onRefresh={vi.fn(async () => undefined)}
        onCreate={vi.fn(async () => undefined)}
        onSetPassword={vi.fn(async () => undefined)}
        onRevokeSessions={vi.fn(async () => undefined)}
        onRotateRecovery={vi.fn(async () => ["AAA-BBB-CCC", "DDD-EEE-FFF"])}
        onUpdate={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByRole("button", { name: "Nastavit heslo" })).toHaveProperty("disabled", true);

    await user.type(screen.getByLabelText("Nové heslo účtu"), "very-strong-password");
    expect(screen.getByRole("button", { name: "Nastavit heslo" })).toHaveProperty("disabled", false);

    await user.click(screen.getByRole("button", { name: "Rotovat recovery kódy" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: /Recovery kódy: owner-two/i })).toBeTruthy());
    expect(screen.getByText(/Recovery kódy účtu owner-two byly rotovány\./i)).toBeTruthy();
    expect(screen.getByText(/AAA-BBB-CCC/)).toBeTruthy();
  });

  it("creates an OWNER account without exposing a human role selector", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => undefined);
    render(
      <AdminAccountsPage
        accounts={[]}
        onRefresh={vi.fn(async () => undefined)}
        onCreate={onCreate}
        onSetPassword={vi.fn(async () => undefined)}
        onRevokeSessions={vi.fn(async () => undefined)}
        onRotateRecovery={vi.fn(async () => [])}
        onUpdate={vi.fn(async () => undefined)}
      />
    );

    expect(screen.queryByRole("combobox", { name: /role|úroveň|oprávnění/i })).toBeNull();
    await user.type(screen.getByLabelText("Uživatelské jméno"), "new-owner");
    await user.type(screen.getByLabelText("Počáteční heslo"), "a-long-safe-password");
    await user.click(screen.getByRole("button", { name: "Založit účet" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ username: "new-owner", password: "a-long-safe-password" }));
  });
});
