import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PilotAdmission } from '../../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../../src/handoff/native.js';
import { FakeCodex, until } from '../helpers.js';

const { config, scope, directory, permit } = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const admission = new PilotAdmission(directory, scope);
class ManagedFake extends FakeCodex implements ManagedCodex {
  async start() { this.generation = randomUUID(); }
  async close() { this.exit(); }
}
const codex = new ManagedFake();
const native = new NativeExecutions(admission, config, () => codex);
const running = native.run(permit);
await until(() => codex.calls.some(call => call.method === 'turn/start'));
console.log('READY');
await running;
