# ADR 0002: Managed services and EXTERNAL_API pipeline

**Status:** RETIRED / HISTORICAL — NOT AN ACTIVE CREATION OR DEPLOYMENT CONTRACT.

This ADR records an earlier additive architecture direction in which new MCP/managed services could enter KajovoCML through external onboarding, integration tokens, uploaded artifacts and OCI-oriented pipelines. That product path was superseded by `docs/SSOT_CURRENT.md` and the internal `Generování` implementation during `PRE_PRODUCTION_TESTING`.

Do **not** use this ADR to design or implement new generated components. In particular, it does not authorize an `integration token → external programmer/upload → PR/CI → OCI/GHCR/signature → access token` lifecycle.

The reusable ideas that survived are already implemented in the active CML model and remain valid only through their current source-code contracts:

- canonical governed identities and hostnames;
- exact scope/permission checks;
- existing external HTTPS API/egress integrations;
- monitoring, audit, revocation and operational status;
- legitimate externally operated services where the product explicitly manages an external API.

External communication, public provider webhooks and governed external HTTPS APIs remain legitimate. They are not the retired external **onboarding** product path.

Current implementation authority: source code plus `docs/SSOT_CURRENT.md`. Current architecture summary: `docs/ARCHITECTURE.md` and ADR 0001.
