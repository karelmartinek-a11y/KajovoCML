import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { loadConfigFromDb } from "../domain/operational-config.js";
import { issueRepositoryComponentRuntimeEgressCapability } from "../domain/repository-component-runtime-auth.js";

const repositoryKey = process.argv[2];
if (!repositoryKey) {
  process.stderr.write("repository key required\n");
  process.exit(2);
}

const bootstrapConfig = loadBootstrapConfig();
const db = createDb(bootstrapConfig);

try {
  const config = await loadConfigFromDb(db, bootstrapConfig);
  const issued = await issueRepositoryComponentRuntimeEgressCapability(db, config, repositoryKey);
  if (issued) process.stdout.write(`${issued}\n`);
} finally {
  await db.end();
}
