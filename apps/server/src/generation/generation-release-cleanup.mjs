import { rename, rm, symlink } from "node:fs/promises";

/**
 * Switch the generated runtime away from an abandoned candidate release.
 * Database release-state transitions remain owned by the canonical CML release domain;
 * this helper performs only the filesystem/runtime side of that same operation.
 */
export async function switchGeneratedCandidateRuntime({
  currentPath,
  previousReleasePath = null,
  componentCode,
  runPrivileged
}) {
  if (previousReleasePath) {
    const recovery = `${currentPath}.rollback-${process.pid}-${Date.now()}`;
    await rm(recovery, { force: true });
    await symlink(previousReleasePath, recovery);
    await rename(recovery, currentPath);
    await runPrivileged("restart", componentCode);
    return "RESTORED_PREVIOUS";
  }

  // First CREATE has no prior release. Stop before removing the current link so
  // the DB is never marked ROLLED_BACK while a candidate runtime is knowingly live.
  await runPrivileged("stop", componentCode);
  await rm(currentPath, { force: true });
  return "REMOVED_FIRST_CANDIDATE";
}
