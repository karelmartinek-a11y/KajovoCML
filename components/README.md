# In-repository KCML components

`components/` is the only source root for newly generated AI agents, MCP-facing components and deterministic microsteps that are maintained in the KajovoCML repository.

Each component lives in exactly one isolated directory:

```text
components/<repository-key>/
├── component.kcml.json
├── manifest.kcml.json
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── src/
│   ├── index.ts
│   └── *.test.ts
└── evidence/
    ├── architecture.md
    ├── threat-model.md
    └── runbook.md
```

The normative source contract is `docs/onboarding-catalogs/repository-component-1.0.json`. The authoritative runtime and registration contract remains the current `component-*.json` catalog.

The directory key is a stable repository identifier, not a KCML code. KCML assigns the component identity and hostname during registration. Integration tokens and access tokens must never be committed. Components are intentionally excluded from the root pnpm workspace and must be reproducible isolated packages with their own lockfile.

A source merge or signed image build is not KCML registration. The immutable runtime must be deployed, the final manifest must contain real digests and runtime coordinates, and registration must then be completed through `/v2/component-onboardings` with an authorized integration token.
