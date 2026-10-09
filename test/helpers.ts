import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { State } from '../src/state.js';
import { Bridge } from '../src/bridge.js';
import type { Config } from '../src/config.js';
import { record, type CodexPort, type IncomingMessage, type ContextPort, type RpcEvent, type RpcRequest } from '../src/types.js';

export class FakeCodex implements CodexPort {
  generation = 'generation-1';
  ready = true;
  calls: { method: string; params: Record<string, unknown> }[] = [];
  replies: { id: string | number; result: unknown }[] = [];
  rejected: (string | number)[] = [];
  rejectedMessages: string[] = [];
  private events = new EventEmitter();
  private sequence = 0;

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const body = record(params);
    this.calls.push({ method, params: body });
    if (method === 'thread/start') return { thread: { id: `thread-${++this.sequence}` } } as T;
    if (method === 'thread/resume') return { thread: { id: body.threadId } } as T;
    if (method === 'turn/start') {
      const turn = { id: `turn-${++this.sequence}`, status: 'inProgress' };
      this.notify('turn/started', { threadId: body.threadId, turn });
      return { turn } as T;
    }
    if (method === 'turn/interrupt') {
      this.complete(String(body.threadId), String(body.turnId), 'interrupted');
    }
    return {} as T;
  }

  notify(method: string, params: Record<string, unknown>): void { this.events.emit('notification', { method, params }); }
  ask(id: string | number, method: string, params: Record<string, unknown>): void { this.events.emit('request', { id, method, params }); }
  complete(thread: string, turn: string, status = 'completed', text = 'Done'): void {
    this.notify('item/completed', { threadId: thread, turnId: turn, item: { type: 'agentMessage', id: 'answer', phase: 'final_answer', text } });
    this.notify('turn/completed', { threadId: thread, turn: { id: turn, status } });
  }
  exit(): void { this.ready = false; this.events.emit('exit'); }
  reply(id: string | number, result: unknown): void { this.replies.push({ id, result }); }
  reject(id: string | number, message = ''): void { this.rejected.push(id); this.rejectedMessages.push(message); }
  private listen<T>(name: string, listener: (event: T) => void): () => void {
    this.events.on(name, listener);
    return () => { this.events.off(name, listener); };
  }
  onNotification(listener: (event: RpcEvent) => void): () => void { return this.listen('notification', listener); }
  onRequest(listener: (event: RpcRequest) => void): () => void { return this.listen('request', listener); }
  onExit(listener: () => void): () => void { return this.listen('exit', listener); }
}

export function message(text: string, overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return { tenant: 'tenant', user: 'ou_owner', chat: 'chat', id: randomUUID(), text, ...overrides };
}

export async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition did not become true');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

export function setup(contextPort?: ContextPort) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'codex-bridge-test-')));
  const alpha = join(directory, 'alpha');
  const beta = join(directory, 'beta');
  mkdirSync(alpha);
  mkdirSync(beta);
  const config: Config = {
    allowedUsers: ['ou_owner'], accessMode: 'allowlist', allowedTenant: null, enableGroups: false, groupContextMessages: 0, groupContextImages: 0, approvalUsers: ['ou_owner'], approvalChat: null, codexExecutable: 'codex', stateDirectory: join(directory, 'state'),
    approvalTimeoutSeconds: 300, projects: { alpha, beta }, projectRouting: 'manual',
  };
  const state = new State(config.stateDirectory);
  const codex = new FakeCodex();
  const bridge = new Bridge(config, state, codex, contextPort);
  bridge.receive(message('/project alpha'));
  const session = state.selected(message(''))!;
  const turns = () => codex.calls.filter(call => call.method === 'turn/start');
  const current = () => {
    const turn = turns().at(-1)!;
    const id = codex.calls.filter(call => call.method === 'turn/start').length;
    const starts = codex.calls.filter(call => call.method === 'thread/start').length;
    return { threadId: String(turn.params.threadId), turnId: `turn-${starts + id}` };
  };
  const deliveries = (): string[] => {
    const result: string[] = [];
    for (;;) {
      const pending = state.pending(Number.MAX_SAFE_INTEGER);
      if (!pending.length) break;
      for (const delivery of pending) { result.push(delivery.body); state.delivered(delivery.id); }
    }
    return result;
  };
  const close = async () => { await bridge.close(); state.close(); rmSync(directory, { recursive: true, force: true }); };
  return { directory, config, state, codex, bridge, session, turns, current, deliveries, close };
}
