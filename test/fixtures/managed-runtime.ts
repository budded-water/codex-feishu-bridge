import { State } from '../../src/state.js';
import { acquireRoot, openRuntimeControl } from '../../src/handoff/ownership.js';
import { loadMigrationPlan } from '../../src/handoff/migration.js';
import { PilotAdmission } from '../../src/handoff/gateway.js';
import { NativeExecutions } from '../../src/handoff/native.js';
import { pilotMaintenance } from '../../src/handoff/maintenance.js';
import { join } from 'node:path';

const root = process.argv[2]!;
const plan = process.argv[3] ? loadMigrationPlan(process.argv[3]) : undefined;
const lease = await acquireRoot(root, plan ? 'pilot' : 'legacy', plan?.pilotDirectory ?? root);
const state = new State(plan ? join(plan.pilotDirectory, 'transport') : root);
const admission = plan ? new PilotAdmission(plan.pilotDirectory, plan.scope) : undefined;
const native = admission && plan ? new NativeExecutions(admission, plan.config) : undefined;
await native?.recover();
const control = await openRuntimeControl(lease, request => {
  if (admission && native) return pilotMaintenance(admission, native, state, request);
  if (request.command === 'quiesce') state.maintenance.quiesce();
  else if (request.command === 'resume') state.maintenance.resume();
  else if (request.command !== 'status') throw new Error('Unsupported fixture command');
  return state.drainStatus();
});
let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  state.close(); admission?.close(); await control.close(true); await lease.release();
};
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
console.log('READY');
