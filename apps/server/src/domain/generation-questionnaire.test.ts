import { describe, expect, it } from "vitest";
import { ownerRequiredInputs, type GenerationPlan } from "./generation.js";

const input = (overrides: Partial<GenerationPlan["missingInputs"][number]> = {}): GenerationPlan["missingInputs"][number] => ({
  key: "mailbox_address", label: "E-mailová adresa", description: "Účet, který má služba obsluhovat.", kind: "EMAIL",
  required: true, secret: false, ownerRequired: true, ownerReason: "Platforma nezná konkrétní mailbox vlastníka.", derivationSource: "OWNER", ...overrides
});

describe("generation questionnaire gate", () => {
  it("keeps only necessary OWNER facts with an explicit reason", () => {
    expect(ownerRequiredInputs([input()])).toHaveLength(1);
    expect(ownerRequiredInputs([input({ ownerReason: "" })])).toHaveLength(0);
  });

  it("removes provider/platform configuration and optional prompts", () => {
    expect(ownerRequiredInputs([
      input({ key: "imap_server", label: "IMAP server", description: "hostname and port", ownerReason: "legacy" }),
      input({ key: "provider_token", derivationSource: "PROVIDER_INTEGRATION" }),
      input({ key: "optional_note", required: false })
    ])).toEqual([]);
  });
});
