import { describe, expect, it } from "vitest";
import { formatLocalDateTimeInput } from "./ui-helpers.js";

describe("formatLocalDateTimeInput", () => {
  it("preserves local date and time fields instead of serializing UTC fields", () => {
    const date = new Date("2026-07-14T12:30:00.000Z");
    const value = formatLocalDateTimeInput(date);
    expect(value).not.toContain("Z");
    expect(value).toHaveLength(16);
    expect(new Date(value).getFullYear()).toBe(date.getFullYear());
    expect(new Date(value).getMonth()).toBe(date.getMonth());
    expect(new Date(value).getDate()).toBe(date.getDate());
    expect(new Date(value).getHours()).toBe(date.getHours());
    expect(new Date(value).getMinutes()).toBe(date.getMinutes());
  });
});
