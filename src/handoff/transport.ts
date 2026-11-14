import { join } from 'node:path';
import { State } from '../state.js';
import { Outbox, type Sender } from '../outbox.js';
import { Feedback, type ReactionPort } from '../feedback.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import { OWNER_WITHDRAWN, type RequestRecord } from './store.js';

// Transport projections use State's delivery contracts, never its execution queue.
export class HandoffTransport {
  readonly state: State;
  private outbox: Outbox;
  private feedback: Feedback;

  constructor(private gateway: PilotAdmission, private native: NativeExecutions, sender: Sender, reactions: ReactionPort, secrets: string[] = []) {
    this.state = new State(join(gateway.stateDirectory, 'transport'), secrets);
    this.outbox = new Outbox(this.state, sender, secrets, async delivery => {
      const source = this.state.projectedDelivery(delivery.id);
      if (!source || !source.live) return true;
      try { return await native.deliveryReady(source.execution, delivery.id); }
      catch { return false; }
    });
    this.feedback = new Feedback(this.state, reactions);
  }

  admit(request: RequestRecord): void {
    const execution = this.gateway.store.execution(request.execution);
    const withdrawn = request.blocked === OWNER_WITHDRAWN;
    const unscheduled = this.gateway.store.submission(request.id)?.status === 'blocked';
    this.state.projectAssignedTask(request, this.gateway.scope.pilot, this.gateway.directory,
      withdrawn ? 'interrupted' : request.blocked || unscheduled ? 'unknown' : execution?.status === 'active' ? 'running' : execution?.status ?? 'queued');
    if (unscheduled && !withdrawn) this.state.projectAdmissionNotice(request, '请求已保存，但没有进入预期的调度规则，当前没有开始执行。请部署者检查路由配置；不会换一个编号自动重发。');
  }

  async sync(): Promise<void> {
    for (const request of this.gateway.store.requests()) {
      this.admit(request);
      const execution = this.gateway.store.execution(request.execution);
      if (!execution) continue;
      if (this.state.projectedFinal(request.execution)) {
        if (['completed', 'interrupted'].includes(execution.status)) this.gateway.store.retireReferences(request.execution);
        continue;
      }
      try {
        const projection = await this.native.projection(request.execution);
        this.state.projectAssignedTask(request, this.gateway.scope.pilot, this.gateway.directory,
          projection.sealed ? String(projection.outcome.status) : this.gateway.store.execution(request.execution)!.status === 'unknown' ? 'unknown' : 'running');
        this.state.projectNativeMessages(request, projection);
        if (projection.sealed && ['completed', 'interrupted'].includes(String(projection.outcome.status))) this.gateway.store.retireReferences(request.execution);
        if (projection.sealed && !projection.task) this.state.projectAdmissionNotice(request, '任务在开始执行前已取消，没有启动模型任务。');
      } catch {
        if (this.gateway.store.execution(request.execution)?.status === 'unknown') this.state.projectAdmissionNotice(request, '本机执行器当前无法核实，任务结果尚未确认。请先检查实际结果；不会自动重跑。');
        // Missing ownership cannot authorize prompt delivery or fabricate a final answer.
      }
    }
  }

  async flush(): Promise<void> { await Promise.all([this.outbox.flush(), this.feedback.flush()]); }
  async close(): Promise<void> { await this.outbox.close(); await this.feedback.close(); this.state.close(); }
}
