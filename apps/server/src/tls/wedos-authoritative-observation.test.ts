import { describe, expect, it } from "vitest";
import { evaluateAuthoritativeTxtSnapshot, safeAuthoritativeDnsDiagnostics, type AuthoritativeDnsSnapshot } from "./wedos-dns-operation.js";

const snapshot = (observations: AuthoritativeDnsSnapshot["observations"]): AuthoritativeDnsSnapshot => ({ zone: "hcasc.cz", elapsedSeconds: 42, observations });
const ready = {
  authority: "ns.wedos.cz", address: "185.8.238.1", response: "OK" as const,
  soaStatus: "AVAILABLE" as const, soaSerial: "2026082201", expectedTxtPresent: true
};
const baseline = (observations: AuthoritativeDnsSnapshot["observations"]): AuthoritativeDnsSnapshot => snapshot(observations);

describe("WEDOS authoritative observation evaluation", () => {
  it("accepts every delegated authority when its healthy endpoint contains the exact TXT", () => {
    expect(evaluateAuthoritativeTxtSnapshot(snapshot([ready, { ...ready, authority: "ns.wedos.eu", address: "185.8.238.0" }]), true)).toBe("PASS");
  });

  it("treats baseline serial plus absent TXT as still propagating", () => {
    const post = snapshot([{ ...ready, expectedTxtPresent: false }]);
    expect(evaluateAuthoritativeTxtSnapshot(post, true, baseline([{ ...ready, soaSerial: "2026082201", expectedTxtPresent: false }]))).toBe("STILL_PROPAGATING");
  });

  it("classifies mixed baseline and new SOA serials as replica divergence", () => {
    const post = snapshot([
      { ...ready, expectedTxtPresent: true },
      { ...ready, authority: "ns.wedos.eu", address: "185.8.238.0", soaSerial: "2026082200", expectedTxtPresent: false }
    ]);
    const before = baseline([
      { ...ready, soaSerial: "2026082200", expectedTxtPresent: false },
      { ...ready, authority: "ns.wedos.eu", address: "185.8.238.0", soaSerial: "2026082200", expectedTxtPresent: false }
    ]);
    expect(evaluateAuthoritativeTxtSnapshot(post, true, before)).toBe("PROVIDER_REPLICA_DIVERGENCE");
  });

  it("accepts a new serial with the expected TXT", () => {
    const post = snapshot([{ ...ready, soaSerial: "2026082202" }]);
    expect(evaluateAuthoritativeTxtSnapshot(post, true, baseline([{ ...ready, soaSerial: "2026082201", expectedTxtPresent: false }]))).toBe("PASS");
  });

  it("identifies converged new serials with an absent TXT as a WAPI-authoritative discrepancy", () => {
    const post = snapshot([
      { ...ready, soaSerial: "2026082202", expectedTxtPresent: false },
      { ...ready, authority: "ns.wedos.eu", address: "185.8.238.0", soaSerial: "2026082202", expectedTxtPresent: false }
    ]);
    const before = baseline([
      { ...ready, soaSerial: "2026082201", expectedTxtPresent: false },
      { ...ready, authority: "ns.wedos.eu", address: "185.8.238.0", soaSerial: "2026082201", expectedTxtPresent: false }
    ]);
    expect(evaluateAuthoritativeTxtSnapshot(post, true, before)).toBe("WAPI_AUTHORITATIVE_DIVERGENCE");
  });

  it("does not mask a protocol failure as a network failure", () => {
    expect(evaluateAuthoritativeTxtSnapshot(snapshot([{ ...ready, response: "PROTOCOL_FAILURE", expectedTxtPresent: null }]), true)).toBe("PROTOCOL_FAILURE");
  });

  it("allows one failed address when another address for the same delegated NS is healthy", () => {
    expect(evaluateAuthoritativeTxtSnapshot(snapshot([
      { ...ready, response: "NETWORK_FAILURE", soaStatus: "NETWORK_FAILURE", soaSerial: null, expectedTxtPresent: null },
      { ...ready, address: "2a01:430:16::1" }
    ]), true)).toBe("PASS");
  });

  it("fails when every address of a delegated NS is unreachable", () => {
    expect(evaluateAuthoritativeTxtSnapshot(snapshot([
      { ...ready, response: "NETWORK_FAILURE", soaStatus: "NETWORK_FAILURE", soaSerial: null, expectedTxtPresent: null },
      { ...ready, address: "2a01:430:16::1", response: "NETWORK_FAILURE", soaStatus: "NETWORK_FAILURE", soaSerial: null, expectedTxtPresent: null }
    ]), true)).toBe("NETWORK_FAILURE");
  });

  it("preserves IPv4 and IPv6 observations and redacts the challenge value", () => {
    const diagnostics = safeAuthoritativeDnsDiagnostics(snapshot([ready, { ...ready, address: "2a01:430:16::1", expectedTxtPresent: false }]), baseline([{ ...ready, soaSerial: "2026082200", expectedTxtPresent: false }]));
    expect(diagnostics.join("\n")).toContain("address=2a01:430:16::1");
    expect(diagnostics.join("\n")).toContain("baselineSoaSerial=2026082200");
    expect(diagnostics.join("\n")).not.toContain("challenge-value");
  });

  it("uses expectedPresent=false for asynchronous cleanup", () => {
    const post = snapshot([{ ...ready, expectedTxtPresent: false }]);
    expect(evaluateAuthoritativeTxtSnapshot(post, false)).toBe("PASS");
  });
});
