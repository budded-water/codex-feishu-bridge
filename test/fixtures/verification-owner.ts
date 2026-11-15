import { readFileSync } from 'node:fs';
import { PilotAdmission } from '../../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../../src/handoff/native.js';
import { FakeCodex, until } from '../helpers.js';
const packet = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const admission = new PilotAdmission(packet.config.stateDirectory, packet.scope, 'workspace');
class ManagedFake extends FakeCodex implements ManagedCodex {
  async start() { this.ready = true; }
  async close() { this.exit(); }
}
const codex = new ManagedFake();
const runtime = new NativeExecutions(admission, packet.config, () => codex, packet.profiles);
const running = runtime.run(packet.permit);
await until(() => codex.calls.some(x => x.method === 'turn/start'));
codex.complete('thread-1', 'turn-2');
await running;
admission.close();
