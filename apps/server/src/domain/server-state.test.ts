import { describe, expect, it } from "vitest";
import { assertServerTransition } from "./server-state.js";

describe("server registration state machine", () => {
  it("requires trial between disabled and active", () => {
    expect(() => assertServerTransition("REGISTERED_DISABLED", "TRIAL")).not.toThrow();
    expect(() => assertServerTransition("TRIAL", "ACTIVE")).not.toThrow();
    expect(() => assertServerTransition("REGISTERED_DISABLED", "ACTIVE")).toThrow("invalid_server_state_transition");
  });

  it("does not permit automatic recovery from quarantine or retired", () => {
    expect(() => assertServerTransition("QUARANTINED", "ACTIVE")).toThrow();
    expect(() => assertServerTransition("RETIRED", "REGISTERED_DISABLED")).toThrow();
  });
});
