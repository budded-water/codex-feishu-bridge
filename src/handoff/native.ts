import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { Config } from '../config.js';
import { CodexClient } from '../codex/client.js';
import { Bridge } from '../bridge.js';
import { State } from '../state.js';
import { ownerKey, record, type CodexPort, type IncomingMessage } from '../types.js';
import { PilotAdmission } from './gateway.js';
import type { Permit, RequestRecord } from './store.js';
import { openOwnerChannel, probeOwner } from './owner-channel.js';

export interface ManagedCodex extends CodexPort {
  start(): Promise<void>;
  close(): Promise<void>;
}
type Outcome = { task: string | null; thread: string | null; turn: string | null; status: string; generation: string };
export type NativeReport = {
  version: 1; binding: string; permit: Permit; outcome: Outcome;
  childSettled: true; databaseHash: string | null; checkpoint: string;
};
type Owner = { version: 1; binding: string; permit: Permit; socket: string; pid: number };
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const ownerFile = 'native-owner.json';
const resultFile = 'native-result.json';

function privateFolder(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (lstatSync(path).isSymbolicLink()) throw new Error('Execution directory must be private');
  chmodSync(path, 0o700);
}

function readRecord(path: string): Record<string, unknown> {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new Error('Invalid native evidence file');
  return record(JSON.parse(readFileSync(path, 'utf8')));
}

function publish(path: string, value: unknown): void {
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

function binding(gateway: PilotAdmission, request: RequestRecord): string {
  return hash(JSON.stringify({ execution: request.execution, request: request.id, conversation: request.conversation,
    project: request.project, directory: gateway.directory, owner: ownerKey(request.message), message: request.message.id, input: hash(request.input) }));
}

export class NativeExecutions {
  private root: string;
  private active?: NativeOwner;
  private stopping = false;

  constructor(private gateway: PilotAdmission, private config: Config, private createCodex?: () => ManagedCodex) {
    if ((config.allowedTenant && config.allowedTenant !== gateway.scope.tenant) ||
      (config.accessMode === 'allowlist' && !config.allowedUsers.includes(gateway.scope.operator)) ||
      config.projects[gateway.scope.pilot] !== gateway.directory) throw new Error('Native configuration does not admit the pilot');
    this.root = join(gateway.stateDirectory, 'executions');
    privateFolder(this.root);
  }

  private folder(execution: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(execution)) throw new Error('Invalid execution identity');
    return join(this.root, execution);
  }

  private owner(execution: string): Owner {
    const folder = this.folder(execution);
    if (lstatSync(folder).isSymbolicLink()) throw new Error('Invalid execution directory');
    const value = readRecord(join(folder, ownerFile));
    const permit = record(value.permit);
    if (value.version !== 1 || permit.execution !== execution || typeof permit.token !== 'string' || typeof value.socket !== 'string' ||
      !Number.isSafeInteger(value.pid) || typeof value.binding !== 'string') throw new Error('Invalid native owner');
    const request = this.gateway.store.ownedRequest(permit as Permit);
    if (binding(this.gateway, request) !== value.binding) throw new Error('Native owner binding changed');
    return value as unknown as Owner;
  }

  evidence(execution: string): NativeReport {
    const owner = this.owner(execution);
    const value = readRecord(join(this.folder(execution), resultFile));
    const permit = record(value.permit);
    const outcome = record(value.outcome);
    if (value.version !== 1 || value.binding !== owner.binding || permit.execution !== execution || permit.token !== owner.permit.token ||
      value.childSettled !== true || typeof value.checkpoint !== 'string' || typeof outcome.status !== 'string' ||
      typeof outcome.generation !== 'string' || !['completed', 'interrupted', 'unknown'].includes(outcome.status) ||
      ![outcome.task, outcome.thread, outcome.turn].every(item => item === null || typeof item === 'string') ||
      (outcome.status === 'completed' && (!outcome.thread || !outcome.turn || !outcome.generation))) throw new Error('Invalid native terminal evidence');
    const database = join(this.folder(execution), 'bridge.db');
    if (value.databaseHash !== null) {
      if (typeof value.databaseHash !== 'string' || lstatSync(database).isSymbolicLink() || hash(readFileSync(database)) !== value.databaseHash) throw new Error('Native journal evidence changed');
    } else if (outcome.task !== null || outcome.status !== 'interrupted') throw new Error('Missing native journal evidence');
    return value as unknown as NativeReport;
  }

  apply(execution: string): NativeReport {
    const report = this.evidence(execution);
    const reference = 'native-checkpoint/' + report.checkpoint;
    if (report.outcome.thread) this.gateway.store.nativeSnapshot(report.permit, {
      thread: report.outcome.thread, turn: report.outcome.turn, generation: report.outcome.generation,
    });
    if (report.outcome.status === 'completed' || report.outcome.status === 'interrupted') {
      this.gateway.terminal(report.permit, { status: report.outcome.status, processSettled: true, reference });
    } else this.gateway.uncertain(report.permit, 'completion_unconfirmed');
    return report;
  }

  async recover(): Promise<{ execution: string; status: 'settled' | 'live' | 'unknown' }[]> {
    const recovered: { execution: string; status: 'settled' | 'live' | 'unknown' }[] = [];
    for (const execution of this.gateway.store.unsettled()) {
      try {
        const report = this.apply(execution.id);
        recovered.push({ execution: execution.id, status: report.outcome.status === 'unknown' ? 'unknown' : 'settled' });
        continue;
      } catch { /* A live owner may still be producing its checkpoint. */ }
      try {
        const owner = this.owner(execution.id);
        const snapshot = await probeOwner(owner.socket, owner.permit.token, execution.id);
        if (snapshot.pid !== owner.pid || snapshot.execution !== execution.id) throw new Error('Owner identity changed');
        recovered.push({ execution: execution.id, status: 'live' });
      } catch {
        this.gateway.store.ownerUnconfirmed(execution.id);
        recovered.push({ execution: execution.id, status: 'unknown' });
      }
    }
    return recovered;
  }

  async run(permit: Permit): Promise<NativeReport> {
    if (this.active) throw new Error('Native executor already owns a task');
    const request = this.gateway.store.ownedRequest(permit);
    const folder = this.folder(request.execution);
    privateFolder(folder);
    const release = await lockfile.lock(folder, { retries: 0, stale: 10_000 });
    try {
      try {
        lstatSync(join(folder, ownerFile));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        this.gateway.store.startableRequest(permit);
        if (request.message.chatType === 'group' && !this.config.enableGroups) throw new Error('Native configuration does not admit the pilot chat');
        const codex = this.createCodex?.() ?? new CodexClient(this.config.codexExecutable, [], 30_000, this.config.codexReasoningEffort);
        this.active = new NativeOwner(this.gateway, this.config, request, permit, folder, codex);
        if (this.stopping) await this.active.stop();
        try { await this.active.run(); }
        catch (failure) {
          try { return this.apply(permit.execution); }
          catch { this.gateway.store.ownerUnconfirmed(permit.execution); throw failure; }
        }
        return this.apply(permit.execution);
      }
      return this.apply(permit.execution);
    } finally {
      this.active = undefined;
      await release();
    }
  }

  async control(execution: string, message: IncomingMessage): Promise<Record<string, unknown>> {
    const owner = this.owner(execution);
    return probeOwner(owner.socket, owner.permit.token, execution, message);
  }

  async inspect(execution: string): Promise<Record<string, unknown>> {
    const owner = this.owner(execution);
    return probeOwner(owner.socket, owner.permit.token, execution);
  }

  stop(): Promise<void> { this.stopping = true; return this.active?.stop() ?? Promise.resolve(); }
}

class NativeOwner {
  private state?: State;
  private bridge?: Bridge;
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private closing?: Promise<void>;
  private outcome: Outcome;

  constructor(private gateway: PilotAdmission, private config: Config, private request: RequestRecord,
    private permit: Permit, private folder: string, private codex: ManagedCodex) {
    this.outcome = { task: null, thread: null, turn: null, status: 'interrupted', generation: '' };
  }

  private snapshot() {
    const current = this.state?.executionForTrigger(this.request.message.id, ownerKey(this.request.message));
    if (current) this.outcome = { task: current.id, thread: current.thread, turn: current.turn, status: current.status, generation: this.codex.generation };
    return { execution: this.permit.execution, pid: process.pid, ...this.outcome,
      messages: this.state?.pending().filter(row => this.state!.deliveryReady(row.id)).slice(0, 4)
        .map(row => ({ id: row.id, chat: row.chat, body: row.body.slice(0, 2000), truncated: row.body.length > 2000 })) ?? [] };
  }

  async run(): Promise<void> {
    const channel = await openOwnerChannel(this.permit.token, this.permit.execution, incoming => {
      if (incoming.message !== undefined) {
        const message = record(incoming.message);
        if (['tenant', 'user', 'chat', 'id', 'text'].some(field => typeof message[field] !== 'string') ||
          !/^\/(?:status(?:\s|$)|stop(?:\s|$)|补充\s|批准\s|拒绝\s|回答\s)/.test(String(message.text)) || !this.bridge || this.stopping) throw new Error('Invalid live control');
        this.bridge.receive(message as unknown as IncomingMessage);
      }
      return this.snapshot();
    });
    const marker: Owner = { version: 1, binding: binding(this.gateway, this.request), permit: this.permit, socket: channel.path, pid: process.pid };
    try {
      writeFileSync(join(this.folder, ownerFile), JSON.stringify(marker), { mode: 0o600, flag: 'wx' });
      if (this.stopping) return;
      this.gateway.store.startableRequest(this.permit);
      await this.codex.start();
      if (this.stopping) return;
      this.gateway.store.startableRequest(this.permit);
      this.state = new State(this.folder);
      const config: Config = { ...this.config, allowedTenant: this.gateway.scope.tenant, stateDirectory: this.folder,
        projects: { [this.gateway.scope.pilot]: this.gateway.directory }, projectRouting: 'manual' };
      const session = this.state.select(this.request.message, this.gateway.scope.pilot, this.gateway.directory);
      const thread = this.gateway.store.conversationThread(this.request.conversation);
      if (thread) this.state.setThread(session.id, thread);
      this.bridge = new Bridge(config, this.state, this.codex);
      this.state.transaction(() => {
        if (!this.state!.remember(this.request.message)) throw new Error('Assigned request already exists');
        const { id, chatType, createTime, parentId } = this.request.message;
        this.state!.enqueue(session.id, this.request.input, { id, chatType, createTime, parentId }, undefined, undefined, true);
      });
      const settled = new Promise<void>(resolve => {
        this.timer = setInterval(() => {
          this.snapshot();
          if (!['queued', 'running'].includes(this.outcome.status)) resolve();
        }, 10);
      });
      this.bridge.kick();
      await settled;
    } finally {
      try {
        clearInterval(this.timer);
        await this.close();
        this.snapshot();
        const hasJournal = Boolean(this.state);
        this.state?.close(); this.state = undefined;
        const outcome = { ...this.outcome, generation: this.codex.generation };
        if (!['completed', 'interrupted'].includes(outcome.status)) outcome.status = 'unknown';
        const report: NativeReport = { version: 1, binding: marker.binding, permit: this.permit, outcome, childSettled: true,
          databaseHash: hasJournal ? hash(readFileSync(join(this.folder, 'bridge.db'))) : null, checkpoint: randomUUID() };
        publish(join(this.folder, resultFile), report);
      } finally { await channel.close(); }
    }
  }

  private close(): Promise<void> {
    return this.closing ??= (async () => { await this.bridge?.close(); await this.codex.close(); })();
  }

  stop(): Promise<void> { this.stopping = true; return this.close(); }
}
