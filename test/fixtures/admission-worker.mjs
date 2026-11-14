import { parentPort, workerData } from 'node:worker_threads';
import { PilotAdmission } from '../../src/handoff/gateway.ts';

const gateway = new PilotAdmission(workerData.state, workerData.scope);
parentPort.postMessage({ ready: true });
Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
try {
  if (workerData.withdraw) {
    try { gateway.store.withdraw(workerData.withdraw, workerData.execution, gateway.project); parentPort.postMessage({ kind: 'withdrawn' }); }
    catch { parentPort.postMessage({ kind: 'refused' }); }
  } else parentPort.postMessage(gateway.store.reserve(workerData.request, workerData.run));
}
finally { gateway.close(); }
