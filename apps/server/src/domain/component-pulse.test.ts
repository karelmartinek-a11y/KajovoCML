import { describe, expect, it } from "vitest";
import { componentPulseIdentityCodes } from "./component.js";

describe("component PULSE identity direction", () => {
  it("treats the target as local for incoming PULSE", () => {
    expect(componentPulseIdentityCodes("INCOMING", "KCML0001", "KCML0002")).toEqual({
      localComponentCode: "KCML0002",
      routedComponentCode: "KCML0001"
    });
  });

  it("treats the source as local for outgoing PULSE", () => {
    expect(componentPulseIdentityCodes("OUTGOING", "KCML0001", "KCML0002")).toEqual({
      localComponentCode: "KCML0001",
      routedComponentCode: "KCML0002"
    });
  });
});
