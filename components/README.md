# In-repository KCML components

`components/` is the only source root for AI agents, MCP-facing components and deterministic microsteps that are maintained in the KajovoCML repository. Components may also be maintained outside KajovoCML and then follow only the generic component onboarding catalog during registration.

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

The normative source contract is `docs/onboarding-catalogs/repository-component-1.1.json`. The authoritative runtime and registration contract remains the current `component-*.json` catalog.

The directory key is a stable repository identifier, not a KCML code. KCML assigns the component identity and hostname during registration. Integration tokens and access tokens must never be committed. Components are intentionally excluded from the root pnpm workspace and must be reproducible isolated packages with their own lockfile.

A source merge or signed image build is not KCML registration. `manifest.kcml.json` inside `components/<repository-key>/` is the source-phase contract only. The immutable runtime must be built and deployed first, the deploy receipt must capture the real image digest and stable live runtime location, and the final manifest is then synthesized from the source manifest plus the deploy receipt before registration through `/v2/component-onboardings` with an authorized integration token.

Clean component-only changes are validated by the dedicated repository-component PR workflow and deployed by `.github/workflows/repository-component-deploy.yml`. The resulting production observation is written as a nonsecret deploy receipt that must conform to `apps/server/src/contracts/repository-component-deploy-receipt-1.0.schema.json`.
