import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { State } from '../src/state.js';
import { Outbox } from '../src/outbox.js';
import { executeVisualOperation, readVisualInspection, visualWorkflows } from '../src/handoff/visual-review-workflow.js';
import { normalizeVisualReviewClick, type VisualDecision } from '../src/visual-review.js';
import { visualReceiptCard } from '../src/visual-receipt-card.js';

test('a bound visual review runs each explicit write once and presents provider receipts on the same card', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-review-workflow-')));
  const executable = join(root, 'delivery');
  const effects = join(root, 'effects');
  const provider = join(root, 'pr-head');
  const repository = 'example/project';
  const commit = 'a'.repeat(40);
  const mergeCommit = 'b'.repeat(40);
  const adapter = [
    '#!' + process.execPath,
    'const fs = require("node:fs");',
    'const input = JSON.parse(process.argv[2]);',
    'const head = fs.readFileSync(' + JSON.stringify(provider) + ', "utf8");',
    'if (head === "foreign-target") { console.log(JSON.stringify({...input,target:"other",status:"blocked",reason:"checks"})); process.exit(0); }',
    'if (head === "foreign-merge") { console.log(JSON.stringify({...input,mergeCommit:"' + 'c'.repeat(40) + '",status:"blocked",reason:"checks"})); process.exit(0); }',
    'if (head === "malformed-blocked") { console.log(JSON.stringify({...input,status:"blocked",reason:["checks"]})); process.exit(0); }',
    'if (input.commit !== head) { console.log(JSON.stringify({...input,status:"blocked",reason:"stale-source"})); process.exit(0); }',
    'fs.appendFileSync(' + JSON.stringify(effects) + ', JSON.stringify(input) + "\\n");',
    'console.log(JSON.stringify(input.action === "merge" ? {...input,status:"merged",mergeCommit:"' + mergeCommit + '"}',
    '  : {...input,status:"uploaded",version:"1.2.3",receipt:"receipt-fixture"}));',
  ].join('\n');
  writeFileSync(executable, adapter, { mode: 0o700 });
  writeFileSync(provider, commit);
  const workflow = { executable, sha256: createHash('sha256').update(adapter).digest('hex'), base: 'main', uploadTarget: 'test-dev-app' };
  const workflows = visualWorkflows({ [repository]: workflow });
  let state = new State(root);
  t.after(() => { state.close(); rmSync(root, { recursive: true, force: true }); });
  const id = randomUUID();
  const owner = { tenant: 'tenant', user: 'ou_owner', chat: 'oc_private' };
  const binding = { repository, commit, pullRequest: 41, workflow };
  chmodSync(root, 0o777);
  try {
    assert.deepEqual(await executeVisualOperation({ id, action: 'merge', binding }, workflows),
      { status: 'blocked', reason: 'workflow-unavailable' });
    assert.equal(existsSync(effects), false);
  } finally { chmodSync(root, 0o700); }
  const images = [{ caption: '首页 · 通过 · 已执行断言 4/4', key: 'img_fixture' }];
  const body = '微信 UI 验证 · 1/1 个场景通过\n候选版本\n\n待人工看图 · 首页';
  state.visualReviews.register(id, owner, body, binding);
  const click = (decision: VisualDecision, card = id, message = 'om_card') => ({
    schema: '2.0', app_id: 'fixture', host: 'im_message', tenant_key: owner.tenant,
    operator: { open_id: owner.user, tenant_key: owner.tenant },
    context: { open_chat_id: owner.chat, open_message_id: message },
    action: { tag: 'button', value: { kind: 'visual_review', id: card, decision } },
  });
  const decide = (decision: VisualDecision, card = id, message = 'om_card') =>
    state.transaction(() => state.visualReviews.decide(normalizeVisualReviewClick(click(decision, card, message), 'fixture')!));
  const buttons = () => visualReceiptCard(body, images, state.visualReviews.view(id)).body.elements
    .filter(element => element.tag === 'button').map(element => Reflect.get(element, 'text').content);
  const run = async () => {
    const operation = state.transaction(() => state.visualReviews.take());
    assert.ok(operation);
    const result = await executeVisualOperation(operation, workflows);
    state.visualReviews.finish(operation, result);
    return result;
  };
  assert.deepEqual(buttons(), ['通过并合并 PR', '仅确认验收']);
  assert.equal(decide('merge'), 'rejected');
  state.visualReviews.delivered(id, 'om_card', images);
  assert.equal(decide('upload'), 'rejected');
  assert.equal(decide('merge', id, 'om_foreign'), 'rejected');
  assert.equal(decide('accept'), 'accepted');
  assert.equal(state.visualReviews.take(), undefined);
  assert.deepEqual(buttons(), ['合并 PR']);
  assert.equal(decide('merge'), 'accepted');
  assert.equal(decide('merge'), 'duplicate');
  assert.deepEqual(await run(), { status: 'merged', mergeCommit });
  assert.deepEqual(buttons(), ['上传微信开发版']);
  assert.equal(decide('upload'), 'accepted');
  assert.equal(decide('upload'), 'duplicate');
  assert.deepEqual(await run(), { status: 'uploaded', version: '1.2.3', receipt: 'receipt-fixture' });
  assert.deepEqual(buttons(), []);
  const events = readFileSync(effects,'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events, [
    { id, action: 'merge', repository, commit, pullRequest: 41, base: 'main' },
    { id, action: 'upload', repository, commit, pullRequest: 41, base: 'main', mergeCommit, target: 'test-dev-app' },
  ]);
  const final = state.visualReviews.pendingUpdates(Date.now()).find(update => update.card.id === id)!;
  assert.equal(final.message, 'om_card');
  assert.deepEqual(final.images, images);
  state.visualReviews.settleUpdate(id, final.revision, true);

  const stale = randomUUID();
  state.visualReviews.register(stale, owner, body, { ...binding, pullRequest: 42 });
  state.visualReviews.delivered(stale, 'om_stale', images);
  writeFileSync(provider, 'c'.repeat(40));
  assert.equal(decide('merge', stale, 'om_stale'), 'accepted');
  assert.deepEqual(await run(), { status: 'blocked', reason: 'stale-source' });
  assert.equal(state.visualReviews.view(stale)?.phase, 'merge-blocked');
  assert.equal(readFileSync(effects,'utf8').trim().split('\n').length, 2);

  const interrupted = randomUUID();
  state.visualReviews.register(interrupted, owner, body, { ...binding, pullRequest: 43 });
  state.visualReviews.delivered(interrupted, 'om_interrupted', images);
  assert.equal(decide('merge', interrupted, 'om_interrupted'), 'accepted');
  assert.equal(state.visualReviews.take()?.id, interrupted);
  state.close();
  state = new State(root);
  state.visualReviews.recoverLaunches();
  assert.equal(state.visualReviews.view(interrupted)?.phase, 'merge-unknown');
  assert.equal(state.visualReviews.take(), undefined);
  assert.equal(decide('merge', interrupted, 'om_interrupted'), 'duplicate');
  const replacement = randomUUID();
  state.visualReviews.register(replacement, owner, body, { ...binding, pullRequest: 43 });
  state.visualReviews.delivered(replacement, 'om_new', images);
  assert.equal(decide('merge', replacement, 'om_new'), 'rejected');
  const inspectionPath = join(root, 'inspection.json');
  const mergeObservation = { action: 'merge', repository, commit, pullRequest: 43, base: 'main', status: 'absent', evidence: 'Provider checked original PR head and merge state' };
  writeFileSync(inspectionPath, JSON.stringify(mergeObservation), { mode: 0o644 });
  assert.throws(() => readVisualInspection(inspectionPath), /private to the runtime owner/);
  chmodSync(inspectionPath, 0o600);
  const mergeInspection = readVisualInspection(inspectionPath);
  assert.throws(() => state.transaction(() => state.visualReviews.reconcile(interrupted, { ...mergeInspection, pullRequest: 41 })), /identity differs/);
  assert.deepEqual(state.transaction(() => state.visualReviews.reconcile(interrupted, mergeInspection)), {
    id: interrupted, phase: 'merge-blocked', status: 'recorded',
  });
  assert.equal(state.transaction(() => state.visualReviews.reconcile(interrupted, mergeInspection)).status, 'duplicate');
  assert.equal(state.visualReviews.take(), undefined);
  writeFileSync(provider, commit);
  assert.equal(decide('merge', replacement, 'om_new'), 'accepted');
  assert.deepEqual(await run(), { status: 'merged', mergeCommit });

  const secondTarget = randomUUID();
  state.visualReviews.register(secondTarget, owner, body, { ...binding, pullRequest: 44 });
  state.visualReviews.delivered(secondTarget, 'om_second', images);
  writeFileSync(provider, commit);
  assert.equal(decide('merge', secondTarget, 'om_second'), 'accepted');
  await run();
  assert.equal(decide('upload', secondTarget, 'om_second'), 'accepted');
  writeFileSync(provider, 'foreign-target');
  const upload = state.visualReviews.take()!;
  await assert.rejects(executeVisualOperation(upload, workflows), /receipt identity differs/);
  writeFileSync(provider, 'foreign-merge');
  await assert.rejects(executeVisualOperation(upload, workflows), /receipt identity differs/);
  state.visualReviews.finish(upload);
  assert.equal(state.visualReviews.view(secondTarget)?.phase, 'upload-unknown');
  assert.equal(decide('upload', replacement, 'om_new'), 'rejected');
  const uploadInspection = { action: 'upload', repository, commit, pullRequest: 44, base: 'main', target: 'test-dev-app', mergeCommit,
    status: 'absent', evidence: 'Provider developer build list inspected' };
  assert.throws(() => state.transaction(() => state.visualReviews.reconcile(secondTarget, { ...uploadInspection, target: 'other' })), /identity differs/);
  assert.equal(state.transaction(() => state.visualReviews.reconcile(secondTarget, uploadInspection)).phase, 'upload-blocked');
  assert.equal(state.visualReviews.take(), undefined);
  assert.equal(decide('upload', replacement, 'om_new'), 'accepted');
  writeFileSync(provider, commit);
  await run();

  const malformed = randomUUID();
  state.visualReviews.register(malformed, owner, body, { ...binding, pullRequest: 45 });
  state.visualReviews.delivered(malformed, 'om_malformed', images);
  assert.equal(decide('merge', malformed, 'om_malformed'), 'accepted');
  writeFileSync(provider, 'malformed-blocked');
  const invalid = state.visualReviews.take()!;
  await assert.rejects(executeVisualOperation(invalid, workflows), /did not confirm/);
  state.visualReviews.finish(invalid);
  assert.equal(state.visualReviews.view(malformed)?.phase, 'merge-unknown');
  const other = randomUUID();
  state.visualReviews.register(other, owner, body, { ...binding, pullRequest: 45 });
  state.visualReviews.delivered(other, 'om_other', images);
  assert.equal(decide('merge', other, 'om_other'), 'rejected');
  const verifiedMerge = { ...mergeInspection, pullRequest: 45, status: 'merged', mergeCommit, evidence: 'Provider confirmed the merge commit' };
  assert.equal(state.transaction(() => state.visualReviews.reconcile(malformed, verifiedMerge)).phase, 'merged');
  assert.equal(state.visualReviews.view(malformed)?.mergeCommit, mergeCommit);
  assert.equal(state.visualReviews.take(), undefined);
});

test('visual card updates remain ordered when the delivery branch fails', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'visual-card-order-')));
  const state = new State(directory);
  t.after(() => { state.close(); rmSync(directory, { recursive: true, force: true }); });
  const owner = { tenant: 'tenant', chat: 'chat', user: 'owner' };
  const id = randomUUID(), message = 'om_same_card';
  state.visualReviews.register(id, owner, 'Visual receipt', { repository: 'example/project', commit: 'a'.repeat(40), pullRequest: 1,
    workflow: { executable: '/unused', sha256: 'b'.repeat(64), base: 'main' } });
  state.visualReviews.delivered(id, message, [{ caption: 'Fixture', key: 'img_fixture' }]);
  assert.equal(state.transaction(() => state.visualReviews.decide({ ...owner,id,message,decision:'accept' })), 'accepted');

  const pending = state.pending.bind(state);
  let failing = true;
  t.mock.method(state, 'pending', (now?: number, visual?: boolean) => {
    if (failing) { failing = false; throw Error('Delivery ledger temporarily unavailable'); }
    return pending(now, visual);
  });
  let release!: () => void, started!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { started = resolve; });
  const patches: string[] = [];
  const outbox = new Outbox(state, { send: async () => {}, updateVisualReview: async (target, _body, _images, review) => {
    assert.equal(target, message);
    if (review.phase === 'reviewed') { started(); await delayed; }
    patches.push(review.phase);
  } });
  const first = outbox.flushVisual();
  const failure = assert.rejects(first, /ledger temporarily unavailable/);
  try {
    await arrived;
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(state.transaction(() => state.visualReviews.decide({ ...owner,id,message,decision:'merge' })), 'accepted');
    assert.equal(outbox.flushVisual(), first);
  } finally { release(); }
  await failure;
  await outbox.flushVisual();
  assert.deepEqual(patches, ['reviewed','merge-queued']);
  assert.deepEqual(state.visualReviews.pendingUpdates(Date.now()), []);
});

test('visual workflow timeout terminates an adapter that ignores SIGTERM', { timeout: 3000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-review-timeout-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'hanging-adapter');
  const adapter = '#!' + process.execPath + '\nprocess.on("SIGTERM", () => {}); setInterval(() => {}, 100);';
  writeFileSync(executable, adapter, { mode: 0o700 });
  const workflow = { executable, sha256: createHash('sha256').update(adapter).digest('hex'), base: 'main' };
  const repository = 'example/project';
  await assert.rejects(executeVisualOperation({ id: randomUUID(), action: 'merge',
    binding: { repository, commit: 'a'.repeat(40), pullRequest: 1, workflow } }, { [repository]: workflow }, 180),
  { signal: 'SIGKILL' });
});
