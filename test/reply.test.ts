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
