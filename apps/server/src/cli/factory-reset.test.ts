import { describe, expect, it } from "vitest";
import { FACTORY_RESET_CONFIRMATION, requireFactoryResetConfirmation } from "./factory-reset.js";

describe("factory reset safety gate", () => {
  it("rejects missing or approximate confirmations", () => {
    expect(() => requireFactoryResetConfirmation({})).toThrow(`factory_reset_confirmation_required:${FACTORY_RESET_CONFIRMATION}`);
    expect(() => requireFactoryResetConfirmation({ KCML_FACTORY_RESET_CONFIRM: "yes" })).toThrow();
  });

  it("accepts only the exact documented confirmation", () => {
    expect(() => requireFactoryResetConfirmation({ KCML_FACTORY_RESET_CONFIRM: FACTORY_RESET_CONFIRMATION })).not.toThrow();
  });
});
