import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PilotAdmission } from '../../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../../src/handoff/native.js';
import { FakeCodex, until } from '../helpers.js';
const packet = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const admission = new PilotAdmission(packet.config.stateDirectory, packet.scope, 'workspace');
const codexes: ManagedFake[] = [];
class ManagedFake extends FakeCodex implements ManagedCodex {
  generation = randomUUID();
  async start() { this.ready = true; }
  async close() { this.exit(); }
}
const native = new NativeExecutions(admission, packet.config, () => { const c = new ManagedFake(); codexes.push(c); return c; }, packet.profiles,
  { outerDeadline: Date.now() + 600_000 });
const running = native.run(packet.permit);
for (let index = 0; index < packet.round; index++) {
  await until(() => Boolean(codexes[index]?.calls.some(c => c.method === 'turn/start')));
  const c = codexes[index]!, snapshot = await native.inspect(packet.permit.execution);
  if (index + 1 < packet.round || packet.phase === 'verifier') c.complete(String(snapshot.thread), String(snapshot.turn));
}
if (packet.phase === 'verifier') await until(() => existsSync(join(packet.profiles.fixture.projectRoot, '.ready')));
console.log('READY');
await running;
admission.close();
