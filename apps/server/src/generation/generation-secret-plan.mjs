export function normalizeGenerationSecretName(value) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 128);
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(normalized)) throw Object.assign(new Error("invalid_generation_secret_name"), { statusCode: 400 });
  return normalized;
}

export function generatedInputSecretName(jobId, key) {
  const suffix = String(key ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 72) || "INPUT";
  return `GENERATION_${String(jobId).replaceAll("-", "").slice(0, 12).toUpperCase()}_${suffix}`;
}

export function generationSecretGrantElementKeys(plan, stableName) {
  const normalized = normalizeGenerationSecretName(stableName);
  return (plan.elements ?? [])
    .filter((element) => (element.requiredSecretNames ?? []).map(normalizeGenerationSecretName).includes(normalized))
    .map((element) => String(element.key));
}

export function reconcileGenerationPlanSecrets(planInput, { jobId, activeSecretNames = [] }) {
  const plan = JSON.parse(JSON.stringify(planInput));
  const keys = new Set((plan.elements ?? []).map((element) => String(element.key)));
  const active = new Set(Array.from(activeSecretNames, normalizeGenerationSecretName));
  const providerGenerated = new Set();

  for (const element of plan.elements ?? []) {
    element.requiredSecretNames = Array.from(new Set((element.requiredSecretNames ?? []).map(normalizeGenerationSecretName)));
    element.providerGeneratedSecretNames = Array.from(new Set((element.providerGeneratedSecretNames ?? []).map(normalizeGenerationSecretName)));
    for (const name of element.providerGeneratedSecretNames) {
      providerGenerated.add(name);
      if (!element.requiredSecretNames.includes(name)) element.requiredSecretNames.push(name);
    }
  }

  const normalizedMissing = [];
  const explicitBySecret = new Map();
  for (const raw of plan.missingInputs ?? []) {
    const input = { ...raw };
    if (!input.secret) { normalizedMissing.push(input); continue; }
    const name = normalizeGenerationSecretName(input.stableSecretName?.trim() || generatedInputSecretName(jobId, input.key));
    // A credential explicitly declared as provider-generated is acquired during INTEGRATING,
    // never by asking OWNER to copy/paste it before the candidate exists.
    if (providerGenerated.has(name)) continue;
    input.stableSecretName = name;
    input.grantToElementKeys = Array.from(new Set([...(input.grantToElementKeys ?? []).map(String), ...generationSecretGrantElementKeys(plan, name)])).filter((key) => keys.has(key));
    normalizedMissing.push(input);
    explicitBySecret.set(name, input);
  }
  plan.missingInputs = normalizedMissing;

  for (const element of plan.elements ?? []) {
    for (const name of element.requiredSecretNames ?? []) {
      if (active.has(name) || providerGenerated.has(name) || explicitBySecret.has(name)) continue;
      const input = {
        key: `secret_${name.toLowerCase()}`,
        label: name,
        description: `Chybějící credential ${name} potřebný výsledným CML prvkem.`,
        kind: "SECRET",
        required: true,
        secret: true,
        stableSecretName: name,
        grantToElementKeys: generationSecretGrantElementKeys(plan, name)
      };
      plan.missingInputs.push(input);
      explicitBySecret.set(name, input);
    }
  }

  const unsatisfiedRequiredInputs = plan.missingInputs.filter((input) => {
    if (!input.required) return false;
    if (!input.secret) return true;
    return !active.has(normalizeGenerationSecretName(input.stableSecretName));
  });
  return { plan, activeSecretNames: active, providerGeneratedSecretNames: providerGenerated, unsatisfiedRequiredInputs };
}
