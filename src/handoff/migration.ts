import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, lstatSync, chmodSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadConfig, type Config } from '../config.js';
import { State } from '../state.js';
import { ownerKey, record } from '../types.js';
import { CODEX_VERSION } from '../codex/generated/version.js';
import { PilotAdmission, type PilotScope } from './gateway.js';
import { NativeExecutions } from './native.js';
import { acquireRoot, controllerFile, fenceFile, privateRecord, readFence, requireClosed, writePrivate, verifyImportedState } from './ownership.js';

type Row = Record<string, string | number | null>;
export interface MigrationPlan {
  config: Config; scope: PilotScope; botOpenId: string; sourceSession: string | null;
  legacyDirectory: string; pilotDirectory: string; bundleDirectory: string; workerClosureReference: string;
}
interface Bundle {
  version: 1; protocol: string; operation: string; plan: string; created: string;
  legacy: string; pilot: string; transport: string; pilotFacts: string; transportFacts: string;
}
const fingerprint = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const bundleFile = 'handoff-bundle.json';
const planHash = (plan: MigrationPlan) => fingerprint(canonical(plan));

function destination(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Migration paths must be absolute');
  const path = resolve(value);
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw new Error('Invalid migration directory');
    return realpathSync(path);
  }
  return join(realpathSync(dirname(path)), basename(path));
}

export function loadMigrationPlan(path: string): MigrationPlan {
  const value = privateRecord(path);
  if (value.version !== 1 || typeof value.bridgeConfig !== 'string' || !isAbsolute(value.bridgeConfig)) throw new Error('Invalid migration plan');
  const config = loadConfig(value.bridgeConfig);
  const scope = record(value.scope) as unknown as PilotScope;
  for (const field of ['installation', 'tenant', 'operator', 'chat', 'pilot', 'hubInstance', 'source', 'rule', 'agent', 'agentUse'] as const) {
    if (typeof scope[field] !== 'string' || !scope[field].trim() || scope[field].length > 200) throw new Error('Invalid migration pilot scope');
  }
  const projects = Object.create(null) as Record<string, string>;
  for (const [alias, directory] of Object.entries(record(scope.projects))) {
    if (typeof directory !== 'string' || !isAbsolute(directory) || realpathSync(directory) !== config.projects[alias]) throw new Error('Migration project registry changed');
    projects[alias] = realpathSync(directory);
  }
  if (!Object.hasOwn(projects, scope.pilot) || (config.allowedTenant && config.allowedTenant !== scope.tenant) ||
    (config.accessMode === 'allowlist' && !config.allowedUsers.includes(scope.operator))) throw new Error('Migration scope is not admitted');
  if (typeof value.botOpenId !== 'string' || !/^ou_[\w-]+$/.test(value.botOpenId) ||
    (value.sourceSession !== null && (typeof value.sourceSession !== 'string' || !value.sourceSession)) ||
    typeof value.workerClosureReference !== 'string' || !value.workerClosureReference.trim() || value.workerClosureReference.length > 2000) throw new Error('Migration needs bot, conversation and worker closure evidence');
  const legacyDirectory = realpathSync(config.stateDirectory);
  const pilotDirectory = destination(value.pilotDirectory), bundleDirectory = destination(value.bundleDirectory);
  const overlaps = (a: string, b: string) => { const path = relative(a, b); return !path || (!path.startsWith('..') && !isAbsolute(path)); };
  if (legacyDirectory === pilotDirectory || overlaps(pilotDirectory, bundleDirectory) || overlaps(bundleDirectory, pilotDirectory) ||
    overlaps(pilotDirectory, legacyDirectory) || overlaps(bundleDirectory, legacyDirectory)) throw new Error('Migration directories overlap');
  return { config, scope: { ...scope, projects }, botOpenId: value.botOpenId, sourceSession: value.sourceSession as string | null,
    legacyDirectory, pilotDirectory, bundleDirectory, workerClosureReference: value.workerClosureReference };
}

function hashFile(path: string): string {
  const file = lstatSync(path);
  if (!file.isFile() || file.isSymbolicLink()) throw new Error('Invalid migration data file');
  return fingerprint(readFileSync(path));
}

function database<T>(path: string, writable: boolean, work: (db: DatabaseSync) => T): T {
  hashFile(path);
  const db = new DatabaseSync(path, { readOnly: !writable });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (!writable) db.exec('BEGIN');
    const result = db.prepare('PRAGMA quick_check').get() as Record<string, unknown>;
    if (Object.values(result)[0] !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('State integrity check failed');
    return work(db);
  } finally { db.close(); }
}

function column(row: Row, key: string): string | number | null {
  const value = row[key];
  if (value === undefined) throw new Error('Missing state column');
  return value;
}

const rows = (db: DatabaseSync, table: string): Row[] => db.prepare('SELECT * FROM ' + table).all() as Row[];
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
function facts(path: string): string {
  return database(path, false, db => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='maintenance' ORDER BY name").all() as { name: string }[];
    return fingerprint(canonical(tables.map(({ name }) => ({ name, rows: rows(db, '"' + name.replaceAll('"', '""') + '"').map(canonical).sort() }))));
  });
}

function checkLegacy(path: string): void {
  database(path, false, db => {
    if (!Number((db.prepare('SELECT paused FROM maintenance').get() as Row).paused)) throw new Error('Legacy admission must be quiesced');
    const pending = count(db, "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running')") +
      count(db, "SELECT COUNT(*) AS n FROM approvals WHERE status='pending'") + count(db, 'SELECT COUNT(*) AS n FROM outbox') +
      count(db, 'SELECT COUNT(*) AS n FROM feedback') + count(db, 'SELECT COUNT(*) AS n FROM routing WHERE pending IS NOT NULL') +
      count(db, "SELECT COUNT(*) AS n FROM tasks WHERE status='unknown' AND NOT EXISTS(SELECT 1 FROM migration_reconciliations WHERE task=tasks.id)");
    if (pending) throw new Error('Legacy work, delivery or uncertainty has not drained');
    const sessions = new Map(rows(db, 'sessions').map(row => [column(row, 'id'), row]));
    for (const session of sessions.values()) {
      if (typeof session.id !== 'string' || typeof session.tenant !== 'string' || typeof session.user !== 'string' || typeof session.chat !== 'string' ||
        session.owner !== ownerKey({ tenant: session.tenant, user: session.user, chat: session.chat })) throw new Error('Session ownership changed');
    }
    const tasks = new Map(rows(db, 'tasks').map(row => [column(row, 'id'), row]));
    for (const task of tasks.values()) {
      if (!sessions.has(column(task, 'session'))) throw new Error('Missing task conversation');
      const source = task.source ? record(JSON.parse(String(task.source))) : {};
      if (typeof task.id !== 'string' || typeof task.input !== 'string' || (source.id !== undefined && typeof source.id !== 'string')) throw new Error('Invalid retained task identity');
    }
    for (const selection of rows(db, 'selections')) if (sessions.get(column(selection, 'session'))?.owner !== selection.owner) throw new Error('Selection ownership changed');
    for (const reply of rows(db, 'task_messages')) if (!tasks.has(column(reply, 'task')) || !reply.chat) throw new Error('Missing reply association');
  });
}

function seedPilot(plan: MigrationPlan, source: string, temporary: string, operation: string): void {
  const admission = new PilotAdmission(temporary, plan.scope);
  try {
    admission.store.bindChannel('feishu', plan.botOpenId);
    database(source, false, db => {
      let conversation = null;
      if (plan.sourceSession !== null) {
        const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(plan.sourceSession) as Row | undefined;
        const owner = ownerKey({ tenant: plan.scope.tenant, user: plan.scope.operator, chat: plan.scope.chat });
        if (!session || session.owner !== owner || session.directory !== admission.directory || plan.config.projects[String(session.project)] !== admission.directory) throw new Error('Selected legacy conversation does not belong to this pilot');
        conversation = { id: String(session.id), owner, project: admission.project, thread: session.thread as string | null };
      }
      admission.store.importLegacy(rows(db, 'seen') as unknown as { tenant: string; id: string }[], conversation);
    });
  } finally { admission.close(); }
  mkdirSync(join(temporary, 'transport'), { mode: 0o700 });
  copyFileSync(source, join(temporary, 'transport/bridge.db'), constants.COPYFILE_EXCL);
  chmodSync(join(temporary, 'transport/bridge.db'), 0o600);
  for (const name of ['handoff.db', 'transport/bridge.db']) database(join(temporary, name), true, db => {
    db.exec('CREATE TABLE handoff_import(id INTEGER PRIMARY KEY CHECK(id=1), operation TEXT NOT NULL)');
    db.prepare('INSERT INTO handoff_import VALUES (1,?)').run(operation);
  });
}

function readBundle(plan: MigrationPlan, preparing = false): Bundle {
  const value = privateRecord(join(plan.bundleDirectory, bundleFile));
  if (value.version !== 1 || value.protocol !== CODEX_VERSION || value.plan !== planHash(plan) || typeof value.operation !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(value.operation) || typeof value.legacy !== 'string') throw new Error('Handoff bundle is incompatible with this plan');
  if (!preparing && ['pilot', 'transport', 'pilotFacts', 'transportFacts'].some(key => typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/.test(String(value[key])))) throw new Error('Incomplete handoff import metadata');
  const snapshot = join(plan.bundleDirectory, 'legacy.db');
  if ((!preparing || existsSync(snapshot)) && hashFile(snapshot) !== value.legacy) throw new Error('Legacy snapshot changed');
  return value as unknown as Bundle;
}

export async function stageHandoff(plan: MigrationPlan) {
  const existing = readFence(plan.legacyDirectory);
  if (existing?.role === 'legacy' && existsSync(join(plan.bundleDirectory, bundleFile))) {
    const saved = readBundle(plan);
    if (existing.operation === saved.operation && existsSync(join(plan.bundleDirectory, 'handoff-operation.json'))) {
      return { operation: saved.operation, staged: false, restored: true, repeated: true };
    }
  }
  if (existing?.role === 'pilot') {
    const saved = readBundle(plan);
    if (existing.operation !== saved.operation || existing.data !== plan.pilotDirectory) throw new Error('Another handoff owns this state');
    verifyImportedState(plan.pilotDirectory, saved.operation);
    return { operation: saved.operation, staged: true, repeated: true };
  }
  const lease = await acquireRoot(plan.legacyDirectory, 'legacy', plan.legacyDirectory);
  try {
    let saved: Bundle | undefined;
    if (existsSync(join(plan.bundleDirectory, bundleFile))) saved = readBundle(plan, true);
    if (!saved) {
      requireClosed(plan.legacyDirectory, 'legacy', plan.legacyDirectory);
      checkLegacy(join(plan.legacyDirectory, 'bridge.db'));
      if (!existsSync(plan.bundleDirectory)) mkdirSync(plan.bundleDirectory, { mode: 0o700 });
      else if (readdirSync(plan.bundleDirectory).length) throw new Error('Bundle directory contains unrelated data');
      saved = { version: 1, protocol: CODEX_VERSION, operation: randomUUID(), plan: planHash(plan), created: new Date().toISOString(),
        legacy: hashFile(join(plan.legacyDirectory, 'bridge.db')), pilot: '', transport: '', pilotFacts: '', transportFacts: '' };
      writePrivate(join(plan.bundleDirectory, bundleFile), saved);
    }
    if (hashFile(join(plan.legacyDirectory, 'bridge.db')) !== saved.legacy) throw new Error('Legacy state changed after export');
    if (!existsSync(join(plan.bundleDirectory, 'legacy.db'))) copyClosed(join(plan.legacyDirectory, 'bridge.db'), join(plan.bundleDirectory, 'legacy.db'));
    const controller = privateRecord(join(plan.legacyDirectory, controllerFile));
    if (controller.role === 'legacy') requireClosed(plan.legacyDirectory, 'legacy', plan.legacyDirectory);
    else {
      requireClosed(plan.legacyDirectory, 'pilot', plan.pilotDirectory);
      if (controller.epoch !== saved.operation) throw new Error('Consumer closure is unconfirmed');
    }
    if (!existsSync(plan.pilotDirectory)) {
      const temporary = plan.pilotDirectory + '.stage-' + saved.operation;
      rmSync(temporary, { recursive: true, force: true });
      mkdirSync(temporary, { mode: 0o700 });
      try {
        seedPilot(plan, join(plan.bundleDirectory, 'legacy.db'), temporary, saved.operation);
        saved.pilot = hashFile(join(temporary, 'handoff.db'));
        saved.transport = hashFile(join(temporary, 'transport/bridge.db'));
        saved.pilotFacts = facts(join(temporary, 'handoff.db'));
        saved.transportFacts = facts(join(temporary, 'transport/bridge.db'));
        writePrivate(join(plan.bundleDirectory, bundleFile), saved);
        renameSync(temporary, plan.pilotDirectory);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    } else if (hashFile(join(plan.pilotDirectory, 'handoff.db')) !== saved.pilot ||
      hashFile(join(plan.pilotDirectory, 'transport/bridge.db')) !== saved.transport) throw new Error('Existing pilot state is not the prepared import');
    lease.assertHeld();
    writePrivate(join(plan.legacyDirectory, controllerFile), { version: 1, protocol: CODEX_VERSION, root: plan.legacyDirectory,
      role: 'pilot', data: plan.pilotDirectory, epoch: saved.operation, phase: 'closed' });
    writePrivate(join(plan.legacyDirectory, fenceFile), { version: 1, role: 'pilot', root: plan.legacyDirectory, data: plan.pilotDirectory, operation: saved.operation });
    return { operation: saved.operation, staged: true, repeated: false };
  } finally { await lease.release(); }
}

async function checkPilot(plan: MigrationPlan): Promise<void> {
  const admission = new PilotAdmission(plan.pilotDirectory, plan.scope);
  const transport = new State(join(plan.pilotDirectory, 'transport'));
  try {
    const status = admission.store.drainStatus();
    const delivery = transport.drainStatus();
    if (!status.paused || Object.entries(status).some(([key, value]) => key !== 'paused' && value !== 0) ||
      delivery.outbox !== 0 || delivery.reactions !== 0 || delivery.prompts !== 0) throw new Error('Pilot work, delivery or uncertainty has not drained');
    const native = new NativeExecutions(admission, plan.config);
    const checkpoints = database(join(plan.pilotDirectory, 'transport/bridge.db'), false, db => new Map(rows(db, 'projected_tasks')
      .map(row => [column(row, 'execution'), column(row, 'checkpoint')])));
    for (const request of admission.store.requests()) if (!checkpoints.has(request.execution)) throw new Error('Accepted request has no transport projection');
    const uncertain: string[] = [];
    database(join(plan.pilotDirectory, 'handoff.db'), false, db => {
      for (const execution of rows(db, 'executions')) {
        if (execution.status === 'completed' || execution.status === 'interrupted') {
          const report = native.evidence(String(column(execution, 'id')));
          if (checkpoints.get(column(execution, 'id')) !== report.checkpoint) throw new Error('Native final delivery has not been projected');
        }
        else {
          if (execution.status !== 'unknown' || !db.prepare('SELECT 1 FROM recoveries WHERE execution=?').get(column(execution, 'id'))) throw new Error('Native outcome is unresolved');
          uncertain.push(String(column(execution, 'id')));
        }
      }
    });
    for (const execution of uncertain) {
      let live = false;
      try { await native.inspect(execution); live = true; } catch { /* Operator evidence still owns external-effect settlement. */ }
      if (live) throw new Error('An execution owner is still live');
    }
  } finally { transport.close(); admission.close(); }
}

function copyClosed(source: string, target: string): string {
  const before = hashFile(source);
  copyFileSync(source, target, constants.COPYFILE_EXCL);
  chmodSync(target, 0o400);
  if (hashFile(source) !== before || hashFile(target) !== before) throw new Error('Source changed during export');
  return before;
}

function mergePilot(plan: MigrationPlan, source: string, transportPath: string, target: string): void {
  database(source, false, pilot => database(transportPath, false, transport => database(target, true, legacy => {
    legacy.exec('BEGIN IMMEDIATE');
    try {
      const requests = rows(pilot, 'requests');
      const conversations = new Map(rows(pilot, 'conversations').map(row => [column(row, 'id'), row]));
      const incomingTasks = new Set<string>();
      const insertSeen = (tenant: string, id: string) => legacy.prepare('INSERT OR IGNORE INTO seen VALUES (?,?)').run(tenant, id);
      for (const row of rows(pilot, 'retained_receipts')) insertSeen(String(row.tenant), String(column(row, 'message')));
      for (const row of rows(transport, 'seen')) insertSeen(String(row.tenant), String(column(row, 'id')));
      for (const table of ['controls', 'recoveries']) for (const row of rows(pilot, table)) {
        const origin: unknown = JSON.parse(String(row.origin));
        if (!Array.isArray(origin) || origin.length !== 2 || origin.some(item => typeof item !== 'string')) throw new Error('Invalid retained control identity');
        insertSeen(origin[0], origin[1]);
      }
      for (const request of requests) {
        const message = record(JSON.parse(String(request.message)));
        const conversation = conversations.get(column(request, 'conversation'));
        if (!conversation || message.tenant !== plan.scope.tenant || message.user !== plan.scope.operator || message.chat !== plan.scope.chat ||
          typeof message.id !== 'string' || column(conversation, 'owner') !== ownerKey(message as unknown as { tenant: string; user: string; chat: string })) throw new Error('Pilot request ownership changed');
        const existing = legacy.prepare('SELECT * FROM sessions WHERE id=?').get(column(conversation, 'id')) as Row | undefined;
        if (existing && (existing.owner !== column(conversation, 'owner') || existing.directory !== plan.scope.projects[plan.scope.pilot])) throw new Error('Conversation identity conflicts with legacy state');
        if (!existing) legacy.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)').run(column(conversation, 'id'), column(conversation, 'owner'),
          plan.scope.tenant, plan.scope.operator, plan.scope.chat, plan.scope.pilot, plan.scope.projects[plan.scope.pilot]!, column(conversation, 'thread'));
        else legacy.prepare('UPDATE sessions SET thread=? WHERE id=?').run(column(conversation, 'thread'), column(conversation, 'id'));
        const execution = pilot.prepare('SELECT * FROM executions WHERE id=?').get(column(request, 'execution')) as Row | undefined;
        if (legacy.prepare('SELECT 1 FROM tasks WHERE id=?').get(column(request, 'execution'))) throw new Error('Task identity conflicts with legacy state');
        const sourceRecord = { id: message.id, ...(message.chatType ? { chatType: message.chatType } : {}),
          ...(message.createTime ? { createTime: message.createTime } : {}), ...(message.parentId ? { parentId: message.parentId } : {}) };
        const projected = transport.prepare('SELECT created_at,finished_at,feedback_at,delivered_at FROM tasks WHERE id=?').get(column(request, 'execution')) as Row;
        legacy.prepare(`INSERT INTO tasks(id,session,input,status,turn,source,routed,trigger_message,created_at,finished_at,feedback_at,delivered_at)
          VALUES (?,?,?,?,?,?,1,?,?,?,?,?)`).run(column(request, 'execution'), column(conversation, 'id'), column(request, 'input'), execution?.status ?? 'interrupted',
          execution?.native_turn ?? null, JSON.stringify(sourceRecord), message.id, column(projected, 'created_at'), column(projected, 'finished_at'),
          column(projected, 'feedback_at'), column(projected, 'delivered_at'));
        incomingTasks.add(String(column(request, 'execution')));
        insertSeen(String(message.tenant), message.id);
        if (execution?.status === 'unknown') {
          const proof = pilot.prepare('SELECT evidence FROM recoveries WHERE execution=? ORDER BY created DESC LIMIT 1').get(column(execution, 'id')) as Row;
          legacy.prepare('INSERT INTO migration_reconciliations VALUES (?,?)').run(column(request, 'execution'), column(proof, 'evidence'));
        }
        legacy.prepare(`INSERT INTO selections(owner,session,revision) VALUES (?,?,1)
          ON CONFLICT(owner) DO UPDATE SET session=excluded.session,revision=selections.revision+1`).run(column(conversation, 'owner'), column(conversation, 'id'));
      }
      for (const row of rows(transport, 'task_messages')) {
        if (!incomingTasks.has(String(column(row, 'task')))) continue;
        const existing = legacy.prepare('SELECT * FROM task_messages WHERE message=?').get(column(row, 'message')) as Row | undefined;
        if (existing && (existing.task !== column(row, 'task') || existing.chat !== column(row, 'chat'))) throw new Error('Reply identity conflicts with legacy state');
        legacy.prepare('INSERT OR IGNORE INTO task_messages(message,task,chat) VALUES (?,?,?)').run(column(row, 'message'), column(row, 'task'), column(row, 'chat'));
      }
      for (const row of rows(transport, 'approvals')) {
        if (!incomingTasks.has(String(column(row, 'task')))) continue;
        legacy.prepare('INSERT INTO approvals(id,task,method,status,created,expires,actor) VALUES (?,?,?,?,?,?,?)')
          .run(column(row, 'id'), column(row, 'task'), column(row, 'method'), column(row, 'status'), column(row, 'created'), column(row, 'expires'), column(row, 'actor'));
      }
      legacy.prepare('UPDATE maintenance SET paused=1').run();
      legacy.exec('COMMIT');
    } catch (error) { legacy.exec('ROLLBACK'); throw error; }
  })));
}

export async function rollbackHandoff(plan: MigrationPlan) {
  const saved = readBundle(plan);
  const fence = readFence(plan.legacyDirectory);
  if (fence?.role === 'legacy' && fence.operation === saved.operation) return { restored: true, repeated: true };
  if (!fence || fence.operation !== saved.operation) throw new Error('This plan does not own the pilot');
  const lease = await acquireRoot(plan.legacyDirectory, 'pilot', plan.pilotDirectory);
  try {
    const previousPath = join(plan.bundleDirectory, 'handoff-operation.json');
    const previous = existsSync(previousPath) ? privateRecord(previousPath) : undefined;
    if (previous && (previous.version !== 1 || previous.operation !== saved.operation || typeof previous.restoredHash !== 'string')) throw new Error('Rollback receipt is incompatible');
    const currentLegacy = hashFile(join(plan.legacyDirectory, 'bridge.db'));
    const controller = privateRecord(join(plan.legacyDirectory, controllerFile));
    if (controller.role === 'legacy' && controller.epoch === saved.operation && previous?.restoredHash === currentLegacy) {
      requireClosed(plan.legacyDirectory, 'legacy', plan.legacyDirectory);
    } else requireClosed(plan.legacyDirectory, 'pilot', plan.pilotDirectory);
    verifyImportedState(plan.pilotDirectory, saved.operation);
    await checkPilot(plan);
    if (currentLegacy !== saved.legacy && currentLegacy !== previous?.restoredHash) throw new Error('Legacy state changed outside this handoff');
    const archive = join(plan.bundleDirectory, 'rollback-' + randomUUID());
    mkdirSync(archive, { mode: 0o700 });
    const pilotHash = copyClosed(join(plan.pilotDirectory, 'handoff.db'), join(archive, 'handoff.db'));
    const transportHash = copyClosed(join(plan.pilotDirectory, 'transport/bridge.db'), join(archive, 'transport.db'));
    const nativeFiles: Record<string, string> = {};
    const executions = join(plan.pilotDirectory, 'executions');
    if (existsSync(executions)) for (const execution of readdirSync(executions)) {
      if (/^[0-9a-f-]{36}\.lock$/.test(execution) && lstatSync(join(executions, execution)).isDirectory()) continue;
      if (!/^[0-9a-f-]{36}$/.test(execution)) throw new Error('Unsettled execution artifact');
      const source = join(executions, execution);
      if (!lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink()) throw new Error('Invalid native archive');
      const directory = join(archive, execution); mkdirSync(directory, { mode: 0o700 });
      for (const name of readdirSync(source)) {
        if (!['bridge.db', 'bridge.db-journal', 'native-owner.json', 'native-result.json'].includes(name) && !/^native-result\.json\.[0-9a-f-]{36}\.tmp$/.test(name)) throw new Error('Unexpected native state artifact');
        nativeFiles[execution + '/' + name] = copyClosed(join(source, name), join(directory, name));
      }
    }
    const beforeTraffic = facts(join(archive, 'handoff.db')) === saved.pilotFacts && facts(join(archive, 'transport.db')) === saved.transportFacts;
    const temporary = join(archive, 'restored.db');
    copyFileSync(join(plan.bundleDirectory, 'legacy.db'), temporary, constants.COPYFILE_EXCL); chmodSync(temporary, 0o600);
    if (!beforeTraffic) mergePilot(plan, join(archive, 'handoff.db'), join(archive, 'transport.db'), temporary);
    checkLegacy(temporary);
    const restoredHash = hashFile(temporary);
    writePrivate(previousPath, { version: 1, operation: saved.operation, archive: basename(archive), pilotHash, transportHash,
      restoredHash, nativeFiles, window: beforeTraffic ? 'before-traffic' : 'after-traffic', workerClosureReference: plan.workerClosureReference });
    if (hashFile(join(plan.pilotDirectory, 'handoff.db')) !== pilotHash || hashFile(join(plan.pilotDirectory, 'transport/bridge.db')) !== transportHash) throw new Error('Pilot state changed during rollback preparation');
    const replacement = join(plan.legacyDirectory, 'bridge.db.restore-' + saved.operation);
    copyFileSync(temporary, replacement); chmodSync(replacement, 0o600);
    lease.assertHeld();
    renameSync(replacement, join(plan.legacyDirectory, 'bridge.db'));
    lease.assertHeld();
    writePrivate(join(plan.legacyDirectory, controllerFile), { version: 1, protocol: CODEX_VERSION, root: plan.legacyDirectory,
      role: 'legacy', data: plan.legacyDirectory, epoch: saved.operation, phase: 'closed' });
    writePrivate(join(plan.legacyDirectory, fenceFile), { version: 1, role: 'legacy', root: plan.legacyDirectory, data: plan.legacyDirectory, operation: saved.operation });
    return { restored: true, repeated: false, window: beforeTraffic ? 'before-traffic' : 'after-traffic' };
  } finally { await lease.release(); }
}

export function inspectLegacy(plan: MigrationPlan) {
  return database(join(plan.legacyDirectory, 'bridge.db'), false, db => {
    const owner = ownerKey({ tenant: plan.scope.tenant, user: plan.scope.operator, chat: plan.scope.chat });
    const sessions = db.prepare(`SELECT sessions.id,sessions.project,sessions.thread,selections.session=sessions.id AS selected
      FROM sessions LEFT JOIN selections ON selections.owner=sessions.owner WHERE sessions.owner=? AND sessions.directory=?`)
      .all(owner, plan.scope.projects[plan.scope.pilot]!) as Row[];
    const unresolved = db.prepare(`SELECT tasks.id,tasks.turn,sessions.project,sessions.thread FROM tasks JOIN sessions ON sessions.id=tasks.session
      WHERE tasks.status='unknown' AND NOT EXISTS(SELECT 1 FROM migration_reconciliations WHERE task=tasks.id)`).all() as Row[];
    return { sessions, unresolved };
  });
}
