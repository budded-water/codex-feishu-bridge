import assert from 'node:assert/strict';
import { CodexClient } from '../src/codex/client.js';
import { routingConfig } from '../src/routing.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// No user prompt, turn, model inference, or Feishu connection is created here.
const client = new CodexClient(process.env.CODEX_EXECUTABLE ?? 'codex');
const directory = mkdtempSync(join(tmpdir(), 'bridge-router-smoke-'));
try {
  await client.start();
  const catalog = await client.request<{ data: unknown[] }>('model/list', {});
  assert.ok(Array.isArray(catalog.data));
  const config = await routingConfig(client);
  const router = await client.request<{ thread: { id: string } }>('thread/start', { cwd: directory, ephemeral: true, sandbox: 'read-only', config, developerInstructions: 'Routing metadata smoke only; do not execute tools.' });
  assert.ok(router.thread.id);
  console.log(`PASS: real Codex stdio initialization, model catalog (${catalog.data.length} entries) and tool-disabled routing-thread metadata; no inference executed.`);
} finally {
  await client.close();
  rmSync(directory, { recursive: true, force: true });
}
