import assert from 'node:assert/strict';
import { CodexClient } from '../src/codex/client.js';

// No user prompt, turn, model inference, or Feishu connection is created here.
const client = new CodexClient(process.env.CODEX_EXECUTABLE ?? 'codex');
try {
  await client.start();
  const catalog = await client.request<{ data: unknown[] }>('model/list', {});
  assert.ok(Array.isArray(catalog.data));
  console.log(`PASS: real Codex stdio initialization and model catalog (${catalog.data.length} entries); no inference executed.`);
} finally {
  await client.close();
}
