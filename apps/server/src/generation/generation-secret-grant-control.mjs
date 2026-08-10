import { normalizeGenerationSecretName } from "./generation-secret-plan.mjs";

/**
 * Apply an already-existing KajovoCML secret to the generation worker and to the
 * deterministic generated component identities that require it. The caller owns
 * the canonical Secret Manager/DB primitives; this helper only enforces ordering.
 */
export async function grantGenerationSecretBeforeResume({
  stableSecretName,
  elementKeys,
  findActiveSecret,
  grantPlatform,
  listComponents,
  grantComponent
}) {
  const stableName = normalizeGenerationSecretName(stableSecretName);
  const secret = await findActiveSecret(stableName);
  if (!secret) return { available: false, stableName, grantedElementKeys: [], componentIds: [] };

  await grantPlatform(secret);
  const keys = Array.from(new Set((elementKeys ?? []).map(String).filter(Boolean)));
  const components = keys.length ? await listComponents(keys) : [];
  const componentIds = [];
  for (const component of components) {
    await grantComponent(secret, component);
    componentIds.push(String(component.componentId));
  }
  return { available: true, stableName, grantedElementKeys: keys, componentIds };
}

/**
 * Resume a satisfied generation job only after INTEGRATING component grants are
 * reconciled. This ordering is authoritative for the first provider callback after
 * OWNER input submission.
 */
export async function resumeGenerationAfterSatisfiedInputs({
  resumeState,
  ensureIntegrationGrants,
  setState,
  clearResumeState,
  appendCompleteEvent
}) {
  if (resumeState === "INTEGRATING") await ensureIntegrationGrants();
  await setState(resumeState);
  await clearResumeState();
  await appendCompleteEvent(resumeState);
}
