// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ui-helpers.js", () => ({
  api: vi.fn(async (url: string) => {
    if (url === "/api/generation/setup") return { openAiReady: true, model: "gpt-5" };
    if (url === "/api/generation/jobs") return { jobs: [] };
    throw new Error(`unexpected:${url}`);
  }),
  csrf: () => "csrf",
  formatDate: (value: string) => value,
  prettyJson: (value: unknown) => JSON.stringify(value)
}));

import { GenerationPage } from "./generation-page.js";

afterEach(() => cleanup());

describe("OWNER generation UI", () => {
  it("presents one human prompt and no retired programmer handoff", async () => {
    render(<GenerationPage />);
    expect(await screen.findByRole("heading", { name: "Co mám vytvořit?" })).toBeTruthy();
    expect(screen.getByLabelText("Zadání generování")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Začít persistentní diskusi/ })).toBeTruthy();
    expect(screen.queryByText(/integrační token/i)).toBeNull();
    expect(screen.queryByText(/programátor/i)).toBeNull();
  });
});
