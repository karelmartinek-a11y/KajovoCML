import { describe, expect, it } from "vitest";
import { referenceExternalApiManifest } from "./reference-external-api.js";

describe("reference external api manifest", () => {
  it("derives contact addresses from the configured base domain", () => {
    const manifest = referenceExternalApiManifest("example.cz");
    expect(manifest.contacts).toMatchObject({
      serviceEmail: "service@example.cz",
      technicalEmail: "platform@example.cz",
      securityEmail: "security@example.cz"
    });
  });
});
