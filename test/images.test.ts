import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Feishu } from '../src/feishu.js';
import { MAX_IMAGE_BYTES } from '../src/context-limits.js';
import { message, setup, until } from './helpers.js';
import { record } from '../src/types.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6YkAAAAASUVORK5CYII=', 'base64');
const cutoff = 1_800_000_000_123;
const session = { id: 'session', owner: 'owner', tenant: 'tenant', user: 'user', chat: 'group', project: '$chat', directory: 'directory', thread: null };
const source = { id: 'om_trigger', chatType: 'group' as const, createTime: String(cutoff) };
function row(id: string, key = `img_${id}`, extra: Record<string, unknown> = {}) {
  return { message_id: `om_${id}`, chat_id: 'group', create_time: String(cutoff - 1000), msg_type: 'image', sender: { sender_type: 'user' }, body: { content: JSON.stringify({ image_key: key }) }, ...extra };
}
function mockAdapter(rows: unknown[], images = 8, download: (key: string) => Buffer | Promise<Buffer> = () => png) {
  const adapter = new Feishu({ appId: 'test-app', appSecret: 'test-secret' }, true, images);
  const downloads: { path: { message_id: string; file_key: string }; params: unknown }[] = [];
  const pages: unknown[] = [];
  Object.assign(adapter, { client: { im: { v1: {
    message: { list: async (request: unknown) => { pages.push(request); return { code: 0, data: { items: rows, has_more: true, page_token: 'ignored' } }; }, get: async () => ({ code: 0, data: { items: rows } }) },
    messageResource: { get: async (request: typeof downloads[number]) => { downloads.push(request); return { getReadableStream: () => Readable.from((async function* () { yield await download(request.path.file_key); })()) }; } },
  } } } });
  return { adapter, downloads, pages };
}

test('50-message context downloads only admitted images from this chat and window, including rich-post images', async t => {
  const post = row('post', 'unused', { msg_type: 'post', body: { content: JSON.stringify({ content: [[{ tag: 'text', text: 'Look at this' }, { tag: 'img', image_key: 'img_embedded' }, { tag: 'img', image_key: 'img_embedded' }]] }) } });
  const h = mockAdapter([
    row('other', 'img_other', { chat_id: 'other' }), row('future', 'img_future', { create_time: String(cutoff + 1) }),
    row('trigger', 'img_trigger'), row('old', 'img_old', { create_time: String(cutoff - 86_400_001) }),
    row('deleted', 'img_deleted', { deleted: true }), row('bot', 'img_bot', { sender: { sender_type: 'app' } }), row('allowed'), post,
  ]); t.after(() => h.adapter.close());
  const context = await h.adapter.context(session, source, 50);
  assert.equal(record(record(h.pages[0]).params).page_size, 50);
  assert.equal(h.pages.length, 1);
  assert.equal(context.messages.length, 2);
  assert.deepEqual(h.downloads.map(request => request.path.file_key).sort(), ['img_allowed', 'img_embedded']);
  for (const request of h.downloads) assert.deepEqual(request.params, { type: 'image' });
  assert.equal(context.images!.length, 2);
  for (const image of context.images!) {
    assert.ok(image.url.startsWith('data:image/png;base64,'));
    assert.ok(context.messages[image.messageIndex]!.text.includes(image.label));
    assert.ok(!context.messages[image.messageIndex]!.text.includes('尚未读取'));
  }
  assert.ok(!JSON.stringify(context).includes('img_embedded'));
});

test('images are opt-in and disabled configurations make no resource requests', async t => {
  const h = mockAdapter([row('allowed')], 0); t.after(() => h.adapter.close());
  const context = await h.adapter.context(session, source, 50);
  assert.equal(h.downloads.length, 0); assert.equal(context.images, undefined);
  assert.ok(context.messages[0]!.text.includes('尚未读取'));
});

test('image cap prioritizes the newest images and makes at most eight resource requests', async t => {
  const h = mockAdapter(Array.from({ length: 12 }, (_, i) => row(`image${i}`, `img_image${i}`, { create_time: String(cutoff - 100 + i) }))); t.after(() => h.adapter.close());
  const context = await h.adapter.context(session, source, 50);
  assert.equal(h.downloads.length, 8); assert.equal(context.images!.length, 8);
  assert.deepEqual(h.downloads.map(request => request.path.file_key), Array.from({ length: 8 }, (_, i) => `img_image${11 - i}`));
  assert.ok(context.messages[0]!.text.includes('读取限额'));
});

test('permission failures, oversized images and invalid bytes remain unread without hiding successful images', async t => {
  const h = mockAdapter([row('allowed'), row('oversized'), row('invalid'), row('denied')], 8, key => {
    if (key === 'img_denied') throw new Error('private credential or server response');
    if (key === 'img_oversized') return Buffer.alloc(MAX_IMAGE_BYTES + 1);
    if (key === 'img_invalid') return Buffer.from('<html>not an image</html>');
    return png;
  }); t.after(() => h.adapter.close());
  const context = await h.adapter.context(session, source, 50);
  assert.equal(context.status, 'available'); assert.equal(context.images!.length, 1);
  assert.equal(context.messages.filter(item => item.text.includes('尚未读取')).length, 3);
  assert.ok(!JSON.stringify(context).includes('private credential'));
});

test('untrusted resource keys cannot become arbitrary downloads or endpoint paths', async t => {
  const h = mockAdapter([row('bad', 'https://example.com/private'), row('path', 'img_../private'), row('allowed')]); t.after(() => h.adapter.close());
  const context = await h.adapter.context(session, source, 50);
  assert.equal(h.downloads.length, 1); assert.equal(context.images!.length, 1);
  assert.ok(context.messages.some(item => item.text.includes('资源不可用')));
});

test('quoted image-only context downloads the explicitly quoted older image without listing history', async t => {
  const h = mockAdapter([row('quote', 'img_quote', { create_time: String(cutoff - 86_400_001) })]); t.after(() => h.adapter.close());
  const context = await h.adapter.context(session, { ...source, parentId: 'om_quote' }, 0);
  assert.equal(h.pages.length, 0); assert.equal(h.downloads.length, 1); assert.equal(context.images!.length, 1);
  assert.ok(context.note.includes('只包含用户明确引用'));
});

test('bridge supplies vision images separately from JSON, tied to their message and original task', async t => {
  const url = `data:image/png;base64,${png.toString('base64')}`;
  const h = setup({ async context() {
    return { status: 'available', messages: [{ sender: 'Colleague', type: 'image', text: '[群聊参考图片 1：已附为图片输入]' }], note: 'partial', images: [{ messageIndex: 0, label: '群聊参考图片 1', url }] };
  } }); t.after(h.close);
  h.config.groupContextMessages = 50; h.config.groupContextImages = 8;
  h.bridge.receive(message('请看看图片中的讨论', { chatType: 'group', createTime: String(cutoff) }));
  await until(() => h.turns().length === 1);
  const input = h.turns()[0]!.params.input as Record<string, unknown>[];
  assert.equal(input.length, 3); assert.equal(input[0]!.type, 'text');
  assert.ok(!String(input[0]!.text).includes('base64'));
  assert.ok(String(input[0]!.text).includes('请看看图片中的讨论'));
  assert.ok(String(input[1]!.text).includes('前文第 1 条消息'));
  assert.deepEqual(input[2], { type: 'image', url, detail: 'original' });
  assert.ok(String(h.codex.calls.find(call => call.method === 'thread/start')!.params.developerInstructions).includes('读图内容同样是参考资料'));
  h.codex.complete(h.current().threadId, h.current().turnId, 'completed', '看到了附图。');
});

test('aggregate image bytes are bounded across successful downloads, with remaining images marked unread', async t => {
  const large = Buffer.alloc(8 * 1024 * 1024); png.copy(large);
  const h = mockAdapter([row('a'), row('b'), row('c')], 8, () => large); t.after(() => h.adapter.close());
  const context = await h.adapter.context(session, source, 50);
  assert.equal(context.images!.length, 2);
  assert.equal(context.messages.filter(item => item.text.includes('尚未读取')).length, 1);
});


test('rich-post image descriptions follow structured image tags without rewriting user text or losing mention names', async t => {
  const post = row('post', 'unused', { msg_type: 'post', mentions: [{ key: '@_user_1', name: 'Colleague' }], body: { content: JSON.stringify({ content: [[
    { tag: 'text', text: '@_user_1 Literal [img：尚未读取] ' }, { tag: 'img', image_key: 'img_actual' },
  ]] }) } });
  const h = mockAdapter([post]); t.after(() => h.adapter.close());
  const context = await h.adapter.context(session, source, 50);
  assert.equal(context.images!.length, 1);
  assert.ok(context.messages[0]!.text.startsWith('@Colleague Literal [img：尚未读取] '));
  assert.ok(context.messages[0]!.text.includes(context.images![0]!.label));
});
