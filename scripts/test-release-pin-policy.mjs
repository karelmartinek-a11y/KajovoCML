import assert from "node:assert/strict";

function verifyReleaseManifest(manifest, expectedSha) {
  if (manifest.sourceCommit !== expectedSha) throw new Error("release_manifest_source_commit_mismatch");
  if (typeof manifest.buildId !== "string" || !manifest.buildId.startsWith(`${expectedSha}-`)) {
    throw new Error("release_manifest_build_lineage_mismatch");
  }
}

const expectedSha = "0123456789abcdef0123456789abcdef01234567";
verifyReleaseManifest({ sourceCommit: expectedSha, buildId: `${expectedSha}-release` }, expectedSha);
assert.throws(() => verifyReleaseManifest({ sourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", buildId: `${expectedSha}-release` }, expectedSha), /source_commit_mismatch/);
assert.throws(() => verifyReleaseManifest({ sourceCommit: expectedSha, buildId: "wrong-build" }, expectedSha), /build_lineage_mismatch/);
console.log("release-pin-policy:matching=PASS:mismatches=REJECTED");
