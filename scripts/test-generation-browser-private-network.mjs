#!/usr/bin/env node
import { assertPublicBrowserUrl, isPrivateAddress } from "../apps/server/src/generation/playwright-session.mjs";

const privateAddresses = [
  "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1",
  "192.0.0.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
  "::", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "ff02::1"
];
for (const address of privateAddresses) {
  if (!isPrivateAddress(address)) throw new Error(`private_address_not_blocked:${address}`);
}
for (const address of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"]) {
  if (isPrivateAddress(address)) throw new Error(`public_address_blocked:${address}`);
}

for (const url of ["http://127.0.0.1/", "https://[::1]/", "https://localhost/"]) {
  await assertPublicBrowserUrl(url).then(
    () => { throw new Error(`private_url_allowed:${url}`); },
    (error) => {
      if (!(error instanceof Error) || !["browser_https_required", "browser_public_host_required"].includes(error.message)) throw error;
    }
  );
}

console.log("PASS browser navigation blocks private, link-local, reserved, multicast and mapped addresses");
