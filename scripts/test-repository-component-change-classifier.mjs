import assert from "node:assert/strict";
import { classifyChangedEntries } from "./classify-repository-component-changes.mjs";

function classify(entries) {
  return classifyChangedEntries(entries.map((entry) => ({
    status: entry.status,
    paths: Array.isArray(entry.paths) ? entry.paths : [entry.path]
  })));
}

{
  const result = classify([{ status: "M", path: "components/alpha-service/src/index.ts" }]);
  assert.equal(result.pureComponentChange, true);
  assert.equal(result.selectedRepositoryKey, "alpha-service");
}

{
  const result = classify([
    { status: "M", path: "components/alpha-service/src/index.ts" },
    { status: "M", path: "components/beta-service/src/index.ts" }
  ]);
  assert.equal(result.multipleComponents, true);
  assert.equal(result.repositoryKeyCount, 2);
}

{
  const result = classify([
    { status: "M", path: "components/alpha-service/src/index.ts" },
    { status: "M", path: "apps/server/src/index.ts" }
  ]);
  assert.equal(result.mixedChange, true);
  assert.deepEqual(result.platformPaths, ["apps/server/src/index.ts"]);
}

{
  const result = classify([{ status: "M", path: "components/README.md" }]);
  assert.equal(result.componentInfrastructureOnly, true);
  assert.equal(result.hasComponentChange, false);
}

{
  const result = classify([{ status: "M", path: "components/Invalid-Key/src/index.ts" }]);
  assert.deepEqual(result.invalidPaths, ["components/Invalid-Key/src/index.ts"]);
}

{
  const result = classify([{ status: "M", path: "components/file.txt" }]);
  assert.deepEqual(result.invalidPaths, ["components/file.txt"]);
}

{
  const result = classify([{ status: "D", path: "components/alpha-service/src/index.ts" }]);
  assert.deepEqual(result.deletedComponentKeys, ["alpha-service"]);
}

{
  const result = classify([{ status: "R100", paths: ["components/alpha-service/src/index.ts", "components/gamma-service/src/index.ts"] }]);
  assert.equal(result.multipleComponents, true);
  assert.deepEqual(result.repositoryKeys, ["alpha-service", "gamma-service"]);
}

{
  const result = classify([]);
  assert.equal(result.hasChanges, false);
  assert.equal(result.changedPathCount, 0);
}

{
  const result = classify([
    { status: "M", path: "components/alpha-service/src/index.ts" },
    { status: "M", path: "components/alpha-service/src/worker.ts" }
  ]);
  assert.equal(result.repositoryKeyCount, 1);
  assert.equal(result.pureComponentChange, true);
}

process.stdout.write("repository component change classifier checks passed\n");
