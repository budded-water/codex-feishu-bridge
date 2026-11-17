import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, lstatSync, mkdirSync, writeFileSync, renameSync, realpathSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import lockfile from 'proper-lockfile';
import { openPrivateDatabase } from './private-database.js';
import type { NativePermissions, NativeReview, RememberedCommand } from './permissions.js';
import { permissionParams, rememberProposal, parseNativeReview, deniedActionEvent } from './permissions.js';
import type { State } from './state.js';
import type { CodexPort, Session, RpcRequest, RpcEvent } from './types.js';

const run = promisify(execFile), digest = (s: string) => createHash('sha256').update(s).digest('hex');
const lineFor = (prefix: string[], decision: string) => `prefix_rule(pattern=[${prefix.map(x => JSON.stringify(x)).join(', ')}], decision=${JSON.stringify(decision)})`;
export interface PermissionScope { tenant: string; user: string; chat: string }
export interface RuleGrant {
  id: string; execution: string; prompt: string; generation: string; prefix: string[]; created: number;
  actor: string | null; status: 'proposed' | 'submitted' | 'present' | 'unconfirmed'; before: string | null;
}
export interface ReviewFact { id: string; execution: string; generation: string; review: NativeReview; published: boolean }

export class PermissionState {
  private db;
  readonly home: string;
  readonly rulesDirectory: string;
  readonly defaultFile: string;
  readonly revocationFile: string;
  constructor(directory: string, readonly scope: PermissionScope, readonly executable: string, home = process.env.CODEX_HOME ?? join(homedir(), '.codex')) {
    if (!isAbsolute(home)) throw Error('CODEX_HOME must be absolute for native rule management');
    this.home = existsSync(home) ? realpathSync(home) : resolve(home);
    this.rulesDirectory = join(this.home, 'rules');
    this.defaultFile = join(this.rulesDirectory, 'default.rules');
    this.revocationFile = join(this.rulesDirectory, 'codex-feishu-bridge-revocations.rules');
    this.db = openPrivateDatabase(join(directory, 'permissions'), 'bridge.db');
    this.db.exec(`CREATE TABLE IF NOT EXISTS binding(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, execution TEXT NOT NULL, prompt TEXT NOT NULL, generation TEXT NOT NULL,
        body TEXT NOT NULL, UNIQUE(execution,prompt,generation));
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, execution TEXT NOT NULL, generation TEXT NOT NULL, body TEXT NOT NULL, review_id TEXT NOT NULL,
        published INTEGER NOT NULL DEFAULT 0, UNIQUE(execution,generation,review_id));
      CREATE TABLE IF NOT EXISTS rule_changes(origin TEXT PRIMARY KEY, grant_id TEXT NOT NULL, revoked INTEGER NOT NULL, status TEXT NOT NULL);`);
    const binding = JSON.stringify({ scope, home: this.home });
    this.db.prepare('INSERT OR IGNORE INTO binding VALUES(1,?)').run(binding);
    if ((this.db.prepare('SELECT value FROM binding').get() as { value: string }).value !== binding) { this.db.close(); throw Error('Native permission ownership changed'); }
  }
  private file(path: string): string | null {
    if (existsSync(this.rulesDirectory) && (!lstatSync(this.rulesDirectory).isDirectory() || lstatSync(this.rulesDirectory).isSymbolicLink())) throw Error('Invalid native rules directory');
    try {
      const s = lstatSync(path);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 1024 * 1024) throw Error('Invalid native rules file');
      return readFileSync(path, 'utf8');
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  propose(execution: string, prompt: string, generation: string, prefix: string[]): RememberedCommand {
    const previous = this.db.prepare('SELECT body FROM grants WHERE execution=? AND prompt=? AND generation=?').get(execution, prompt, generation) as { body: string } | undefined;
    if (previous) { const p = JSON.parse(previous.body) as RuleGrant; if (JSON.stringify(p.prefix) !== JSON.stringify(prefix)) throw Error('Native proposal changed'); return { id: p.id, prefix, scope: 'codex-user' }; }
    const before = this.file(this.defaultFile), grant: RuleGrant = { id: randomUUID(), execution, prompt, generation, prefix, created: Date.now(), actor: null, status: 'proposed', before: before == null ? null : digest(before) };
    this.db.prepare('INSERT INTO grants VALUES(?,?,?,?,?)').run(grant.id, execution, prompt, generation, JSON.stringify(grant));
    return { id: grant.id, prefix: [...prefix], scope: 'codex-user' };
  }
  grants(): RuleGrant[] { return (this.db.prepare('SELECT body FROM grants ORDER BY rowid DESC LIMIT 100').all() as { body: string }[]).map(x => JSON.parse(x.body) as RuleGrant); }
  grant(id: string): RuleGrant | undefined { const row = this.db.prepare('SELECT body FROM grants WHERE id=?').get(id) as { body: string } | undefined; return row && JSON.parse(row.body) as RuleGrant; }
  submit(id: string, actor: string): void {
    const g = this.grant(id); if (!g || g.status !== 'proposed' || actor !== this.scope.user) throw Error('Invalid native persistent decision');
    g.actor = actor; g.status = 'submitted'; this.db.prepare('UPDATE grants SET body=? WHERE id=?').run(JSON.stringify(g), id);
  }
  observeSaves(execution?: string): void {
    for (const g of this.grants()) {
      if ((execution && execution !== g.execution) || !['submitted', 'unconfirmed'].includes(g.status)) continue;
      let status: RuleGrant['status'] = 'unconfirmed';
      try { if (this.file(this.defaultFile)?.split('\n').includes(lineFor(g.prefix, 'allow'))) status = 'present'; } catch { /* Presence cannot be inferred from a successful decision send. */ }
      if (g.status !== status) { g.status = status; this.db.prepare('UPDATE grants SET body=? WHERE id=?').run(JSON.stringify(g), g.id); }
    }
  }
  present(prefix: string[]): boolean { return Boolean(this.file(this.defaultFile)?.split('\n').includes(lineFor(prefix, 'allow'))); }
  async userRuleDecision(prefix: string[]): Promise<'allow' | 'prompt' | 'forbidden' | 'unverified'> {
    try {
      this.file(this.defaultFile);
      const names = existsSync(this.rulesDirectory) ? readdirSync(this.rulesDirectory).filter(n => n.endsWith('.rules')) : [];
      if (names.length > 100) return 'unverified';
      const files = names.map(n => join(this.rulesDirectory, n)).filter(p => this.file(p) != null);
      if (!files.length) return 'unverified';
      const { stdout } = await run(this.executable, ['execpolicy', 'check', '--pretty', ...files.flatMap(p => ['--rules', p]), '--', ...prefix], { timeout: 10_000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout);
      return ['allow', 'prompt', 'forbidden'].includes(result.decision) ? result.decision : 'unverified';
    } catch { return 'unverified'; }
  }
  private revocations(): string[][] {
    const raw = this.file(this.revocationFile);
    if (raw == null || !raw.trim()) return [];
    return raw.trimEnd().split('\n').map(line => {
      const match = /^prefix_rule\(pattern=(\[.*\]), decision="prompt"\)$/.exec(line);
      if (!match) throw Error('Owned revocation policy was changed outside the bridge');
      const value: unknown = JSON.parse(match[1]!);
      if (!Array.isArray(value) || value.some(x => typeof x !== 'string') || lineFor(value, 'prompt') !== line) throw Error('Invalid owned revocation policy');
      return value as string[];
    });
  }
  revoked(prefix: string[]): boolean { return this.revocations().some(x => JSON.stringify(x) === JSON.stringify(prefix)); }
  async setRevoked(id: string, revoked: boolean): Promise<void> {
    const g = this.grant(id); if (!g || !g.actor || !['present', 'unconfirmed'].includes(g.status)) throw Error('No submitted owned rule');
    this.file(this.defaultFile); mkdirSync(this.rulesDirectory, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.revocationFile, { realpath: false, retries: 0 });
    try {
      const original = this.file(this.revocationFile), entries = this.revocations().filter(x => JSON.stringify(x) !== JSON.stringify(g.prefix));
      if (revoked) entries.push(g.prefix);
      const body = entries.map(x => lineFor(x, 'prompt')).join('\n') + (entries.length ? '\n' : '');
      if (this.file(this.revocationFile) !== original) throw Error('Owned revocation policy changed concurrently');
      const temp = this.revocationFile + '.' + randomUUID() + '.tmp';
      try { writeFileSync(temp, body, { mode: 0o600, flag: 'wx' }); renameSync(temp, this.revocationFile); }
      finally { rmSync(temp, { force: true }); }
    } finally { await release(); }
  }
  async changeRule(origin: string, actor: string, id: string, revoked: boolean): Promise<'applied' | 'unknown'> {
    if (actor !== this.scope.user || !this.grant(id)?.actor) throw Error('No owned grant');
    const old = this.db.prepare('SELECT grant_id,revoked,status FROM rule_changes WHERE origin=?').get(origin) as { grant_id: string; revoked: number; status: string } | undefined;
    if (old) {
      if (old.grant_id !== id || Boolean(old.revoked) !== revoked) throw Error('Rule change identity differs');
      return old.status === 'applied' ? 'applied' : 'unknown';
    }
    this.db.prepare("INSERT INTO rule_changes VALUES(?,?,?,'intent')").run(origin, id, revoked ? 1 : 0);
    let status: 'applied' | 'unknown' = 'unknown';
    try { await this.setRevoked(id, revoked); if (this.revoked(this.grant(id)!.prefix) === revoked) status = 'applied'; }
    catch { /* An uncertain policy write is inspected, never automatically repeated. */ }
    this.db.prepare('UPDATE rule_changes SET status=? WHERE origin=?').run(status, origin);
    return status;
  }
  recordReview(execution: string, generation: string, review: NativeReview): ReviewFact {
    const old = this.db.prepare('SELECT id,body,published FROM reviews WHERE execution=? AND generation=? AND review_id=?').get(execution, generation, review.id) as { id: string; body: string; published: number } | undefined;
    if (old) { if (old.body !== JSON.stringify(review)) throw Error('Native review evidence changed'); return { id: old.id, execution, generation, review, published: Boolean(old.published) }; }
    const id = randomUUID(); this.db.prepare('INSERT INTO reviews(id,execution,generation,body,review_id) VALUES(?,?,?,?,?)').run(id, execution, generation, JSON.stringify(review), review.id);
    return { id, execution, generation, review, published: false };
  }
  reviews(kind: 'recent' | 'nonapproved' | 'unpublished' = 'recent'): ReviewFact[] {
    const where = kind === 'unpublished' ? " WHERE published=0 AND json_extract(body,'$.status')!='approved'" : kind === 'nonapproved' ? " WHERE json_extract(body,'$.status')!='approved'" : '';
    return (this.db.prepare('SELECT id,execution,generation,body,published FROM reviews' + where + ' ORDER BY rowid ' + (kind === 'unpublished' ? 'ASC' : 'DESC') + ' LIMIT 100').all() as
      { id: string; execution: string; generation: string; body: string; published: number }[]).map(x => ({ ...x, review: JSON.parse(x.body) as NativeReview, published: Boolean(x.published) }));
  }
  review(id: string): ReviewFact | undefined {
    const row = this.db.prepare('SELECT id,execution,generation,body,published FROM reviews WHERE id=?').get(id) as { id: string; execution: string; generation: string; body: string; published: number } | undefined;
    return row && { ...row, review: JSON.parse(row.body) as NativeReview, published: Boolean(row.published) };
  }
  published(id: string): void { this.db.prepare('UPDATE reviews SET published=1 WHERE id=?').run(id); }
  close(): void { this.db.close(); }
}

export class PermissionSession {
  constructor(readonly policy: NativePermissions, readonly ledger: PermissionState, readonly execution: string, private retry?: NativeReview) {}
  async authorize(codex: CodexPort, thread: string): Promise<void> {
    if (!this.retry) return;
    if (thread !== this.retry.thread) throw Error('Native retry conversation differs');
    await codex.request('thread/approveGuardianDeniedAction', { threadId: thread, event: deniedActionEvent(this.retry) });
  }
  permits(session: Pick<Session, 'tenant' | 'user' | 'chat'>): boolean {
    const s = this.ledger.scope; return session.tenant === s.tenant && session.user === s.user && session.chat === s.chat;
  }
  params(session: Session) { return this.permits(session) ? permissionParams(this.policy) : {}; }
  turnParams(session: Session) {
    if (!this.permits(session)) return {};
    return { approvalPolicy: 'on-request' as const, approvalsReviewer: this.policy.reviewer,
      sandboxPolicy: this.policy.sandbox === 'read-only' ? { type: 'readOnly' as const, networkAccess: false } :
        { type: 'workspaceWrite' as const, writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
  }
  proposal(rpc: RpcRequest, session: Session, token: string, generation: string, state: State): RememberedCommand | undefined {
    if (!this.policy.rememberCommands || !this.permits(session) || rpc.method !== 'item/commandExecution/requestApproval') return;
    const prefix = rememberProposal(rpc.params, s => state.redact(s));
    return prefix && this.ledger.propose(this.execution, token, generation, prefix);
  }
  observe(event: RpcEvent, session: Session, generation: string, state: State): void {
    if (!this.permits(session)) return;
    if (event.method === 'item/autoApprovalReview/completed') {
      const review = parseNativeReview(event.params);
      if (review) { state.recordNativeReview(generation, review); this.ledger.recordReview(this.execution, generation, review); }
    }
    this.ledger.observeSaves(this.execution);
  }
}
