import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signAlertWebhookBody } from "./alerts.js";

describe("signed alert webhook", () => {
  it("binds the timestamp and exact body to the channel key", () => {
    const body = JSON.stringify({ alertId: "alert-1", severity: "CRITICAL" });
    const timestamp = "1784023200";
    const key = Buffer.alloc(32, 7);
    const expected = createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex");
    expect(signAlertWebhookBody(body, timestamp, key)).toBe(`v1=${expected}`);
    expect(signAlertWebhookBody(`${body} `, timestamp, key)).not.toBe(`v1=${expected}`);
  });
});
