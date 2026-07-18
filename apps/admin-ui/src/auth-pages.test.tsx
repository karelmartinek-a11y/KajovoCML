// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootstrapPage, Login, ReauthModal } from "./auth-pages.js";

afterEach(() => cleanup());

describe("authentication pages", () => {
  it("masks every reusable secret", () => {
    render(<BootstrapPage onComplete={vi.fn()} />);

    expect(screen.getByLabelText("Heslo")).toHaveProperty("type", "password");
    expect(screen.getByLabelText(/Bootstrap secret/)).toHaveProperty("type", "password");
  });

  it("masks login and reauthentication passwords", () => {
    const { rerender } = render(<Login onLogin={vi.fn()} />);
    expect(screen.getByLabelText("Heslo")).toHaveProperty("type", "password");

    rerender(<ReauthModal onClose={vi.fn()} />);
    expect(screen.getByLabelText("Heslo")).toHaveProperty("type", "password");
  });
});
