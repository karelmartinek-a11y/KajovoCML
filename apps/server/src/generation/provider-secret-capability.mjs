export function providerJsonPathValue(root, pathValue) {
  const parts = String(pathValue).replace(/^\$\.?/, "").split(".").filter(Boolean);
  let current = root;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

export async function captureProviderJsonSecrets(json, captureSpecs, upsertSecret) {
  const captures = [];
  const capturedPlaintext = [];
  for (const item of Array.isArray(captureSpecs) ? captureSpecs : []) {
    const value = providerJsonPathValue(json, String(item.jsonPath));
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`provider_secret_capture_missing:${String(item.jsonPath)}`);
    const secretValue = String(value);
    capturedPlaintext.push(secretValue);
    captures.push(await upsertSecret({
      stableSecretName: String(item.stableSecretName), value: secretValue,
      displayName: typeof item.displayName === "string" ? item.displayName : undefined,
      description: typeof item.description === "string" ? item.description : undefined,
      grantToElementKeys: Array.isArray(item.grantToElementKeys) ? item.grantToElementKeys.map(String) : undefined
    }));
  }
  return { captures, capturedPlaintext };
}

export async function captureProviderBrowserSecret(browser, input, upsertSecret) {
  const value = await browser.readValue(String(input.locator));
  const stored = await upsertSecret({
    stableSecretName: String(input.stableSecretName), value,
    displayName: typeof input.displayName === "string" ? input.displayName : undefined,
    description: typeof input.description === "string" ? input.description : undefined,
    grantToElementKeys: Array.isArray(input.grantToElementKeys) ? input.grantToElementKeys.map(String) : undefined
  });
  return { stableSecretName: String(input.stableSecretName), stored, capturedPlaintext: value };
}
