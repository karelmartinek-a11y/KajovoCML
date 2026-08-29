import assert from "node:assert/strict";

function verifyReleaseManifest(manifest, expectedSha) {
  if (manifest.sourceCommit !== expectedSha) throw new Error("release_manifest_source_commit_mismatch");
  if (typeof manifest.buildId !== "string" || !manifest.buildId.startsWith(`${expectedSha}-`)) {
    throw new Error("release_manifest_build_lineage_mismatch");
  }
}

function verifyAcceptancePin(apiVersion, manifest, expectedSha) {
  if (apiVersion.commitSha !== expectedSha) throw new Error("api_commit_sha_mismatch");
  verifyReleaseManifest(manifest, expectedSha);
}

const expectedSha = "0123456789abcdef0123456789abcdef01234567";
verifyReleaseManifest({ sourceCommit: expectedSha, buildId: `${expectedSha}-release` }, expectedSha);
verifyAcceptancePin({ commitSha: expectedSha }, { sourceCommit: expectedSha, buildId: `${expectedSha}-release` }, expectedSha);
assert.throws(() => verifyAcceptancePin({ commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, { sourceCommit: expectedSha, buildId: `${expectedSha}-release` }, expectedSha), /api_commit_sha_mismatch/);
assert.throws(() => verifyAcceptancePin({ commitSha: expectedSha }, { sourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", buildId: `${expectedSha}-release` }, expectedSha), /source_commit_mismatch/);
assert.throws(() => verifyReleaseManifest({ sourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", buildId: `${expectedSha}-release` }, expectedSha), /source_commit_mismatch/);
assert.throws(() => verifyReleaseManifest({ sourceCommit: expectedSha, buildId: "wrong-build" }, expectedSha), /build_lineage_mismatch/);
console.log("release-pin-policy:matching=PASS:mismatches=REJECTED");
