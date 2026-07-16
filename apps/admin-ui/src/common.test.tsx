// @vitest-environment jsdom
import React, { useState } from "react";
import axe from "axe-core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./common.js";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Otevřít dialog</button>
      {open ? (
        <Modal title="Potvrzení změny" onClose={() => setOpen(false)}>
          <button type="button" autoFocus>Potvrdit</button>
          <button type="button">Zrušit</button>
        </Modal>
      ) : null}
    </>
  );
}

afterEach(() => cleanup());

describe("accessible modal", () => {
  it("traps focus, closes on Escape, restores focus and has no axe violations", async () => {
    const user = userEvent.setup();
    const { container } = render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Otevřít dialog" });
    await user.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Potvrzení změny" });
    const confirm = screen.getByRole("button", { name: "Potvrdit" });
    const cancel = screen.getByRole("button", { name: "Zrušit" });
    const close = screen.getByRole("button", { name: "Zavřít" });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");

    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);

    const result = await axe.run(container);
    expect(result.violations).toEqual([]);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
  });
});
