import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { Config } from '../config.js';
import { CodexClient } from '../codex/client.js';
import { Bridge } from '../bridge.js';
import { State } from '../state.js';
import { ownerKey, record, type CodexPort, type IncomingMessage, type NativeControlTarget, type ControlDisposition } from '../types.js';
import { PilotAdmission } from './gateway.js';
import type { Permit, RequestRecord } from './store.js';
import { openOwnerChannel, probeOwner, requestOwner } from './owner-channel.js';
import { journalControl, journalProjection } from './journal.js';

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
        await this.inspect(execution.id);
        recovered.push({ execution: execution.id, status: 'live' });
      } catch {
        this.recoverReferences(execution.id);
        this.gateway.store.ownerUnconfirmed(execution.id);
        recovered.push({ execution: execution.id, status: 'unknown' });
      }
    }
    return recovered;
  }

  async poll(): Promise<void> {
    for (const execution of this.gateway.store.unsettled()) {
      try { this.apply(execution.id); continue; } catch { /* A running owner has no sealed checkpoint yet. */ }
      try {
        lstatSync(join(this.folder(execution.id), ownerFile));
      } catch (error) {
        // A newly granted worker may not have published its owner yet. Strict boot recovery remains explicit.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      }
      try { await this.inspect(execution.id); }
      catch { this.recoverReferences(execution.id); this.gateway.store.ownerUnconfirmed(execution.id); }
    }
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
        if (request.message.chatType === 'group' && !this.gateway.store.reference(request.execution, request.message)?.context) throw new Error('Missing retained group references');
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

  async relay(execution: string, message: IncomingMessage, target: NativeControlTarget): Promise<ControlDisposition> {
    const owner = this.owner(execution);
    const value = await requestOwner(owner.socket, owner.permit.token, execution, { op: 'control', message, target });
    if (!['dispatching', 'accepted', 'stopping', 'sent', 'rejected', 'unknown'].includes(String(value.status))) throw new Error('Invalid control outcome');
    return value.status as ControlDisposition;
  }

  async control(execution: string, message: IncomingMessage): Promise<Record<string, unknown>> {
    const snapshot = await this.inspect(execution);
    const target = { generation: snapshot.generation, thread: snapshot.thread, turn: snapshot.turn };
    if (Object.values(target).some(value => typeof value !== 'string' || !value)) throw new Error('Native control target is not ready');
    return { status: await this.relay(execution, message, target as NativeControlTarget) };
  }

  async controlResult(execution: string, message: IncomingMessage): Promise<ControlDisposition | undefined> {
    const owner = this.owner(execution);
    try {
      const value = await requestOwner(owner.socket, owner.permit.token, execution, { op: 'control-result', tenant: message.tenant, id: message.id });
      return value.status as ControlDisposition | undefined;
    } catch {
      const report = this.evidence(execution);
      if (!report.databaseHash) return 'rejected';
      return journalControl(join(this.folder(execution), 'bridge.db'), message) ?? 'rejected';
    }
  }

  async projection(execution: string) {
    const owner = this.owner(execution);
    let sealed = false;
    let checkpoint: string | null = null;
    let outcome: Record<string, unknown>;
    try { const report = this.evidence(execution); sealed = true; checkpoint = report.checkpoint; outcome = report.outcome; }
    catch { outcome = await this.inspect(execution); }
    const path = join(this.folder(execution), 'bridge.db');
    let projection;
    try { projection = journalProjection(path); }
    catch (error) { if (!outcome.task) return { sealed, checkpoint, outcome, messages: [], prompts: [] }; throw error; }
    const request = this.gateway.store.ownedRequest(owner.permit);
    const task = projection.task;
    if (!task || task.id !== outcome.task || task.owner !== ownerKey(request.message) || task.trigger !== request.message.id ||
      task.directory !== this.gateway.directory || task.thread !== outcome.thread || task.turn !== outcome.turn) throw new Error('Native projection identity changed');
    return { ...projection, sealed, checkpoint, outcome,
      messages: projection.messages.filter(row => (!row.final || sealed) &&
        (!(row.transient || row.prompt_id) || (!sealed && ['queued', 'running'].includes(String(outcome.status))))) };
  }

  async deliveryReady(execution: string, id: string): Promise<boolean> {
    const owner = this.owner(execution);
    const value = await requestOwner(owner.socket, owner.permit.token, execution, { op: 'delivery-ready', id });
    return value.ready === true;
  }

  async inspect(execution: string): Promise<Record<string, unknown>> {
    const owner = this.owner(execution);
    const snapshot = await probeOwner(owner.socket, owner.permit.token, execution);
    if (snapshot.pid !== owner.pid || snapshot.execution !== execution) throw new Error('Owner identity changed');
    if (typeof snapshot.thread === 'string' && snapshot.thread && typeof snapshot.generation === 'string' && snapshot.generation &&
      (snapshot.turn === null || typeof snapshot.turn === 'string')) this.gateway.store.nativeSnapshot(owner.permit, {
      thread: snapshot.thread, turn: snapshot.turn, generation: snapshot.generation,
    });
    return snapshot;
  }

  recoverReferences(execution: string): void {
    try {
      const owner = this.owner(execution);
      const request = this.gateway.store.ownedRequest(owner.permit);
      const task = journalProjection(join(this.folder(execution), 'bridge.db')).task;
      if (!task || task.owner !== ownerKey(request.message) || task.trigger !== request.message.id || task.directory !== this.gateway.directory || !task.thread) return;
      this.gateway.store.nativeSnapshot(owner.permit, { thread: task.thread, turn: task.turn, generation: null });
    } catch { /* Missing or conflicting journal identity cannot supply a conversation reference. */ }
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
    const channel = await openOwnerChannel(this.permit.token, this.permit.execution, async incoming => {
      if (incoming.op === 'control-result') {
        if (typeof incoming.tenant !== 'string' || typeof incoming.id !== 'string' || !this.state) throw new Error('Invalid control lookup');
        return { status: journalControl(join(this.folder, 'bridge.db'), { tenant: incoming.tenant, id: incoming.id }) };
      }
      if (incoming.op === 'delivery-ready') {
        return { ready: typeof incoming.id === 'string' && !this.stopping && Boolean(this.state?.deliveryReady(incoming.id)) };
      }
      if (incoming.op === 'control') {
        const message = record(incoming.message), target = record(incoming.target);
        if (['tenant', 'user', 'chat', 'id', 'text'].some(field => typeof message[field] !== 'string') ||
          ['generation', 'thread', 'turn'].some(field => typeof target[field] !== 'string' || !target[field]) ||
          !/^\/(?:status(?:\s|$)|stop(?:\s|$)|补充\s|批准\s|拒绝\s|回答\s)/.test(String(message.text).trimStart()) || !this.bridge || !this.state || this.stopping) throw new Error('Invalid live control');
        const control = message as unknown as IncomingMessage;
        const nativeTarget = target as unknown as NativeControlTarget;
        const saved = this.state.beginRelayedControl(control, nativeTarget);
        if (!saved.fresh) return { status: saved.status };
        const status = await this.bridge.relayControl(control, nativeTarget);
        this.state.relayedControlResult(control, status);
        return { status };
      }
      if (incoming.op !== undefined || incoming.message !== undefined) throw new Error('Unrecognized owner operation');
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
        projects: { [this.gateway.scope.pilot]: this.gateway.directory }, projectRouting: this.config.projectRouting === 'workspace' ? 'workspace' : 'manual' };
      const session = this.state.select(this.request.message, this.gateway.scope.pilot, this.gateway.directory);
      const thread = this.gateway.store.conversationThread(this.request.conversation);
      if (thread) this.state.setThread(session.id, thread);
      this.bridge = new Bridge(config, this.state, this.codex, {
        context: async (session, source) => {
          const saved = this.gateway.store.reference(this.permit.execution, { tenant: session.tenant, id: source.id });
          if (!saved?.context) throw new Error('Missing retained group references');
          return saved.context;
        },
      });
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
        await channel.close();
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
