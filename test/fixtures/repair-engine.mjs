// Synthetic engine for real child/SQLite/control tests; not UI acceptance.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.argv[process.argv.indexOf('--project-root') + 1];
const mode = readFileSync(join(root, 'mode.txt'), 'utf8');
const count = Number(existsSync(join(root, '.spawns')) ? readFileSync(join(root, '.spawns'), 'utf8') : 0) + 1;
writeFileSync(join(root, '.spawns'), String(count));
writeFileSync(join(root, '.ready'), String(process.pid));
const digest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = readFileSync(join(root, 'page.txt'), 'utf8') !== 'fixed';
const finish = () => {
  const id = randomUUID(), directory = join(root, '.ui-eval/integration', id), run = join(root, '.ui-eval/runs', id);
  mkdirSync(directory, { recursive: true }); mkdirSync(run, { recursive: true });
  const source = { commitSha: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
  const captureSpec = { executionId: id, scenarioId: 'home', sourceRevision: source,
    completeness: { missingRequired: 0, capturedRequired: 1, expectedRequired: 1 }, stepResults: [{ stepId: 'visit', status: 'passed', origin: 'product' }],
    assertionResults: [{ assertionId: 'title', origin: mode === 'fixture-fault' ? 'fixture' : 'product', status: fail ? 'failed' : 'passed' }], executionErrors: [] };
  const policySpec = { gates: [{ id: 'assertions', expression: { metric: 'interaction.failedAssertions', operator: 'eq', value: 0 } }] };
  const policy = { spec: policySpec, metadata: { specDigest: digest(policySpec) } };
  const report = { spec: { executionOutcome: 'valid', rawStatus: fail ? 'fail' : 'pass', inputs: { sourceRevision: source,
    candidateCaptureDigest: digest(captureSpec), policyDigest: digest(policySpec) }, findings: fail ? [{ ruleId: 'interaction.assertion-failed',
      evaluatorId: 'interaction', dimension: 'interaction', metricKey: 'assertion.title', fingerprint: 'title' }] : [],
    gates: [{ gateId: 'assertions', status: fail ? 'fail' : 'pass' }] } };
  for (const [file, data] of [['capture.json', { spec: captureSpec, metadata: { specDigest: digest(captureSpec) } }], ['report.json', report], ['policy.json', policy]]) {
    writeFileSync(join(run, file), JSON.stringify(data));
  }
  writeFileSync(join(run, 'report.html'), '<html>synthetic</html>');
  const stages = ['engine-before', 'source-before', 'source-after', 'engine-after', 'evidence-after'].map(id => ({ id, kind: id.startsWith('source') ? 'source' : 'engine', status: 'pass', reports: [] }));
  stages.push({ id: 'home', kind: 'scenario', status: fail ? 'fail' : 'pass', reports: [{ executionId: id, status: fail ? 'fail' : 'pass',
    reportPath: '.ui-eval/runs/' + id + '/report.json', reportDigest: digest(report) }] });
  if (mode === 'mixed') stages.push({ id: 'build', kind: 'check', status: 'fail', reports: [] });
  const result = { kind: 'IntegrationResult', adapter: 'web', executionId: id, projectId: 'fixture', suiteId: 'smoke', suiteDigest: 'suite',
    engine: { revision: readFileSync(join(process.cwd(), 'revision'), 'utf8') }, status: fail ? 'fail' : 'pass', exitCode: fail ? 1 : 0,
    source, sourceDigest: digest(source), stages, summaryPath: join(directory, 'summary.json'), summaryHtmlPath: join(directory, 'summary.html') };
  writeFileSync(result.summaryPath, JSON.stringify(result));
  if (mode !== 'missing-html') writeFileSync(result.summaryHtmlPath, '<html>summary</html>');
  process.stdout.write(JSON.stringify(result)); process.exit(result.exitCode);
};
if (mode === 'hold') { process.on('SIGTERM', () => process.exit(143)); setInterval(() => {}, 1000); }
else finish();
