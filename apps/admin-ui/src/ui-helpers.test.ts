import { describe, expect, it } from "vitest";
import { describeApiError, formatCzNumber, formatDate, formatDateWithUtc, formatLocalDateTimeInput, setUiTimeZone } from "./ui-helpers.js";

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

describe("describeApiError", () => {
  it("uses a safe localized fallback for unknown backend errors", () => {
    expect(describeApiError("totally_unknown_code")).toBe("Operaci se nepodařilo dokončit");
    expect(describeApiError("totally_unknown_code", "corr-123")).toContain("corr-123");
  });

  it("localizes optimistic config conflicts", () => {
    expect(describeApiError("config_version_conflict")).toContain("jiné relaci");
  });
});

describe("format helpers", () => {
  it("formats Czech numbers centrally", () => {
    expect(formatCzNumber(12345)).toBe("12 345");
  });

  it("shows local and UTC time in the detailed formatter", () => {
    expect(formatDateWithUtc("2026-07-14T12:30:00.000Z")).toContain("2026-07-14T12:30:00.000Z");
  });

  it("uses the configured operational time zone deterministically", () => {
    setUiTimeZone("UTC");
    expect(formatDate("2026-07-14T23:30:00.000Z")).toContain("14. 7. 2026");
    setUiTimeZone("Europe/Prague");
    expect(formatDate("2026-07-14T23:30:00.000Z")).toContain("15. 7. 2026");
  });
});
