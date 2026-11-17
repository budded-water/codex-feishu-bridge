import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexClient } from '../src/codex/client.js';
import { PermissionState } from '../src/permission-state.js';
import { deniedActionEvent, parseNativeReview, type NativeReview } from '../src/permissions.js';

const native = process.argv.includes('--native');
if (process.argv.slice(2).some(a => a !== '--native')) throw Error('Usage: verify-permissions.ts [--native]');
const root = mkdtempSync(join(tmpdir(), 'bridge-native-permissions-')), home = join(root, 'isolated-policy'), workspace = join(root, 'workspace');
mkdirSync(home); mkdirSync(workspace);
const client = new CodexClient(process.env.CODEX_EXECUTABLE ?? 'codex');
const ledger = new PermissionState(root, { tenant: 'fixture', user: 'fixture', chat: 'fixture' }, process.env.CODEX_EXECUTABLE ?? 'codex', home);
const reviews: NativeReview[] = [], notifications: string[] = []; let human = 0;
client.onRequest(r => { human++; client.reply(r.id, { decision: 'decline' }); });
client.onNotification(e => { notifications.push(e.method); if (e.method === 'item/autoApprovalReview/completed') { const r = parseNativeReview(e.params); if (r) reviews.push(r); } });
try {
  const p = ['gh', 'pr', 'view'], grant = ledger.propose('fixture', 'fixture', 'fixture', p); ledger.submit(grant.id, 'fixture');
  mkdirSync(ledger.rulesDirectory); writeFileSync(ledger.defaultFile, 'prefix_rule(pattern=["gh", "pr", "view"], decision="allow")\n'); ledger.observeSaves();
  assert.equal(ledger.grant(grant.id)!.status, 'present'); assert.equal(await ledger.userRuleDecision(p), 'allow');
  await ledger.setRevoked(grant.id, true); assert.equal(await ledger.userRuleDecision(p), 'prompt');
  await ledger.setRevoked(grant.id, false); assert.equal(await ledger.userRuleDecision(p), 'allow');
  await client.start();
  const started = await client.request<{ thread: { id: string } }>('thread/start', { cwd: workspace, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' });
  assert.ok(started.thread.id);
  const fixture: NativeReview = { id: randomUUID(), thread: started.thread.id, turn: randomUUID(), item: null, started: Date.now(), completed: Date.now(),
    status: 'denied', risk: 'low', authorization: 'low', rationale: 'Scripted protocol fixture, not a real reviewer decision',
    action: { type: 'command', source: 'unified_exec', cwd: workspace, command: 'printf PROTOCOL_ONLY' } };
  await client.request('thread/approveGuardianDeniedAction', { threadId: started.thread.id, event: deniedActionEvent(fixture) });
  assert.equal(notifications.filter(n => n === 'turn/started').length, 0); assert.equal(reviews.length, 0);
  console.log('PASS: installed native rule parsing, prompt overlay, explicit policy and denied-action authorization RPC without starting a turn. Scripted denial is protocol evidence only.');
  if (native) {
    const marker = join(workspace, 'native-approved.txt');
    let finished!: () => void;
    const completion = new Promise<void>(resolve => { finished = resolve; });
    const unsubscribe = client.onNotification(e => { if (e.method === 'turn/completed' && e.params.threadId === started.thread.id) finished(); });
    const timer = setTimeout(() => finished(), 90_000);
    try {
      await client.request('turn/start', { threadId: started.thread.id, cwd: workspace, approvalPolicy: 'on-request', approvalsReviewer: 'auto_review',
        sandboxPolicy: { type: 'readOnly', networkAccess: false }, input: [{ type: 'text', text:
          `This is an authorized isolated permission acceptance fixture. Use the shell tool to create exactly ${marker} containing NATIVE_PERMISSION_OK and a newline. Request require_escalated for this write because the sandbox is read-only; use a short justification. Do not read any other files or use network. After the tool, briefly report its actual result.`, text_elements: [] }] });
      await completion;
      assert.equal(human, 0, 'Auto-review fixture must not require human approval');
      assert.ok(reviews.some(r => r.status === 'approved'), 'Expected an actual approved native review');
      assert.ok(existsSync(marker)); assert.equal(readFileSync(marker, 'utf8'), 'NATIVE_PERMISSION_OK\n');
      console.log('PASS: actual model/tool/Auto-review-approved isolated write; no human approval request. No live denial/retry or Feishu acceptance is implied.');
    } finally { clearTimeout(timer); unsubscribe(); }
  }
} finally { await client.close(); ledger.close(); rmSync(root, { recursive: true, force: true }); }
