import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  end: vi.fn(async () => undefined),
  raise: vi.fn(async () => ({ id: "alert-1", created: true })),
  close: vi.fn(async () => undefined),
  deliver: vi.fn(async () => true)
}));

vi.mock("../config.js", () => ({ loadBootstrapConfig: () => ({}) }));
vi.mock("../db.js", () => ({
  createDb: () => ({ end: state.end }),
  tx: async (_db: unknown, callback: (client: unknown) => Promise<unknown>) => callback({})
}));
vi.mock("../domain/operational-config.js", () => ({ loadConfigFromDb: async () => ({}) }));
vi.mock("../domain/alerts.js", () => ({
  raiseAlert: state.raise,
  closeAlert: state.close,
  deliverNextAlert: state.deliver
}));

async function run(action: "failed" | "recovered") {
  vi.resetModules();
  const original = process.argv;
  process.argv = ["node", "report-canonical-tls-renewal", action];
  try {
    await import("./report-canonical-tls-renewal.js");
  } finally {
    process.argv = original;
  }
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("canonical TLS renewal alert CLI", () => {
  it("opens the canonical critical alert and attempts both deliveries after a renewal failure", async () => {
    await run("failed");

    expect(state.raise).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      severity: "CRITICAL",
      alertType: "tls.canonical_renewal_failed",
      detail: expect.objectContaining({ automaticRecovery: "previous_valid_certificate_retained", retry: "bounded_certbot_retry" })
    }));
    expect(state.deliver).toHaveBeenCalledTimes(2);
    expect(state.close).not.toHaveBeenCalled();
    expect(state.end).toHaveBeenCalledOnce();
  });

  it("closes the same alert only after a verified renewal", async () => {
    await run("recovered");

    expect(state.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      alertType: "tls.canonical_renewal_failed",
      reason: "canonical_tls_renewal_verified"
    }));
    expect(state.raise).not.toHaveBeenCalled();
    expect(state.deliver).not.toHaveBeenCalled();
  });
});
