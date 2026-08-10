# Components

This directory contains component source that is maintained with KajovoCML. The active contract for all new internally generated elements is the canonical component manifest schema plus `docs/SSOT_CURRENT.md`.

Generation creates job-specific source outside this directory, validates it against the same CML contract, installs a versioned local `SOURCE_PACKAGE` release and registers it into the canonical component/principal lifecycle. GitHub/CI/GHCR/OCI and external integration-token handoff are not part of that runtime flow.
