import test from 'node:test';
import assert from 'node:assert/strict';
import { Feishu } from '../src/feishu.js';
import { verificationText } from '../src/handoff/verification-view.js';
import type { VerificationRecord } from '../src/handoff/store.js';
import { copyBlock } from '../src/presentation.js';
import { setup, message, until } from './helpers.js';

function observation(): VerificationRecord {
  return {
    execution: '11111111-1111-4111-8111-111111111111', profile: 'fixture', digest: '0'.repeat(64), phase: 'observed',
    definition: { projectRoot: '/candidate', projectId: 'web', suite: 'smoke', engineRoot: '/engine', engineRevision: '0'.repeat(40),
      cliHash: '0'.repeat(64), libraryHash: '0'.repeat(64), timeoutMs: 1000, policyFiles: {} },
    observation: { status: 'pass', cleanupSettled: true, code: 0, signal: null, reason: 'Observed pinned CLI handoff', observedAt: 1000,
      integration: { id: '22222222-2222-4222-8222-222222222222', source: null, sourceDigest: null, suiteDigest: 'digest',
        summaryPath: '/candidate/.ui-eval/integration/22222222-2222-4222-8222-222222222222/summary.json',
        htmlPath: '/candidate/.ui-eval/integration/22222222-2222-4222-8222-222222222222/summary.html', jsonHash: '0'.repeat(64), htmlHash: '1'.repeat(64),
        conclusions: { code: 'not-assessed', ui: 'pass', release: 'not-assessed' } } },
  };
}

test('verification presentation leads with scoped conclusions and retains lossless copyable details in the actual post payload', async t => {
  const value = observation(), before = JSON.stringify(value);
  const text = verificationText(value, { execution: ['当前该任务无执行保护；历史结果保持原记录。'],
    applicability: '当前适用性：历史观测，Git 版本与报告未见变化；未重新验证运行环境或发布条件。' });
  assert.match(text, /^### 验证通过 · fixture/);
  assert.ok(text.indexOf('- UI：通过') < text.indexOf(value.execution));
  assert.match(text, /- 代码：未评估\n- UI：通过\n- 发布：未评估/);
  assert.match(text, /\*\*当前适用性\*\*\n历史观测/); assert.match(text, /未重新验证运行环境或发布条件/);
  assert.ok(text.includes('```\n任务编号：' + value.execution));
  assert.ok(text.includes('报告目录：.ui-eval/integration/' + value.observation!.integration!.id));
  assert.match(text, /JSON：summary.json\nHTML：summary.html\n```/);
  assert.equal(JSON.stringify(value), before);
  const feishu = new Feishu({ appId: 'test', appSecret: 'synthetic-secret' }); t.after(() => feishu.close());
  const calls: { path: unknown; data: { msg_type: string; uuid: string; content: string } }[] = [];
  Object.assign(feishu, { client: { im: { v1: { message: { reply: async (request: typeof calls[number]) => { calls.push(request); return { code: 0, data: { message_id: 'reply' } }; } } } } } });
  await feishu.send('chat', text, 'stable-view', { replyTo: 'owner-query' });
  await feishu.send('chat', text, 'stable-view', { replyTo: 'owner-query' });
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0]!.data.msg_type, 'post'); assert.deepEqual(calls[0]!.path, { message_id: 'owner-query' });
  const payload = JSON.parse(calls[0]!.data.content); assert.equal(payload.zh_cn.content[0][0].tag, 'md');
  assert.ok(payload.zh_cn.content[0][0].text.includes(value.execution));
  assert.ok(Buffer.byteLength(calls[0]!.data.content) < 20_000);
});

test('uncertain cleanup takes precedence over an engine pass; failure and review states stay distinct', () => {
  const value = observation(); value.phase = 'unknown'; value.observation!.cleanupSettled = false;
  const unknown = verificationText(value, { execution: ['当前该任务无执行保护；历史结果保持原记录。'] });
  assert.match(unknown, /^### 验证结果未确认/); assert.ok(unknown.indexOf('验证结果或清理未确认') < unknown.indexOf('- UI：通过'));
  assert.ok(unknown.includes('当前该任务无执行保护')); assert.ok(unknown.includes('验证观测：pass'));
  for (const [status, label] of [['fail', '未通过'], ['needs-review', '待人工复核'], ['inconclusive', '无法得出结论'], ['interrupted', '已中断'], ['unverified', '未核实']] as const) {
    value.phase = 'observed'; value.observation!.status = status;
    assert.ok(verificationText(value).startsWith(`### 验证${label}`));
  }
  assert.equal(copyBlock('path\n```\n/verification complete-id'), '~~~\npath\n```\n/verification complete-id\n~~~');
});

test('native generation receives chat presentation guidance without a formatting turn; status/help stay local', async t => {
  const h = setup(); t.after(h.close); h.deliveries();
  h.bridge.receive(message('/help')); assert.ok(h.deliveries().some(text => text.startsWith('### 使用帮助') && text.includes('**命令**')));
  h.bridge.receive(message('/status')); assert.ok(h.deliveries().some(text => text.startsWith('### 当前状态') && text.includes('**概览**')));
  assert.equal(h.turns().length, 0);
  h.bridge.receive(message('Reply with the result')); await until(() => h.turns().length === 1);
  const start = h.codex.calls.find(call => call.method === 'thread/start')!;
  assert.match(String(start.params.developerInstructions), /小标题用独立一行的加粗文字/);
  const turn = h.current(); h.codex.complete(turn.threadId, turn.turnId, 'completed', '**结果**\n\n已完成。');
  await until(() => !h.state.directories().length); assert.equal(h.turns().length, 1);
  assert.ok(h.deliveries().includes('**结果**\n\n已完成。'));
});
