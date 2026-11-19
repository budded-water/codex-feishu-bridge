import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { record } from '../types.js';
import { alertStatuses, channels, isSecond, type BacklogSample, type Binding, type Channel,
  type Evaluation, type Evidence, type RecoverySample } from './observer.js';

const exec = promisify(execFile);
const maxRows = 100;
const historyStore = 'internal-alert-history';
const runtimeStore = 'service-runtime';
const refundScope = 'managed:local_product_order:native_case_refunds';
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
const recoveryOutcomes = ['completed', 'degraded', 'failed', 'timeout', 'overlap_skipped'] as const;

export type ObserverConfig = { binding: Binding; aliyun?: { executable: string; profile: string } };

function name(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return allowed.some(option => option === value);
}

function second(value: unknown): number {
  const parsed = typeof value === 'string' && /^(?:0|[1-9]\d{0,14})$/.test(value) ? Number(value) : value;
  if (!isSecond(parsed)) throw new Error('Invalid SLS time or counter');
  return parsed;
}

export function parseObserverConfig(value: unknown, mode: Binding['mode']): ObserverConfig {
  const { region, project, rule, start, executable, profile } = record(value);
  if (!name(region) || !name(project) || !name(rule) || !isSecond(start)) throw new Error('Invalid observer source binding');
  const binding = { mode, region, project, rule, start };
  if (mode === 'replay') return { binding };
  if (typeof executable !== 'string' || !isAbsolute(executable) || !name(profile)) {
    throw new Error('Live observation requires an absolute Alibaba Cloud CLI path and named profile');
  }
  return { binding, aliyun: { executable, profile } };
}

function completeRows(value: unknown): Record<string, unknown>[] {
  let payload: Record<string, unknown>;
  try { payload = record(typeof value === 'string' ? JSON.parse(value) : value); }
  catch { throw new Error('SLS response is not valid JSON'); }
  const meta = record(payload.meta);
  const rows = payload.data ?? payload.logs;
  if (meta.progress !== 'Complete' || meta.isAccurate !== true || meta.powerSql === true ||
    !Array.isArray(rows) || rows.length >= maxRows ||
    (meta.count !== undefined && second(meta.count) !== rows.length)) {
    throw new Error('SLS response is incomplete or reached the bounded query limit');
  }
  return rows.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid SLS log row');
    return record(value);
  });
}

export function readEvaluations(value: unknown, binding: Binding): Evaluation[] {
  return completeRows(value).map(row => {
    const { AlertID: id, AlertName: name, AlertStatus: status } = row;
    if (name !== binding.rule || typeof id !== 'string' || !oneOf(status, alertStatuses)) {
      throw new Error('SLS evaluation identity or status is outside the registered rule');
    }
    return { id, at: second(row.__time__), status };
  });
}

export function readEvidence(value: unknown): Evidence {
  const backlog: ({ run: string } & BacklogSample)[] = [];
  let failedBacklogAt = -1;
  const terminal: ({ run: string } & RecoverySample)[] = [];
  for (const row of completeRows(value)) {
    if (typeof row.content !== 'string') throw new Error('Missing refund observation content');
    const body = row.content.replace(/^\S+ (?:stdout|stderr) F /, '').trim();
    let entry: Record<string, unknown>;
    try { entry = record(JSON.parse(body)); }
    catch { throw new Error('Malformed refund observation'); }
    if (entry.scope !== refundScope) throw new Error('Unexpected refund observation scope');
    const at = second(row.__time__);
    if (entry.event === 'merchant_refund_backlog') {
      if (entry.outcome === 'failed') {
        failedBacklogAt = Math.max(at, failedBacklogAt);
        continue;
      }
      if (!oneOf(entry.channel, channels) || entry.outcome !== 'completed' || !name(entry.run_id)) {
        throw new Error('Unexpected refund backlog observation');
      }
      backlog.push({ run: entry.run_id, channel: entry.channel, at, pending: second(entry.pending),
        queryable: second(entry.queryable), missing: second(entry.missing_channel_identity), oldestSeconds: second(entry.oldest_age_seconds) });
    } else if (entry.event === 'merchant_refund_recovery') {
      if (entry.outcome === 'started') continue;
      if (!oneOf(entry.outcome, recoveryOutcomes) || !name(entry.run_id)) throw new Error('Unexpected refund recovery outcome');
      terminal.push({ run: entry.run_id, at, outcome: entry.outcome, queryErrors: second(entry.query_errors), deferred: second(entry.deferred) });
    } else throw new Error('Unexpected refund observation event');
  }
  const recent = backlog.reduce<typeof backlog[number] | undefined>((latest, value) => !latest || value.at > latest.at ? value : latest, undefined);
  const accepted = new Map<Channel, BacklogSample>();
  const conflicts = new Set<Channel>();
  if (recent && backlog.some(sample => sample.at === recent.at && sample.run !== recent.run)) {
    return { backlog: [], unavailable: 'invalid-or-incomplete-source' };
  }
  if (recent && recent.at > failedBacklogAt) {
    for (const { run, ...sample } of backlog) {
      if (run !== recent.run || sample.at <= failedBacklogAt) continue;
      const prior = accepted.get(sample.channel);
      if (!prior || sample.at > prior.at) {
        accepted.set(sample.channel, sample);
        conflicts.delete(sample.channel);
      } else if (sample.at === prior.at && JSON.stringify(sample) !== JSON.stringify(prior)) {
        conflicts.add(sample.channel);
      }
    }
  }
  const latestTerminalAt = Math.max(-1, ...terminal.map(sample => sample.at));
  const recentTerminal = terminal.filter(sample => sample.at === latestTerminalAt);
  const terminalSample = recentTerminal[0];
  const unambiguous = terminalSample && recentTerminal.every(sample => JSON.stringify(sample) === JSON.stringify(terminalSample));
  if (conflicts.size || (terminalSample && !unambiguous)) return { backlog: [], unavailable: 'invalid-or-incomplete-source' };
  if (!unambiguous) return { backlog: [...accepted.values()] };
  const { run, ...recovery } = terminalSample;
  return { backlog: [...accepted.values()], ...(recent && { backlogRun: fingerprint(recent.run) }),
    recovery, recoveryRun: fingerprint(run) };
}

export async function readSls(config: ObserverConfig, kind: 'evaluations' | 'evidence', from: number, to: number): Promise<string> {
  const { binding, aliyun } = config;
  if (binding.mode !== 'live' || !aliyun || !isSecond(from) || !isSecond(to) || from >= to) throw new Error('Invalid live query boundary');
  const logstore = kind === 'evaluations' ? historyStore : runtimeStore;
  const query = kind === 'evaluations'
    ? `AlertName: "${binding.rule}"`
    : '"merchant_refund_backlog" OR "merchant_refund_recovery"';
  const body = JSON.stringify({ from, to, query, line: maxRows, offset: 0, powerSql: false });
  try {
    const result = await exec(aliyun.executable, ['sls', 'GetLogsV2', '--profile', aliyun.profile, '--project', binding.project,
      '--logstore', logstore, '--region', binding.region, '--body', body], { timeout: 25_000, maxBuffer: 2_000_000 });
    return result.stdout;
  } catch {
    throw new Error(`SLS ${kind} query unavailable`);
  }
}
