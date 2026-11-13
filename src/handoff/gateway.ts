import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Config } from '../config.js';
import { record, type IncomingMessage } from '../types.js';
import { AdmissionStore, type Permit } from './store.js';

export const REQUEST_EVENT = 'bridge.request';
export interface PilotScope {
  installation: string;
  tenant: string;
  operator: string;
  chat: string;
  projects: Record<string, string>;
  pilot: string;
  hubInstance: string;
  source: string;
  rule: string;
  agent: string;
  agentUse: string;
}
export type Admission = { status: 'ignored' | 'rejected'; reason?: string } |
  { status: 'accepted' | 'blocked' | 'duplicate'; request: NonNullable<ReturnType<AdmissionStore['request']>> };

export class PilotAdmission {
  readonly store: AdmissionStore;
  readonly directory: string;
  readonly project: string;
  readonly scope: Readonly<PilotScope>;
  readonly stateDirectory: string;

  constructor(directory: string, scope: PilotScope, private readonly projectRouting: Config['projectRouting'] = 'manual') {
    for (const value of [scope.installation, scope.tenant, scope.operator, scope.chat, scope.pilot, scope.hubInstance, scope.source, scope.rule, scope.agent, scope.agentUse]) {
      if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Invalid pilot scope');
    }
    for (const [alias, path] of Object.entries(record(scope.projects))) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(alias) || typeof path !== 'string' || !isAbsolute(path) || !statSync(path).isDirectory()) throw new Error('Invalid project registry');
    }
    if (!Object.hasOwn(scope.projects, scope.pilot)) throw new Error('Unknown pilot project');
    this.scope = Object.freeze({ ...scope, projects: Object.freeze({ ...scope.projects }) });
    this.directory = realpathSync(scope.projects[scope.pilot]!);
    this.project = createHash('sha256').update(this.directory).digest('hex');
    const { projects: _projects, pilot: _pilot, ...binding } = this.scope;
    const fields = { ...binding, directory: this.directory };
    this.store = new AdmissionStore(directory, JSON.stringify(Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)))));
    this.stateDirectory = realpathSync(directory);
  }

  private operator(message: IncomingMessage): IncomingMessage | undefined {
    if (!message || message.tenant !== this.scope.tenant || message.user !== this.scope.operator || message.chat !== this.scope.chat) return;
    return message;
  }

  receive(inputMessage: IncomingMessage): Admission {
    const message = this.operator(inputMessage);
    if (!message || this.store.retained(message)) return { status: 'ignored' };
    if (message.unsupported || message.text.length > 30_000) return { status: 'rejected', reason: 'unsupported_input' };
    const text = message.text.trim();
    if (/^pair\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return { status: 'ignored' };
    if (text.startsWith('/')) return { status: 'rejected', reason: 'control_requires_live_gateway' };
    if (realpathSync(this.scope.projects[this.scope.pilot]!) !== this.directory) throw new Error('Pilot directory changed');
    let input = message.text;
    const prefix = /^([^\s:：]+)[:：]\s*([\s\S]+)$/.exec(text);
    if (this.projectRouting !== 'workspace' && prefix && Object.hasOwn(this.scope.projects, prefix[1]!)) {
      if (realpathSync(this.scope.projects[prefix[1]!]!) !== this.directory) return { status: 'rejected', reason: 'outside_pilot' };
      input = prefix[2]!;
    }
    const accepted = this.store.accept(message, input, this.project);
    if ('paused' in accepted) return { status: 'rejected', reason: 'maintenance' };
    return { status: accepted.duplicate ? 'duplicate' : accepted.request.blocked ? 'blocked' : 'accepted', request: accepted.request };
  }

  assignment(value: unknown) {
    const job = record(value);
    const rule = record(job.rule);
    const agent = record(job.agent);
    if (!Number.isSafeInteger(job.run) || Number(job.run) < 1 || !Number.isSafeInteger(job.attempt) || Number(job.attempt) < 1 ||
      rule.name !== this.scope.rule || agent.id !== this.scope.agent || agent.use !== this.scope.agentUse) throw new Error('Assignment does not match pilot registry');
    return this.assignmentContext(Number(job.run), rule.cwd, job.context);
  }

  assignmentContext(run: number, cwd: unknown, value: unknown) {
    const context = record(value);
    if (!Number.isSafeInteger(run) || run < 1 || cwd !== this.directory || !Array.isArray(context.events) || context.events.length !== 1 ||
      !Array.isArray(context.answers) || context.answers.length || !Array.isArray(context.timers) || context.timers.length) {
      throw new Error('Assignment does not match pilot registry');
    }
    const event = record(context.events[0]);
    if (typeof event.id !== 'string' || event.source !== this.scope.source || event.type !== REQUEST_EVENT || event.subject !== event.id) {
      throw new Error('Unrecognized assignment event');
    }
    const request = this.store.request(event.id);
    if (!request || request.project !== this.project || realpathSync(this.scope.projects[this.scope.pilot]!) !== this.directory) {
      throw new Error('Assignment has no admitted request');
    }
    return { request, run };
  }

  uncertain(permit: Permit, reason: 'owner_unreachable' | 'start_unconfirmed' | 'completion_unconfirmed' | 'cancellation_unconfirmed') {
    return this.store.uncertain(permit, reason);
  }

  terminal(permit: Permit, evidence: { status: 'completed' | 'interrupted'; processSettled: true; reference: string }) {
    if (!evidence || evidence.processSettled !== true || !['completed', 'interrupted'].includes(evidence.status) ||
      typeof evidence.reference !== 'string' || !evidence.reference.trim() || evidence.reference.length > 2000) throw new Error('Missing terminal evidence');
    return this.store.terminal(permit, evidence.status, evidence.reference);
  }

  reconcile(inputMessage: IncomingMessage, decision: { execution: string; processSettled: true; effectsChecked: true; reference: string }): void {
    const message = this.operator(inputMessage);
    if (!message || message.unsupported || message.text.trim() !== '/reconcile ' + decision.execution ||
      decision.processSettled !== true || decision.effectsChecked !== true || typeof decision.reference !== 'string' ||
      !decision.reference.trim() || decision.reference.length > 2000) throw new Error('Recovery requires a scoped operator decision and evidence');
    const execution = this.store.execution(decision.execution);
    if (!execution || execution.project !== this.project) throw new Error('Unknown pilot execution');
    this.store.reconcile(message, execution.id, decision.reference);
  }

  close(): void { this.store.close(); }
}
