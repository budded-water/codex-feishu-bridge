import test from 'node:test';
import assert from 'node:assert/strict';
import { Feishu, formatContext } from '../src/feishu.js';
import { markdownPost, splitReply } from '../src/reply.js';

const sample = '# 建议\n\n先看 **关键问题**，再决定下一步。\n\n- [官方文档](https://example.com/docs)\n- `npm run check`\n\n```ts\n# keep code as written\nconst value = "**literal**";\n```';

test('transport sends native rich posts with stable recipient and UUID, never raw text or cards', async t => {
  const feishu = new Feishu({ appId: 'test-app', appSecret: 'test-secret' });
  t.after(() => feishu.close());
  const sent: unknown[] = [];
  const client = { im: { v1: { message: { create: async (request: unknown) => { sent.push(request); return { code: 0 }; } } } } };
  Object.assign(feishu, { client });
  await feishu.send('chat', sample, 'stable-key');
  await feishu.send('chat', sample, 'stable-key');
  assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(sent[0], {
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: 'chat', msg_type: 'post', content: JSON.stringify(markdownPost(sample)), uuid: 'stable-key' },
  });
  Object.assign(feishu, { client: { im: { v1: { message: { create: async () => ({ code: 230001 }) } } } } });
  await assert.rejects(feishu.send('chat', sample, 'key'), /rejected message delivery/);
});

test('chat styling keeps Markdown emphasis, lists, links and code while shrinking headings and excess spacing', () => {
  const rendered = markdownPost(sample.replace('先看', '\n\n先看')).zh_cn.content[0]![0]!.text;
  assert.ok(rendered.startsWith('#### 建议\n\n先看 **关键问题**'));
  assert.ok(rendered.includes('- [官方文档](https://example.com/docs)'));
  assert.ok(rendered.includes('```ts\n# keep code as written\nconst value = "**literal**";\n```'));
  assert.ok(!rendered.includes('\n\n\n'));
});

test('long answers retain line boundaries, exact prose and Unicode with bounded native post payloads', () => {
  const body = ('**建议**：🙂你好\n\n- 查看 [文档](https://example.com)\n').repeat(200);
  const chunks = splitReply(body);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), body);
  for (const chunk of chunks) {
    assert.ok(chunk.endsWith('\n'));
    assert.ok(Buffer.byteLength(JSON.stringify(markdownPost(chunk))) < 20_000);
  }
  const unbroken = '🙂你好'.repeat(2500);
  assert.equal(splitReply(unbroken).join(''), unbroken);
});

test('long fenced code closes and reopens at message boundaries without losing code lines', () => {
  for (const marker of ['```', '~~~~']) {
    const lines = Array.from({ length: 200 }, (_, i) => `const line${i} = "🙂你好";`);
    const chunks = splitReply(`说明\n\n${marker}ts\n${lines.join('\n')}\n${marker}\n\n完成。`);
    const recovered: string[] = [];
    for (const chunk of chunks) {
      const fences = chunk.split('\n').filter(line => line.startsWith(marker));
      assert.equal(fences.length % 2, 0);
      recovered.push(...chunk.split('\n').filter(line => line.startsWith('const line')));
      assert.ok(Array.from(chunk).length <= 3000);
    }
    assert.deepEqual(recovered, lines);
    assert.ok(chunks.at(-1)!.endsWith('完成。'));
  }
});

test('quoted rich replies preserve markdown and code text while media remains explicitly unread', () => {
  const context = formatContext([{
    message_id: 'quote', chat_id: 'chat', create_time: '1000', msg_type: 'post', sender: { sender_type: 'app' },
    body: { content: JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text: '**建议**' }, { tag: 'code_block', text: 'const n = 1;' }, { tag: 'img', image_key: 'private-media' }]] } }) },
  }], 'chat', 'trigger', 2000, 1, true);
  assert.ok(context.messages[0]!.text.includes('**建议**const n = 1;'));
  assert.ok(context.messages[0]!.text.includes('尚未读取'));
  assert.ok(!JSON.stringify(context).includes('private-media'));
});

test('recent history read is one scoped page with a 24-hour window and cannot paginate or fetch media', async t => {
  const adapter = new Feishu({ appId: 'test-app', appSecret: 'test-secret' });
  t.after(() => adapter.close());
  const requests: unknown[] = [];
  const cutoff = 1_800_000_000_123;
  Object.assign(adapter, { client: { im: { v1: { message: { list: async (request: unknown) => {
    requests.push(request);
    return { code: 0, data: { has_more: true, page_token: 'do-not-follow', items: [{
      message_id: 'previous', chat_id: 'group', create_time: String(cutoff - 500), msg_type: 'text', sender: { sender_type: 'user' }, body: { content: JSON.stringify({ text: 'Relevant context' }) },
    }] } };
  } } } } } });
  const session = { id: 'session', owner: 'owner', tenant: 'tenant', user: 'user', chat: 'group', project: '$chat', directory: 'directory', thread: null };
  const source = { id: 'trigger', chatType: 'group' as const, createTime: String(cutoff) };
  const result = await adapter.context(session, source, 20);
  assert.equal(result.status, 'available');
  assert.deepEqual(requests, [{ params: {
    container_id_type: 'chat', container_id: 'group', page_size: 20,
    start_time: String(Math.floor(cutoff / 1000) - 86400), end_time: String(Math.floor(cutoff / 1000) + 1), sort_type: 'ByCreateTimeDesc', with_sender_name: true,
  } }]);
  assert.equal((await adapter.context(session, source, 51)).status, 'unavailable');
  assert.equal(requests.length, 1);
});

test('recent context independently enforces 24-hour and trigger boundaries, selecting the latest 50 chronologically', () => {
  const cutoff = 1_800_000_000_123;
  const row = (id: string, time: number) => ({ message_id: id, chat_id: 'group', create_time: String(time), msg_type: 'text', sender: { sender_type: 'user' }, body: { content: JSON.stringify({ text: id }) } });
  const rows = Array.from({ length: 60 }, (_, i) => row(`recent-${i}`, cutoff - 60 + i));
  const result = formatContext([row('old', cutoff - 86_400_001), ...rows, row('future', cutoff + 1), row('same-time', cutoff)], 'group', 'trigger', cutoff, 50);
  assert.deepEqual(result.messages.map(item => item.text), rows.slice(-50).map(item => JSON.parse(item.body.content).text));
  assert.equal(formatContext([row('boundary', cutoff - 86_400_000)], 'group', 'trigger', cutoff, 20).messages.length, 1);
  assert.equal(formatContext([row('explicit-older-quote', cutoff - 86_400_001)], 'group', 'trigger', cutoff, 1, true).messages.length, 1);
});

test('both SDK HTTP errors and API missing-permission results state the limitation without leaking raw responses', async t => {
  const adapter = new Feishu({ appId: 'test-app', appSecret: 'test-secret' });
  t.after(() => adapter.close());
  const session = { id: 'session', owner: 'owner', tenant: 'tenant', user: 'user', chat: 'group', project: '$chat', directory: 'directory', thread: null };
  for (const list of [async () => ({ code: 230027 }), async () => { throw { response: { data: { code: 230027, msg: 'private response' } } }; }]) {
    Object.assign(adapter, { client: { im: { v1: { message: { list } } } } });
    const result = await adapter.context(session, { id: 'trigger', chatType: 'group', createTime: '1800000000123' }, 20);
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.messages, []);
    assert.ok(result.note.includes('权限尚未开通'));
    assert.ok(!JSON.stringify(result).includes('private response'));
  }
});
