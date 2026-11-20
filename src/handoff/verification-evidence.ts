import { record } from '../types.js';
import type { VerificationRecord } from './store.js';
import { boundedFile, fingerprint, gitRead, profileDigest, verifyPolicy, type VerificationProfiles } from './verification-profile.js';

export type Applicability = 'unchanged' | 'profile' | 'missing' | 'policy' | 'changed' | 'dirty' | 'unavailable';

export async function verificationApplicabilityState(value: VerificationRecord, profiles: VerificationProfiles): Promise<Applicability> {
  const profile = Object.hasOwn(profiles, value.profile) ? profiles[value.profile] : undefined;
  const observation = value.observation;
  const report = observation?.integration;
  if (!profile || profileDigest(profile) !== value.digest) return 'profile';
  if (!report) return 'missing';
  try {
    const status = (await gitRead(profile.projectRoot, ['status', '--porcelain=v2', '--branch', '--untracked-files=all'])).split('\n');
    if (!observation.gitHead || !status.includes('# branch.oid ' + observation.gitHead)) return 'changed';
    if (status.some(line => !line.startsWith('# '))) return 'dirty';
    try { verifyPolicy(profile); } catch { return 'policy'; }
    if (fingerprint(boundedFile(profile.projectRoot, report.summaryPath)) !== report.jsonHash ||
      fingerprint(boundedFile(profile.projectRoot, report.htmlPath)) !== report.htmlHash) return 'changed';
    return 'unchanged';
  } catch { return 'unavailable'; }
}

export function verificationDeliveryReference(value: VerificationRecord): string | undefined {
  const observation = value.observation;
  const report = observation?.integration;
  if (value.phase !== 'observed' || observation?.status !== 'pass' || !observation.cleanupSettled || !report ||
    !observation.gitHead || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(observation.gitHead) ||
    record(report.source).dirtyTree !== false || !report.sourceDigest) return;
  return 'ui-eval:' + observation.gitHead + '@sha256:' + fingerprint(JSON.stringify([report.jsonHash, report.htmlHash]));
}
