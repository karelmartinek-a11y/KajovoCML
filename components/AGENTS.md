# Generated/repository component rules

`docs/SSOT_CURRENT.md` and the canonical component manifest schema are authoritative. Internally generated components are created by KajovoCML generation jobs, not by an external programmer onboarding flow.

A component must be a normal CML component/principal with one runtime access credential, direct Secret Manager grants, canonical hostname/HTTPS boundary, UDS local runtime where applicable, control/state/heartbeat, monitoring, audit and readiness/E2E evidence. Source must not contain persistent secret values. Local source packages and releases must be deterministic, versioned and rollback-capable.

Do not add GitHub/CI/GHCR/OCI or integration-token handoff as a generation runtime dependency or completion gate. Do not ship mocks, placeholders or demo-only behavior.
