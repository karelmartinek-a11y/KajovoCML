import { describe, expect, it } from "vitest";
import { evaluateAuthoritativeTxtSnapshot, safeAuthoritativeDnsDiagnostics, type AuthoritativeDnsSnapshot } from "./wedos-dns-operation.js";

const snapshot = (observations: AuthoritativeDnsSnapshot["observations"]): AuthoritativeDnsSnapshot => ({ zone: "hcasc.cz", elapsedSeconds: 42, observations });
const ready = { authority: "ns.wedos.cz", address: "185.8.238.1", response: "OK" as const, soaSerial: "2026082201", expectedTxtPresent: true };

describe("WEDOS authoritative observation evaluation", () => {
  it("accepts only the full authoritative/address set", () => {
    expect(evaluateAuthoritativeTxtSnapshot(snapshot([ready, { ...ready, authority: "ns.wedos.eu", address: "185.8.238.0" }]), true)).toBe("PASS");
  });

  it("classifies mixed SOA serials as replica convergence rather than stopping at the first mismatch", () => {
    expect(evaluateAuthoritativeTxtSnapshot(snapshot([ready, { ...ready, authority: "ns.wedos.eu", address: "185.8.238.0", soaSerial: "2026082200", expectedTxtPresent: false }]), true)).toBe("PROVIDER_REPLICA_DIVERGENCE");
  });

  it("identifies converged serials with an absent expected TXT as a WAPI-authoritative discrepancy", () => {
    expect(evaluateAuthoritativeTxtSnapshot(snapshot([{ ...ready, expectedTxtPresent: false }, { ...ready, authority: "ns.wedos.eu", address: "185.8.238.0", expectedTxtPresent: false }]), true)).toBe("WAPI_AUTHORITATIVE_DIVERGENCE");
  });

  it("records each address and never emits the TXT value in safe diagnostics", () => {
    const diagnostics = safeAuthoritativeDnsDiagnostics(snapshot([ready, { ...ready, address: "2a01:430:16::1", expectedTxtPresent: false }]));
    expect(diagnostics.join("\n")).toContain("address=2a01:430:16::1");
    expect(diagnostics.join("\n")).not.toContain("challenge-value");
  });

  it("fails closed when every address for an authority is unreachable", () => {
    expect(evaluateAuthoritativeTxtSnapshot(snapshot([{ ...ready, response: "NETWORK_FAILURE", soaSerial: null, expectedTxtPresent: null }]), true)).toBe("NETWORK_FAILURE");
  });
});
