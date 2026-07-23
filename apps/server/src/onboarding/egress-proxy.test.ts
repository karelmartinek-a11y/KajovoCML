import { describe, expect, it } from "vitest";
import { isAllowedDestination, isAllowedTcpTlsDestination, isForbiddenAddress, tlsServername } from "./egress-proxy.js";

describe("egress SSRF policy", () => {
  it("blocks loopback, private, link-local, metadata and mapped addresses", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isForbiddenAddress(address), address).toBe(true);
    }
    expect(isForbiddenAddress("8.8.8.8")).toBe(false);
    expect(isForbiddenAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("allows only exact HTTPS hosts and ports from the manifest", () => {
    const allowlist = ["api.example.com", "payments.example.com:8443"];
    expect(isAllowedDestination(new URL("https://api.example.com/v1"), allowlist)).toBe(true);
    expect(isAllowedDestination(new URL("https://payments.example.com:8443/v1"), allowlist)).toBe(true);
    expect(isAllowedDestination(new URL("http://api.example.com/v1"), allowlist)).toBe(false);
    expect(isAllowedDestination(new URL("https://sub.api.example.com/v1"), allowlist)).toBe(false);
    expect(isAllowedDestination(new URL("https://localhost/v1"), ["localhost"])).toBe(false);
  });

  it("uses TLS SNI only for DNS names", () => {
    expect(tlsServername("api.example.com")).toBe("api.example.com");
    expect(tlsServername("127.0.0.1")).toBeUndefined();
    expect(tlsServername("[::1]")).toBeUndefined();
  });

  it("allows only exact TCP/TLS host, port and SNI grants", () => {
    const allowlist = [{ targetHost: "imap.example.com", port: 993, servername: "imap.example.com", protocol: "TCP_TLS" }] as const;
    expect(isAllowedTcpTlsDestination({ hostname: "imap.example.com", port: 993, servername: "imap.example.com", protocol: "TCP_TLS" }, allowlist)).toBe(true);
    expect(isAllowedTcpTlsDestination({ hostname: "imap.example.com", port: 993, servername: "imap-alt.example.com", protocol: "TCP_TLS" }, allowlist)).toBe(false);
    expect(isAllowedTcpTlsDestination({ hostname: "imap.example.com", port: 143, servername: "imap.example.com", protocol: "TCP_TLS" }, allowlist)).toBe(false);
  });
});
