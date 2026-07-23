#!/usr/bin/env bash
set -euo pipefail

workflow=".github/workflows/ci-deploy.yml"
test -f "$workflow"

# Branch pushes and pull requests still enter platform CI whenever the diff
# includes a non-component path. Only isolated components/<key>/** trees are
# ignored by the main workflow.
grep -A5 '^  push:' "$workflow" | grep -Fq 'branches: ["**"]'
grep -A6 '^  push:' "$workflow" | grep -Fq 'paths-ignore:'
grep -A8 '^  push:' "$workflow" | grep -Fq -- '- "components/*/**"'
! grep -A8 '^  push:' "$workflow" | grep -Fq -- '- "components/**"'
grep -A5 '^  pull_request:' "$workflow" | grep -Fq 'paths-ignore:'
grep -A8 '^  pull_request:' "$workflow" | grep -Fq -- '- "components/*/**"'
grep -Fq '  workflow_dispatch:' "$workflow"
grep -Fq 'perform_factory_reset:' "$workflow"
grep -Fq 'factory_reset_confirmation:' "$workflow"

# Production release and deployment remain main-only and still accept both
# automatic pushes and explicit manual dispatch.
grep -Fq "if: github.ref == 'refs/heads/main' && (github.event_name == 'workflow_dispatch' || github.event_name == 'push')" "$workflow"
test "$(grep -Fc "if: github.ref == 'refs/heads/main' && (github.event_name == 'workflow_dispatch' || github.event_name == 'push')" "$workflow")" = "2"

# The release must still be signed and the exact downloaded blob must be
# verified against the GitHub Actions workflow identity before deployment.
grep -Fq 'cosign sign-blob --yes --bundle /tmp/kcml-release.tar.zst.sigstore.json /tmp/kcml-release.tar.zst' "$workflow"
grep -Fq 'cosign verify-blob kcml-release.tar.zst' "$workflow"
grep -Fq -- '--bundle kcml-release.tar.zst.sigstore.json' "$workflow"
grep -Fq -- '--certificate-identity=https://github.com/${{ github.repository }}/.github/workflows/ci-deploy.yml@refs/heads/main' "$workflow"
grep -Fq -- '--certificate-oidc-issuer=https://token.actions.githubusercontent.com' "$workflow"

# The deploy job must still consume the release artifact and cannot bypass
# CI/security or the freshness guard.
grep -Fq 'needs: [ci, security, release]' "$workflow"
grep -Fq 'name: kcml-release-${{ github.sha }}' "$workflow"
grep -Fq 'sha256sum --check kcml-release.tar.zst.sha256' "$workflow"
grep -Fq '/usr/local/sbin/kcml-deploy-wrapper' "$workflow"
grep -Fq '"${{ github.event_name }}"' "$workflow"
grep -Fq 'KCML_FACTORY_RESET_CONFIRM:' "$workflow"
grep -Fq 'sudo --preserve-env=PASS,GHCR_TOKEN,GHCR_ACTOR,KCML_FACTORY_RESET_CONFIRM /usr/local/sbin/kcml-deploy-wrapper' "$workflow"
grep -Fq 'id: freshness' "$workflow"
grep -Fq '"$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/git/ref/heads/main"' "$workflow"
test "$(grep -Fc "if: steps.freshness.outputs.should_deploy == 'true'" "$workflow")" = "4"

# Avoid indefinite production jobs on a wedged self-hosted runner and keep
# platform deploys serialized.
grep -A8 '^  deploy:' "$workflow" | grep -Fq 'timeout-minutes:'
grep -A12 '^  deploy:' "$workflow" | grep -Fq 'group: production-deploy'
grep -A12 '^  deploy:' "$workflow" | grep -Fq 'cancel-in-progress: false'
