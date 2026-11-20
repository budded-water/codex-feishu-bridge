import { record } from '../types.js';
import type { VerificationRecord } from './store.js';
import { boundedFile, fingerprint, profileDigest, verificationSourceState, verifyPolicy, type VerificationProfiles } from './verification-profile.js';

export type Applicability = 'unchanged' | 'profile' | 'missing' | 'policy' | 'changed' | 'dirty' | 'unavailable';

export async function verificationApplicabilityState(value: VerificationRecord, profiles: VerificationProfiles): Promise<Applicability> {
  const profile = Object.hasOwn(profiles, value.profile) ? profiles[value.profile] : undefined;
  const observation = value.observation;
  const report = observation?.integration;
  if (!profile || profileDigest(profile) !== value.digest) return 'profile';
  if (!report) return 'missing';
  try {
    const status = await verificationSourceState(profile.projectRoot);
    if (status.commit !== observation.gitHead) return 'changed';
    try { verifyPolicy(profile); } catch { return 'policy'; }
    if (fingerprint(boundedFile(profile.projectRoot, report.summaryPath)) !== report.jsonHash ||
      fingerprint(boundedFile(profile.projectRoot, report.htmlPath)) !== report.htmlHash) return 'changed';
    if (!status.clean) return 'dirty';
    return 'unchanged';
  } catch { return 'unavailable'; }
}

export function verificationDeliveryReference(value: VerificationRecord): string | undefined {
  const observation = value.observation;
  const report = observation?.integration;
  if (value.phase !== 'observed' || observation?.status !== 'pass' || !observation.cleanupSettled || !report ||
    !observation.cleanSource || !observation.gitHead || record(report.source).dirtyTree !== false || !report.sourceDigest) return;
  return 'ui-eval:' + observation.gitHead + '@sha256:' + fingerprint(JSON.stringify([report.jsonHash, report.htmlHash]));
}
