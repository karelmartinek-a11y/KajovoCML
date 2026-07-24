import { describe, expect, it } from "vitest";
import { normalizeMail } from "./index.js";

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
});
