export async function deployCandidatesBeforeIntegration({ artifacts, checkpoint = async () => {}, deployCandidate, waitCandidateRuntime }) {
  for (const artifact of artifacts) {
    await checkpoint();
    await deployCandidate(artifact);
    await waitCandidateRuntime(artifact);
    await checkpoint();
  }
}

export async function runLiveCandidateIntegration({ artifacts, checkpoint = async () => {}, verifyCandidateRuntime, integrate }) {
  for (const artifact of artifacts) {
    await checkpoint();
    await verifyCandidateRuntime(artifact);
  }
  await checkpoint();
  return integrate();
}
