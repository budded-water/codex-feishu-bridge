import { State } from '../../src/state.js';
import { acquireRoot, openRuntimeControl } from '../../src/handoff/ownership.js';

const root = process.argv[2]!;
const lease = await acquireRoot(root, 'legacy', root);
const state = new State(root);
const control = await openRuntimeControl(lease, request => {
  if (request.command === 'quiesce') state.maintenance.quiesce();
  else if (request.command === 'resume') state.maintenance.resume();
  else if (request.command !== 'status') throw new Error('Unsupported fixture command');
  return state.drainStatus();
});
let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  state.close(); await control.close(true); await lease.release();
};
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
console.log('READY');
