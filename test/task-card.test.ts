import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseTaskPresentation, redactTaskPresentation, taskCard, taskText, type TaskLayout, type TaskPresentation } from '../src/task-card.js';

const layout = (): TaskLayout => ({ title: '浏览器权限验收', heading: '本轮已结束', tone: 'grey', summary: '保留历史访问记录，已登记关联续接。',
  updated: '更新于 01:00:00 GMT+8 · 只读快照', facts: [{ label: '执行用时', value: '1 分 24 秒' }, { label: '执行记录', value: '已核对' }],
  panels: [{ title: '原始需求（展开全文）', text: '完整需求 https://appstoreconnect.apple.com/ 和另一个完整 URL。' },
    { title: '历史访问记录与关联续接', text: '历史记录，不代表当前仍受阻。' }] });
const presentation = (v = layout()): TaskPresentation => ({ id: randomUUID(), execution: randomUUID(), tenant: 'tenant', user: 'owner', chat: 'chat', layout: v, text: taskText(v) });

test('structured task card puts status and compact summary first, retains full disclosure and one refresh control', () => {
  const p = presentation(), card = taskCard(parseTaskPresentation(p));
  assert.equal(card.header.title.content, '本轮已结束'); assert.equal(card.header.template, 'grey');
  const elements = card.body.elements as Record<string, unknown>[];
  const panels = elements.filter(e => e.tag === 'collapsible_panel'); assert.equal(panels.length, 2);
  assert.ok(panels.every(e => e.expanded === false));
  for (const panel of panels) {
    const header = panel.header as { title: { tag: string; content: string }; icon: { tag: string; token: string; size: string }; icon_position: string; icon_expanded_angle: number; padding: string };
    assert.equal(header.title.tag, 'markdown'); assert.ok(header.title.content.includes("<font color='blue'>"));
    assert.equal(header.icon.tag, 'standard_icon'); assert.equal(header.icon.token, 'down-small-ccm_outlined'); assert.equal(header.icon.size, '20px 20px');
    assert.equal(header.icon_position, 'right'); assert.equal(header.icon_expanded_angle, -180);
    assert.ok(header.padding && panel.border);
  }
  assert.ok(JSON.stringify(elements).includes('点击下方条目展开 / 收起详情'));
  const visible = elements.filter(e => e.tag !== 'collapsible_panel');
  assert.ok(!JSON.stringify(visible).includes('https://appstoreconnect.apple.com/'));
  assert.ok(JSON.stringify(panels).includes(p.layout!.panels[0]!.text));
  const buttons = elements.filter(e => e.tag === 'button'); assert.equal(buttons.length, 1);
  assert.ok(JSON.stringify(buttons).includes(p.id)); assert.ok(JSON.stringify(buttons).includes('task_progress'));
  assert.ok(!JSON.stringify(buttons).includes(p.execution));
});

test('legacy task presentations render and new nested data is validated at the persisted payload boundary', () => {
  const { layout: _layout, ...legacy } = presentation(); legacy.text = '### Legacy\n\n原生本轮已完成';
  assert.equal(parseTaskPresentation(legacy).layout, undefined); assert.ok(JSON.stringify(taskCard(legacy)).includes('Legacy'));
  for (const change of [{ tone: 'invalid' }, { heading: '' }, { facts: [{ label: 'bad', value: 3 }] }, { panels: 'invalid' }]) {
    assert.throws(() => parseTaskPresentation({ ...presentation(), layout: { ...layout(), ...change } }));
  }
  assert.throws(() => parseTaskPresentation({ ...presentation(), text: 'Unrelated fallback' }), /text differs/);
});

test('transport redaction covers every nested display field and regenerates its canonical fallback', () => {
  const secret = 'SECRET', v: TaskLayout = { title: secret, heading: secret, summary: secret, updated: secret, tone: 'orange',
    action: secret, facts: [{ label: secret, value: secret }], panels: [{ title: secret, text: secret }] };
  const p = redactTaskPresentation(presentation(v), s => s.replaceAll(secret, '[redacted]'));
  assert.ok(!JSON.stringify(p).includes(secret)); assert.equal(p.text, taskText(p.layout!));
  assert.ok(!JSON.stringify(taskCard(parseTaskPresentation(p))).includes(secret));
});
