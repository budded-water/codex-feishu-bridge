// P0 fixture integration only. This is not a production ingress or a replacement queue.
import { Bridge } from '../bridge.js';
import { State } from '../state.js';
import type { Config } from '../config.js';
import { ownerKey, type CodexPort, type IncomingMessage } from '../types.js';
import { executionReceipt as probeReceipt } from '../handoff/receipt.js';
export { executionReceipt as probeReceipt } from '../handoff/receipt.js';

export const PROBE_ACTOR = { tenant: 'probe-tenant', user: 'probe-owner', chat: 'probe-chat', id: 'fixture-owner', text: '' };
export const PROBE_ADMIN = { tenant: 'probe-tenant', user: 'probe-admin', chat: 'probe-admin-chat', id: 'fixture-admin', text: '' };
export type ProbeOutcome = {
  task: string | null;
  thread: string | null;
  turn: string | null;
  status: string;
  receipt: string;
};

export class AutoloopExecutionProbe {
  private bridge: Bridge;
  private timer?: NodeJS.Timeout;
  private pending?: { resolve: (outcome: ProbeOutcome) => void };
  private closed = false;
  private closing?: Promise<void>;

  constructor(
    private state: State,
    codex: CodexPort,
    private assignment: string,
    private directory: string,
    approvalTimeoutSeconds = 300,
  ) {
    const config: Config = {
      allowedUsers: [PROBE_ACTOR.user, PROBE_ADMIN.user], accessMode: 'allowlist',
      allowedTenant: PROBE_ACTOR.tenant, enableGroups: false,
      groupContextMessages: 0, groupContextImages: 0,
      approvalUsers: [PROBE_ADMIN.user], approvalChat: PROBE_ADMIN.chat,
      codexExecutable: 'codex', stateDirectory: directory, approvalTimeoutSeconds,
      projects: { probe: directory }, projectRouting: 'manual',
    };
    state.select(PROBE_ACTOR, 'probe', directory);
    this.bridge = new Bridge(config, state, codex);
  }

  existing(): ProbeOutcome | undefined {
    const found = this.state.executionForTrigger(this.assignment, ownerKey(PROBE_ACTOR));
    if (!found) return;
    if (found.directory !== this.directory) throw new Error('Probe execution belongs to another workspace');
    return { task: found.id, thread: found.thread, turn: found.turn, status: found.status, receipt: probeReceipt(found.status) };
  }

  async run(prompt: string, resume: string | null): Promise<ProbeOutcome> {
    if (this.closed || this.pending) throw new Error('Probe is closed or already running');
    const previous = this.existing();
    if (previous) return previous; // Reattach/report, never enqueue the same assignment twice.
    const session = this.state.selected(PROBE_ACTOR)!;
    if (resume) this.state.setThread(session.id, resume);
    return new Promise(resolve => {
      this.pending = { resolve };
      this.timer = setInterval(() => this.settle(), 10);
      // A scheduler prompt is task data, even if its first line resembles a chat command.
      this.bridge.receive({ ...PROBE_ACTOR, id: this.assignment, text: 'Autoloop fixture assignment:\n\n' + prompt });
      this.settle();
    });
  }

  control(message: IncomingMessage): void {
    if (this.closed) throw new Error('Probe is closed');
    // This fixture endpoint cannot submit another task or change registered projects.
    if (!/^\/(?:status(?:\s|$)|stop(?:\s|$)|补充\s|批准\s|拒绝\s|回答\s)/.test(message.text)) {
      throw new Error('Only live controls are supported by the probe');
    }
    this.bridge.receive(message);
  }

  messages() {
    // A fixture-only in-memory transport drains ordered deliveries; no platform SDK is started.
    const messages: { chat: string; body: string; final: boolean }[] = [];
    for (;;) {
      const ready = this.state.pending().filter(row => this.state.deliveryReady(row.id));
      if (!ready.length) break;
      for (const row of ready) {
        messages.push({ chat: row.chat, body: row.body, final: Boolean(row.final) });
        this.state.delivered(row.id);
      }
    }
    return messages;
  }

  private settle(): void {
    if (!this.pending) return;
    const outcome = this.existing();
    if (!outcome || outcome.status === 'running' || outcome.status === 'queued') return;
    clearInterval(this.timer);
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(outcome);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    return this.closing = this.bridge.close().then(() => {
      this.settle();
      clearInterval(this.timer);
    });
  }
}
