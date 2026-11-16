import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { record } from '../types.js';
import { boundedFile, fingerprint, gitRead, verifyEngine, verifyPolicy, type VerificationProfile } from './verification-profile.js';
import type { VerificationObservation } from './verification-runner.js';

const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];

// A harness-owned temporal seal, not a substitute for the engine's canonical SourceRevision.
// Ignored policy files are checked separately by verifyPolicy; no build/output files are executed here.
export async function repairSourceSeal(profile: VerificationProfile): Promise<string> {
  const root = profile.projectRoot;
  const paths = (await gitRead(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).sort();
  if (paths.length > 10_000) throw new Error('Candidate exceeds bounded source inspection');
  let bytes = 0;
  const files = paths.map(path => {
    const data = boundedFile(root, join(root, path)); bytes += data.length;
    if (bytes > 32 * 1024 * 1024) throw new Error('Candidate exceeds bounded source inspection');
    return [path, fingerprint(data)];
  });
  return fingerprint(JSON.stringify([await gitRead(root, ['rev-parse', 'HEAD']),
    await gitRead(root, ['diff', '--binary', '--no-ext-diff', 'HEAD']), files]));
}

export async function repairFresh(profile: VerificationProfile, observation: VerificationObservation): Promise<boolean> {
  try {
    if (!observation.repairSeal || !observation.integration) return false;
    await verifyEngine(profile); verifyPolicy(profile);
    const i = observation.integration;
    return fingerprint(boundedFile(profile.projectRoot, i.summaryPath)) === i.jsonHash &&
      fingerprint(boundedFile(profile.projectRoot, i.htmlPath)) === i.htmlHash && await repairSourceSeal(profile) === observation.repairSeal;
  } catch { return false; }
}

export async function repairEligible(profile: VerificationProfile, observation: VerificationObservation): Promise<boolean> {
  try {
    if (!profile.repair || observation.status !== 'fail' || !observation.cleanupSettled || !observation.integration?.sourceDigest ||
      !await repairFresh(profile, observation)) return false;
    const engine = await import(pathToFileURL(join(profile.engineRoot, 'dist/index.js')).href);
    if (!['assertIntegrationResult', 'validateEvaluationReport', 'validateCaptureBundle', 'validateEvaluationPolicy', 'canonicalDigest'].every(k => typeof engine[k] === 'function')) return false;
    const result = JSON.parse(boundedFile(profile.projectRoot, observation.integration.summaryPath).toString('utf8'));
    engine.assertIntegrationResult(result);
    if (result.adapter !== 'web' || result.status !== 'fail') return false;
    const stages = rows(result.stages), failing = stages.filter(s => s.status === 'fail');
    if (!failing.length || stages.some(s => !['pass', 'fail'].includes(String(s.status)) || s.cleanupSettled === false) ||
      failing.some(s => s.kind !== 'scenario' || !profile.repair!.scenarios.includes(String(s.id)))) return false;
    for (const id of ['engine-before', 'source-before', 'source-after', 'engine-after', 'evidence-after']) {
      if (!stages.some(s => s.id === id && s.status === 'pass')) return false;
    }
    const conclusions = record(record(record(result.verification).assessment).conclusions);
    if (Object.values(conclusions).some(x => ['needs-review', 'inconclusive', 'blocked', 'unverified'].includes(String(x)))) return false;
    for (const stage of failing) {
      const reports = rows(stage.reports);
      if (!reports.length || !reports.some(r => r.status === 'fail') || reports.some(r => !['pass', 'fail'].includes(String(r.status)))) return false;
      for (const ref of reports.filter(r => r.status === 'fail')) {
        const path = join(profile.projectRoot, String(ref.reportPath));
        const report = engine.validateEvaluationReport(JSON.parse(boundedFile(profile.projectRoot, path).toString('utf8')));
        const spec = record(report.spec), inputs = record(spec.inputs);
        if (engine.canonicalDigest(report) !== ref.reportDigest || spec.executionOutcome !== 'valid' || spec.rawStatus !== 'fail' ||
          engine.canonicalDigest(inputs.sourceRevision) !== result.sourceDigest) return false;
        const capture = engine.validateCaptureBundle(JSON.parse(boundedFile(profile.projectRoot, join(dirname(path), 'capture.json')).toString('utf8')));
        const c = record(capture.spec), completeness = record(c.completeness);
        if (record(capture.metadata).specDigest !== inputs.candidateCaptureDigest || c.executionId !== ref.executionId ||
          c.scenarioId !== stage.id || engine.canonicalDigest(c.sourceRevision) !== result.sourceDigest ||
          completeness.missingRequired !== 0 || completeness.expectedRequired !== completeness.capturedRequired ||
          rows(c.executionErrors).length || rows(c.stepResults).some(s => s.status !== 'passed' || s.origin !== 'product')) return false;
        const assertions = rows(c.assertionResults), failed = assertions.filter(a => a.status === 'failed' && a.origin === 'product');
        if (!failed.length || assertions.some(a => !['passed', 'failed'].includes(String(a.status)) || a.origin !== 'product')) return false;
        const findings = rows(spec.findings);
        if (!findings.length || findings.some(f => f.ruleId !== 'interaction.assertion-failed' || f.evaluatorId !== 'interaction' || f.dimension !== 'interaction' ||
          !failed.some(a => f.metricKey === 'assertion.' + a.assertionId))) return false;
        const policy = engine.validateEvaluationPolicy(JSON.parse(boundedFile(profile.projectRoot, join(dirname(path), 'policy.json')).toString('utf8')));
        if (record(policy.metadata).specDigest !== inputs.policyDigest || rows(spec.scores).some(s => s.status === 'unknown')) return false;
        if (rows(spec.gates).some(g => {
          if (g.status === 'unknown') return true;
          if (g.status !== 'fail') return false;
          const expression = record(rows(record(policy.spec).gates).find(p => p.id === g.gateId)?.expression);
          // Narrow registered policy shapes, not a second engine gate evaluator. Capture above proves the only defect is assertions.
          return !((expression.metric === 'interaction.failedAssertions' && ['eq', 'lte'].includes(String(expression.operator)) && expression.value === 0) ||
            (expression.metric === 'execution.valid' && expression.operator === 'eq' && expression.value === true));
        })) return false;
      }
    }
    return true;
  } catch { return false; }
}
