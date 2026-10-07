import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { normalizeMessage, formatContext } from '../src/feishu.js';

function event() {
  return {
    tenant_key: 'tenant', sender: { sender_type: 'user', tenant_key: 'tenant', sender_id: { open_id: 'ou_owner' } },
    message: { message_type: 'text', chat_type: 'p2p', chat_id: 'chat', message_id: 'message', content: JSON.stringify({ text: 'Hello' }) },
  };
}

test('Feishu adapter accepts private user text and rejects group, bot, malformed, and cross-tenant events', () => {
  const valid = event();
  assert.deepEqual(normalizeMessage(valid), { tenant: 'tenant', user: 'ou_owner', chat: 'chat', id: 'message', text: 'Hello', chatType: 'p2p' });
  assert.equal(normalizeMessage({ ...valid, message: { ...valid.message, chat_type: 'group' } }), undefined);
  assert.equal(normalizeMessage({ ...valid, sender: { ...valid.sender, sender_type: 'app' } }), undefined);
  assert.equal(normalizeMessage({ ...valid, message: { ...valid.message, content: 'broken JSON' } }), undefined);
  assert.equal(normalizeMessage({ ...valid, sender: { ...valid.sender, tenant_key: 'other' } }), undefined);
  assert.equal(normalizeMessage({ ...valid, tenant_key: '' }), undefined);
});

test('configuration requires explicit authorization and existing absolute directories, and canonicalizes aliases', t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-config-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const alias = join(directory, 'link'); symlinkSync(directory, alias);
  const file = join(directory, 'config.json');
  const valid = { allowedUsers: ['ou_owner'], projects: { example: alias }, stateDirectory: 'state' };
  const write = (value: unknown) => writeFileSync(file, JSON.stringify(value));
  write(valid);
  assert.equal(loadConfig(file).projects.example, realpathSync(directory));
  assert.equal(loadConfig(file).stateDirectory, join(directory, 'state'));
  for (const invalid of [
    { ...valid, allowedUsers: [] }, { ...valid, allowedUsers: ['*'] },
    { ...valid, allowedUsers: ['ou_owner', 'ou_owner'] }, { ...valid, projects: { example: './relative' } },
    { ...valid, projects: {} }, { ...valid, approvalTimeoutSeconds: 0 }, { ...valid, permissive: true },
  ]) { write(invalid); assert.throws(() => loadConfig(file)); }
});


test('group transport requires a verified mention of this bot and removes only its exact placeholders', () => {
  const valid = event();
  const group = {
    ...valid,
    message: { ...valid.message, chat_type: 'group', content: JSON.stringify({ text: '@_user_1 /status @_user_10' }),
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' } }, { key: '@_user_10', id: { open_id: 'ou_other' } }] },
  };
  assert.equal(normalizeMessage(group), undefined);
  assert.equal(normalizeMessage(group, 'ou_different_bot'), undefined);
  assert.equal(normalizeMessage(group, 'ou_bot')?.text, '/status @_user_10');
  assert.equal(normalizeMessage({ ...group, message: { ...group.message, mentions: [] } }, 'ou_bot'), undefined);
  assert.equal(normalizeMessage({ ...group, message: { ...group.message, content: JSON.stringify({ text: '@all /status' }) } }, 'ou_bot'), undefined);
  assert.equal(normalizeMessage({ ...group, message: { ...group.message, content: JSON.stringify({ text: '@_user_10 /status' }) } }, 'ou_bot'), undefined);
  assert.equal(normalizeMessage({ ...group, message: { ...group.message, content: JSON.stringify({ text: '@_user_1' }) } }, 'ou_bot'), undefined);
  assert.equal(normalizeMessage({ ...group, sender: { ...group.sender, sender_type: 'app' } }, 'ou_bot'), undefined);
});

test('tenant access requires a pinned tenant and keeps approvers separate from submission users', t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-team-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'config.json');
  const valid = { allowedUsers: ['ou_owner', 'ou_other'], accessMode: 'tenant', allowedTenant: 'tenant', enableGroups: true,
    approvalUsers: ['ou_owner'], approvalChat: 'oc_admin', projects: { example: directory } };
  const write = (value: unknown) => writeFileSync(file, JSON.stringify(value));
  write(valid);
  const config = loadConfig(file);
  assert.equal(config.accessMode, 'tenant'); assert.equal(config.enableGroups, true);
  write({ ...valid, groupContextMessages: 50, groupContextImages: 8 });
  assert.equal(loadConfig(file).groupContextMessages, 50); assert.equal(loadConfig(file).groupContextImages, 8);
  assert.deepEqual(config.approvalUsers, ['ou_owner']); assert.equal(config.approvalChat, 'oc_admin');
  for (const invalid of [
    { ...valid, allowedTenant: null }, { ...valid, allowedTenant: '*' }, { ...valid, accessMode: 'anyone' },
    { ...valid, approvalUsers: [] }, { ...valid, groupContextMessages: 51 }, { ...valid, groupContextMessages: -1 }, { ...valid, groupContextMessages: '50' }, { ...valid, groupContextImages: 9 }, { ...valid, groupContextImages: -1 }, { ...valid, groupContextImages: '8' }, { ...valid, enableGroups: 'yes' }, { ...valid, approvalChat: '*' },
    { ...valid, accessMode: 'allowlist', approvalUsers: ['ou_unlisted'] },
  ]) { write(invalid); assert.throws(() => loadConfig(file)); }
  write({ allowedUsers: ['ou_owner'], projects: { example: directory } });
  const legacy = loadConfig(file);
  assert.equal(legacy.groupContextImages, 0); assert.equal(legacy.groupContextMessages, 0); assert.equal(legacy.accessMode, 'allowlist'); assert.equal(legacy.enableGroups, false); assert.deepEqual(legacy.approvalUsers, ['ou_owner']);
});


test('history context excludes other chats, future/current/deleted/bot records and labels unread media', () => {
  const row = (id: string, type: string, content: unknown, overrides: Record<string, unknown> = {}) => ({
    message_id: id, chat_id: 'group', create_time: '1000', msg_type: type,
    sender: { sender_type: 'user', sender_name: 'Colleague' }, body: { content: JSON.stringify(content) }, ...overrides,
  });
  const context = formatContext([
    row('trigger', 'text', { text: 'current' }), row('future', 'text', { text: 'future' }, { create_time: '3000' }),
    row('other', 'text', { text: 'secret other chat' }, { chat_id: 'other' }), row('deleted', 'text', { text: 'deleted' }, { deleted: true }),
    row('bot', 'text', { text: 'task noise' }, { sender: { sender_type: 'app' } }),
    row('image', 'image', { image_key: 'private-key' }), row('post', 'post', { zh_cn: { title: 'Book', content: [[{ tag: 'text', text: 'Read this' }]] } }),
  ], 'group', 'trigger', 2000, 20);
  assert.equal(context.messages.length, 2);
  assert.equal(context.messages[0]!.text, 'Book\nRead this');
  assert.ok(context.messages[1]!.text.includes('尚未读取'));
  assert.equal(JSON.stringify(context).includes('private-key'), false);
  assert.equal(formatContext([], 'group', 'trigger', 2000, 20).status, 'unavailable');
  assert.equal(formatContext([row('bot', 'text', { text: 'quoted answer' }, { sender: { sender_type: 'app' } })], 'group', 'trigger', 2000, 1, true).messages[0]!.text, 'quoted answer');
});
