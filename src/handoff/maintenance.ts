import type { State } from '../state.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';

export async function pilotMaintenance(admission: PilotAdmission, native: NativeExecutions, transport: State, request: Record<string, unknown>) {
  if (request.command === 'quiesce') admission.store.maintenance.quiesce();
  else if (request.command === 'resume') admission.store.maintenance.resume();
  else if (request.command === 'reconcile') {
    if (typeof request.task !== 'string' || typeof request.nonce !== 'string' || typeof request.reference !== 'string' ||
      !request.reference.trim() || request.reference.length > 2000) throw new Error('Recovery requires an execution and inspection reference');
    const execution = admission.store.execution(request.task);
    if (!execution || execution.project !== admission.project || execution.status !== 'unknown') throw new Error('Unknown uncertain pilot execution');
    let live = false;
    try { await native.inspect(execution.id); live = true; } catch { /* The operator must separately inspect native processes and effects. */ }
    if (live) throw new Error('Native owner is still reachable');
    native.recoverReferences(execution.id);
    admission.store.reconcileLocal(request.nonce, execution.id, request.reference);
  } else if (request.command !== 'status') throw new Error('Unsupported pilot maintenance operation');
  const delivery = transport.drainStatus();
  return { ...admission.store.drainStatus(), outbox: delivery.outbox, reactions: delivery.reactions, prompts: delivery.prompts,
    uncertain: admission.store.unsettled().filter(execution => execution.status === 'unknown').map(execution => execution.id) };
}
