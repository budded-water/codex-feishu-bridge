import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { record } from '../types.js';
import { boundedFile, fingerprint, verifyEngine, verifyPolicy, verificationEnvironment, type VerificationProfile } from './verification-profile.js';
import { repairSourceSeal } from './repair-evidence.js';

export interface VerificationObservation {
  status: 'pass' | 'fail' | 'needs-review' | 'inconclusive' | 'interrupted' | 'unverified';
  cleanupSettled: boolean; code: number | null; signal: string | null; reason: string;
  integration?: { id: string; source: unknown; sourceDigest: string | null; suiteDigest: string;
    summaryPath: string; htmlPath: string; jsonHash: string; htmlHash: string; conclusions: unknown };
  gitHead?: string; observedAt: number;
  repairSeal?: string;
}

async function child(profile: VerificationProfile, signal: AbortSignal, graceMs: number) {
  return new Promise<{ stdout: string; code: number | null; signal: string | null; forced: boolean }>((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [join(profile.engineRoot, 'dist/cli.js'), 'integrate', profile.suite,
      '--project-root', profile.projectRoot, '--format', 'json'], { cwd: profile.engineRoot, stdio: ['ignore', 'pipe', 'pipe'], env: verificationEnvironment() });
    let output = '', bytes = 0, forced = false, killing: NodeJS.Timeout | undefined;
    const abort = () => {
      if (killing || process.exitCode !== null || process.signalCode !== null) return;
      process.kill('SIGTERM');
      killing = setTimeout(() => { forced = true; process.kill('SIGKILL'); process.stdout.destroy(); process.stderr.destroy(); }, graceMs);
    };
    const deadline = setTimeout(abort, profile.timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (data: string) => {
      bytes += Buffer.byteLength(data);
      if (bytes <= 8 * 1024 * 1024) output += data;
      else { forced = true; abort(); }
    });
    process.stderr.resume(); // Raw candidate diagnostics never enter the handoff or transport.
    process.once('error', reject);
    process.once('close', (code, endedBy) => {
      clearTimeout(deadline); clearTimeout(killing); signal.removeEventListener('abort', abort);
      resolve({ stdout: output, code, signal: endedBy, forced });
    });
    if (signal.aborted) abort();
  });
}

export async function runVerification(profile: VerificationProfile, signal: AbortSignal, graceMs = 95_000): Promise<VerificationObservation> {
  let exit: Awaited<ReturnType<typeof child>> | undefined;
  let invoked = false;
  try {
    signal.throwIfAborted();
    await verifyEngine(profile);
    verifyPolicy(profile);
    const base = join(profile.projectRoot, '.ui-eval/integration');
    let prior: Set<string>;
    try { prior = new Set(readdirSync(base)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; prior = new Set(); }
    // Only this owner-selected, source/build-pinned library may interpret its CLI output.
    const engine = await import(pathToFileURL(join(profile.engineRoot, 'dist/index.js')).href);
    if (typeof engine.assertIntegrationResult !== 'function') throw new Error('Unsupported pinned engine');
    let repairSeal: string | undefined;
    if (profile.repair) { try { repairSeal = await repairSourceSeal(profile); } catch { /* Verification can run without qualifying for repair. */ } }
    signal.throwIfAborted();
    invoked = true;
    exit = await child(profile, signal, graceMs);
    if (exit.forced || exit.signal) throw new Error('CLI completion unavailable');
    const envelope = record(JSON.parse(exit.stdout));
    const value: unknown = envelope.partialIntegration ?? envelope;
    engine.assertIntegrationResult(value);
    const result = record(value);
    const source = record(result.source);
    if (envelope.partialIntegration !== undefined && (result.status !== 'interrupted' ||
      ![130, 143].includes(Number(exit.code)) || record(envelope.error).signal !== (exit.code === 130 ? 'SIGINT' : 'SIGTERM'))) throw new Error('Invalid interrupted envelope');
    const id = String(result.executionId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || prior.has(id) || result.projectId !== profile.projectId || result.suiteId !== profile.suite ||
      record(result.engine).revision !== profile.engineRevision || result.exitCode !== exit.code ||
      result.summaryPath !== join(base, id, 'summary.json') || result.summaryHtmlPath !== join(base, id, 'summary.html')) throw new Error('Foreign or unconfirmed integration');
    if (result.status === 'pass' && (typeof result.sourceDigest !== 'string' || typeof source.commitSha !== 'string')) throw new Error('Missing source identity');
    const json = boundedFile(profile.projectRoot, String(result.summaryPath));
    const html = boundedFile(profile.projectRoot, String(result.summaryHtmlPath));
    if (!html.length || !isDeepStrictEqual(JSON.parse(json.toString('utf8')), result)) throw new Error('Incomplete integration projections');
    await verifyEngine(profile);
    verifyPolicy(profile);
    const stages = result.stages as { cleanupSettled?: boolean }[];
    const cleanupSettled = !stages.some(stage => stage.cleanupSettled === false);
    if (repairSeal) { try { if (await repairSourceSeal(profile) !== repairSeal) repairSeal = undefined; } catch { repairSeal = undefined; } }
    return { status: result.status as VerificationObservation['status'], code: exit.code, signal: exit.signal, cleanupSettled,
      reason: cleanupSettled ? 'Observed pinned CLI handoff' : 'Engine reported incomplete cleanup',
      integration: { id, source: result.source ?? null, sourceDigest: typeof result.sourceDigest === 'string' ? result.sourceDigest : null,
        suiteDigest: String(result.suiteDigest), summaryPath: String(result.summaryPath), htmlPath: String(result.summaryHtmlPath),
        jsonHash: fingerprint(json), htmlHash: fingerprint(html), conclusions: result.verification ? record(record(result.verification).assessment).conclusions : null },
      gitHead: typeof source.commitSha === 'string' ? source.commitSha : undefined, observedAt: Date.now(), ...(repairSeal ? { repairSeal } : {}) };
  } catch {
    return { status: 'unverified', code: exit?.code ?? null, signal: exit?.signal ?? null, cleanupSettled: !invoked,
      reason: invoked ? 'Invocation or evidence could not be confirmed; inspect processes and effects before recovery' : 'Verification did not launch: profile, policy, engine or cancellation precondition failed', observedAt: Date.now() };
  }
}
