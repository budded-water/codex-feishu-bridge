import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { record, type CodexPort, type RpcEvent, type RpcRequest } from '../types.js';
import type { InitializeParams } from './generated/InitializeParams.js';
import type { Config } from '../config.js';
import { CODEX_VERSION } from './generated/version.js';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export async function checkVersion(executable: string, prefix: string[] = []): Promise<void> {
  const { stdout } = await promisify(execFile)(executable, [...prefix, '--version'], { timeout: 10_000 });
  if (stdout.trim() !== `codex-cli ${CODEX_VERSION}`) {
    throw new Error(`Bridge protocol requires Codex ${CODEX_VERSION}; regenerate and validate bindings before upgrading`);
  }
}

export class CodexClient implements CodexPort {
  generation = '';
  ready = false;
  private child?: ChildProcessWithoutNullStreams;
  private lines?: Interface;
  private events = new EventEmitter();
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private inbound = new Set<string | number>();
  private closed = true;
  private lifecycle = 0;
  private executable: string;
  private prefix: string[];
  private timeout: number;
  private reasoningEffort: Config['codexReasoningEffort'];

  constructor(executable = 'codex', prefix: string[] = [], timeout = 30_000, reasoningEffort: Config['codexReasoningEffort'] = null) {
    this.executable = executable;
    this.prefix = prefix;
    this.timeout = timeout;
    this.reasoningEffort = reasoningEffort;
  }

  async start(): Promise<void> {
    if (this.child && !this.closed) throw new Error('Codex process is already running');
    const lifecycle = ++this.lifecycle;
    await checkVersion(this.executable, this.prefix);
    if (lifecycle !== this.lifecycle) throw new Error('Codex startup was interrupted');
    this.generation = randomUUID();
    const env = { ...process.env };
    // The local agent does not need the chat gateway credentials.
    delete env.FEISHU_APP_ID;
    delete env.FEISHU_APP_SECRET;
    this.closed = false;
    const child = spawn(this.executable, [...this.prefix, 'app-server', '--listen', 'stdio://'], {
      env, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    this.child = child;
    // Drain stderr without publishing raw logs, environment details, or tokens.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => this.fail(child));
    child.on('error', () => this.fail(child));
    child.on('exit', () => this.fail(child));
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => {
      if (this.closed || this.child !== child) return;
      try { this.receive(JSON.parse(line) as unknown); }
      catch { this.fail(child); child.kill(); }
    });
    const params: InitializeParams = {
      clientInfo: { name: 'codex_feishu_bridge', title: 'Codex Feishu Bridge', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    };
    try {
      await this.request('initialize', params);
      this.write({ method: 'initialized' });
      this.ready = true;
    } catch (error) {
      this.fail(child);
      child.kill();
      throw error;
    }
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Codex is unavailable'));
    // Apply the deployment setting to every new turn, including resumed and routing threads.
    if (method === 'turn/start' && this.reasoningEffort != null) params = { ...record(params), effort: this.reasoningEffort };
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Codex request timed out: ${method}; execution outcome may be unknown`));
        const child = this.child;
        if (child) { this.fail(child); child.kill(); }
      }, method === 'initialize' ? Math.max(this.timeout, 10_000) : this.timeout);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.write({ id, method, params }); }
      catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Codex transport write failed'));
      }
    });
  }

  reply(id: string | number, result: unknown): void {
    if (!this.inbound.delete(id)) return;
    this.write({ id, result });
  }

  reject(id: string | number, message: string): void {
    if (!this.inbound.delete(id)) return;
    this.write({ id, error: { code: -32601, message } });
  }

  private write(message: unknown): void {
    if (this.closed || !this.child?.stdin.writable) throw new Error('Codex is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(value: unknown): void {
    const message = record(value);
    if (typeof message.method === 'string') {
      const params = record(message.params);
      if (typeof message.id === 'string' || typeof message.id === 'number') {
        if (this.inbound.has(message.id)) return;
        this.inbound.add(message.id);
        this.events.emit('request', { id: message.id, method: message.method, params } satisfies RpcRequest);
      } else {
        if (message.method === 'serverRequest/resolved' && (typeof params.requestId === 'string' || typeof params.requestId === 'number')) {
          this.inbound.delete(params.requestId);
        }
        this.events.emit('notification', { method: message.method, params } satisfies RpcEvent);
      }
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if ('error' in message) pending.reject(new Error('Codex rejected the request; see /status or start a new session'));
    else if ('result' in message) pending.resolve(message.result);
    else pending.reject(new Error('Malformed Codex response'));
  }

  private fail(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child || this.closed) return;
    this.closed = true;
    this.ready = false;
    this.lines?.close();
    this.inbound.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Codex process stopped; task outcome may be unknown'));
    }
    this.pending.clear();
    this.events.emit('exit');
  }

  private subscribe<T>(event: string, listener: (value: T) => void): () => void {
    this.events.on(event, listener);
    return () => { this.events.off(event, listener); };
  }
  onNotification(listener: (event: RpcEvent) => void): () => void { return this.subscribe('notification', listener); }
  onRequest(listener: (event: RpcRequest) => void): () => void { return this.subscribe('request', listener); }
  onExit(listener: () => void): () => void { return this.subscribe('exit', listener); }

  async close(): Promise<void> {
    // Also cancel starts still waiting for their executable version check.
    this.lifecycle++;
    const child = this.child;
    if (!child) return;
    this.fail(child);
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
      child.kill('SIGTERM');
    });
  }
}
