import { describe, expect, it } from "vitest";
import { nextDialogFocusIndex } from "./dialog-focus.js";

describe("accessible dialog focus cycle", () => {
  it.each([
    [3, 0, false, 1],
    [3, 2, false, 0],
    [3, 0, true, 2],
    [3, 1, true, 0],
    [3, -1, false, 0],
    [3, -1, true, 2],
    [0, -1, false, null]
  ])("cycles %i items from %i (backwards=%s)", (count, current, backwards, expected) => {
    expect(nextDialogFocusIndex(count, current, backwards)).toBe(expected);
  });
});
