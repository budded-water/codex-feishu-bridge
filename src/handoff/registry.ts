import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { record } from '../types.js';
import type { PilotAdmission } from './gateway.js';

export function validateNativeRegistry(gateway: PilotAdmission, value: unknown): void {
  const rules = record(value);
  const agent = record(record(rules.agents)[gateway.scope.agent]);
  if (agent.use !== gateway.scope.agentUse || typeof agent.worker !== 'string' || !Array.isArray(rules.rules)) throw new Error('Native agent registry changed');
  const entries = rules.rules.map(record);
  const matching = entries.filter(rule => rule.name === gateway.scope.rule);
  if (matching.length !== 1) throw new Error('Native rule registry changed');
  const nativeRule = matching[0]!;
  const canonical = (cwd: unknown) => {
    if (typeof cwd !== 'string') throw new Error('Invalid rule directory');
    return realpathSync(cwd.startsWith('~/') ? join(homedir(), cwd.slice(2)) : cwd);
  };
  if (nativeRule.to !== gateway.scope.agent || canonical(nativeRule.cwd) !== gateway.directory ||
    record(nativeRule.when).source !== gateway.scope.source || nativeRule.resume !== false || nativeRule.parallel !== 1) throw new Error('Native rule scope changed');
  const group = nativeRule.group ?? nativeRule.name;
  for (const rule of entries) {
    if (canonical(rule.cwd) !== gateway.directory) continue;
    if ((rule.group ?? rule.name) !== group || rule.parallel !== 1 || rule.to !== gateway.scope.agent) throw new Error('Project aliases split execution authority');
  }
}
