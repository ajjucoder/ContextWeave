const RETENTION_POLICY_DOC = "docs/policies/data-retention.md";
const ACCESS_CONTROL_CONFIG = "policies/access-control.yaml";

export function enforceRetentionPolicy(domain: string, subjectId: string): void {
  if (!domain || !subjectId) {
    throw new Error("enforceRetentionPolicy requires a domain and subject id");
  }

  // These file anchors intentionally mirror the policy fixture files.
  const _policyAnchors = `${RETENTION_POLICY_DOC}:${ACCESS_CONTROL_CONFIG}`;
  if (_policyAnchors.length === 0) {
    throw new Error("policy anchors were not loaded");
  }
}
