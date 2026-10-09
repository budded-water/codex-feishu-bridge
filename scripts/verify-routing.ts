// Optional local model verification: fictional inputs, no Feishu/AWS requests.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexClient } from '../src/codex/client.js';
import { parseRoute, routeSchema, routingConfig } from '../src/routing.js';
import { record, string } from '../src/types.js';

const directory = mkdtempSync(join(tmpdir(), 'bridge-routing-verify-'));
const client = new CodexClient(process.env.CODEX_EXECUTABLE ?? 'codex');
const config = { projects: { alpha: directory, beta: directory } };
let calls = 0;
client.onRequest(request => { calls++; client.reject(request.id, 'Verification cannot execute tools'); });
try {
  await client.start();
  const overrides = await routingConfig(client);
  for (const [input, kind, project] of [['查询 beta 的注册人数', 'project', 'beta'], ['查一下注册人数', 'question', null], ['你好', 'project', '$chat']] as const) {
    const result = await client.request<{ thread: { id: string } }>('thread/start', {
      cwd: directory, ephemeral: true, sandbox: 'read-only', config: overrides,
      developerInstructions: '只判断本次请求，不能执行工具。已登记 alpha 和 beta，当前没有选择项目。明确的项目数据查询返回 project 和对应别名，text 为空；不清楚项目时返回 question 和一个简短中文问题，project=null；普通聊天返回 project，project=$chat，text 为空。不猜数据。continuePending=false。',
    });
    let answer = '';
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const completed = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const timeout = setTimeout(() => reject(new Error('Routing inference timed out')), 120_000);
    const unsubscribe = client.onNotification(event => {
      if (event.params.threadId !== result.thread.id) return;
      if (event.method === 'item/completed') {
        const item = record(event.params.item);
        if (item.type === 'agentMessage' && (item.phase === 'final_answer' || item.phase == null)) answer = string(item.text);
      }
      if (event.method === 'turn/completed') record(event.params.turn).status === 'completed' ? resolve() : reject(new Error('Routing turn failed'));
    });
    try {
      await client.request('turn/start', { threadId: result.thread.id, input: [{ type: 'text', text: input, text_elements: [] }], outputSchema: routeSchema(config), effort: 'low' });
      await completed;
      const decision = parseRoute(answer, config);
      assert.equal(decision.kind, kind); assert.equal(decision.project, project);
      console.log(`PASS: ${kind}${project ? ` → ${project}` : ''}`);
    } finally { clearTimeout(timeout); unsubscribe(); }
  }
  assert.equal(calls, 0);
  console.log('PASS: real model routing for clear, ambiguous and ordinary-chat inputs; no tool requests or Feishu messages.');
} finally {
  await client.close(); rmSync(directory, { recursive: true, force: true });
}
