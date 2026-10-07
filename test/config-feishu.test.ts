import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { normalizeMessage } from '../src/feishu.js';

function event() {
  return {
    tenant_key: 'tenant', sender: { sender_type: 'user', tenant_key: 'tenant', sender_id: { open_id: 'ou_owner' } },
    message: { message_type: 'text', chat_type: 'p2p', chat_id: 'chat', message_id: 'message', content: JSON.stringify({ text: 'Hello' }) },
  };
}

test('Feishu adapter accepts private user text and rejects group, bot, malformed, and cross-tenant events', () => {
  const valid = event();
  assert.deepEqual(normalizeMessage(valid), { tenant: 'tenant', user: 'ou_owner', chat: 'chat', id: 'message', text: 'Hello' });
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
    { ...valid, allowedUsers: ['ou_owner', 'ou_other'] }, { ...valid, projects: { example: './relative' } },
    { ...valid, projects: {} }, { ...valid, approvalTimeoutSeconds: 0 }, { ...valid, permissive: true },
  ]) { write(invalid); assert.throws(() => loadConfig(file)); }
});
