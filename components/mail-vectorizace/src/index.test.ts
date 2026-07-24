import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeMail, start, stop } from "./index.js";

describe("Mail Vectorizace normalization", () => {
  it("normalizes html mail into stored metadata", async () => {
    const item = await normalizeMail([
      "Message-ID: <test-1@example.com>",
      "Date: Thu, 23 Jul 2026 09:00:00 +0000",
      "Subject: Rezervace",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Dobry den,<br>potvrzuji rezervaci.</p>"
    ].join("\r\n"));

    expect(item.messageId).toBe("<test-1@example.com>");
    expect(item.subject).toBe("Rezervace");
    expect(item.normalizedText).toContain("potvrzuji rezervaci");
  });

  afterEach(async () => {
    await stop({
      logger: { info() {}, error() {} },
      egress: {
        async fetch() {
          throw new Error("unused");
        },
        async connectTls() {
          throw new Error("unused");
        }
      },
      secrets: {
        async get() {
          throw new Error("unused");
        }
      },
      storage: {
        dataPath: mkdtempSync(join(tmpdir(), "mail-vectorizace-stop-"))
      },
      runtime: {
        currentMode: () => "STOPPED",
        async reportReady() {},
        async reportState() {},
        async reportHeartbeat() {}
      }
    });
  });

  it("starts even when runtime secrets are not handed off yet", async () => {
    const reportReady = vi.fn();
    const reportState = vi.fn();
    const reportHeartbeat = vi.fn();
    await start({
      logger: { info() {}, error() {} },
      egress: {
        async fetch() {
          throw new Error("unused");
        },
        async connectTls() {
          throw new Error("unused");
        }
      },
      secrets: {
        async get() {
          throw new Error("secret_unavailable");
        }
      },
      storage: {
        dataPath: mkdtempSync(join(tmpdir(), "mail-vectorizace-"))
      },
      runtime: {
        currentMode: () => "PREPARE",
        reportReady,
        reportState,
        reportHeartbeat
      }
    });

    expect(reportState).toHaveBeenCalledWith(expect.objectContaining({
      waitingForSecrets: true,
      mailbox: "recepce@hotelchodovas.cz"
    }));
    expect(reportHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      phase: "started"
    }));
    expect(reportReady).toHaveBeenCalledWith(expect.objectContaining({
      ready: true,
      status: "WAITING_FOR_RUNTIME_SECRETS",
      dependencySummary: expect.objectContaining({
        mailSecretStatus: "pending",
        vectorSecretStatus: "pending",
        pendingReason: "secret_unavailable"
      })
    }));
  });
});
