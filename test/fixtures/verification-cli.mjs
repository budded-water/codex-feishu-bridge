// Synthetic pinned-engine fixture: real child/output/signal boundaries, not UI acceptance.
import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const root = args[args.indexOf('--project-root') + 1];
const mode = JSON.parse(readFileSync(join(root, 'mode.json'), 'utf8')).mode;
writeFileSync(join(root, '.spawns'), String(Number(existsSync(join(root, '.spawns')) ? readFileSync(join(root, '.spawns'), 'utf8') : 0) + 1));
writeFileSync(join(root, '.ready'), String(process.pid));
if (mode === 'environment') writeFileSync(join(root, '.environment.json'), JSON.stringify({
  runtimeVariables: Object.keys(process.env).filter(name => /^(?:HANDOFF_|AGENT_AUTOLOOP_|FEISHU_|BRIDGE_)/i.test(name)),
  projectSetting: process.env.VERIFY_FIXTURE_SETTING,
}));
const finish = (status = mode, code) => {
  const id = mode === 'old' ? '11111111-1111-4111-8111-111111111111' : randomUUID();
  const directory = join(root, '.ui-eval/integration', id); mkdirSync(directory, { recursive: true });
  const result = { apiVersion: 'fixture/v1', kind: 'IntegrationResult', executionId: id, projectId: mode === 'foreign' ? 'other' : 'fixture', suiteId: 'smoke',
    engine: { revision: readFileSync(join(process.cwd(), 'revision'), 'utf8').trim() }, status,
    exitCode: code ?? ({ pass: 0, fail: 1, 'needs-review': 3, inconclusive: 2 }[status] ?? 0),
    stages: [{ cleanupSettled: mode !== 'cleanup' }], suiteDigest: 'fixture-suite', source: {
      commitSha: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirtyTree: Boolean(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim()),
    }, sourceDigest: 'sha256:' + '0'.repeat(64),
    summaryPath: join(directory, 'summary.json'), summaryHtmlPath: join(directory, 'summary.html') };
  if (mode.startsWith('legacy-web')) {
    const digest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const report = { spec: { inputs: { sourceRevision: result.source } } };
    const reportPath = join('.ui-eval/integration', id, 'adapter.json');
    writeFileSync(join(root, reportPath), JSON.stringify(report));
    result.adapter = 'web';
    result.stages[0].reports = [{ reportPath, reportDigest: digest(report) }];
    result.sourceDigest = mode === 'legacy-web-mismatch' ? 'sha256:' + '0'.repeat(64) : digest(result.source);
    delete result.source;
  }
  if (mode === 'cleanup') result.status = 'inconclusive', result.exitCode = 2;
  if (mode === 'wrong-exit') result.exitCode = 1;
  if (mode === 'linked') { const file = join(root, 'foreign.html'); writeFileSync(file, 'foreign'); symlinkSync(file, result.summaryHtmlPath); }
  else if (mode !== 'missing-html') writeFileSync(result.summaryHtmlPath, '<html>' + status + '</html>');
  writeFileSync(result.summaryPath, JSON.stringify(mode === 'mismatch' ? { ...result, projectId: 'other' } : result));
  const envelope = status === 'interrupted' ? { error: { signal: 'SIGTERM' }, partialIntegration: result } : result;
  process.stdout.write(JSON.stringify(envelope)); process.exit(mode === 'wrong-exit' ? 0 : result.exitCode);
};
if (mode === 'hold' || mode === 'stubborn') {
  process.on('SIGTERM', () => { if (mode === 'hold') finish('interrupted', 143); });
  setInterval(() => {}, 1000);
} else finish(mode.startsWith('legacy-web') ||
  ['missing-html', 'mismatch', 'foreign', 'linked', 'old', 'cleanup', 'wrong-exit', 'environment'].includes(mode) ? 'pass' : undefined);
