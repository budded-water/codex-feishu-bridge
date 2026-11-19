import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ownerKey, type IncomingMessage } from '../types.js';
import type { MatterPresentation } from '../matter-card.js';

export const DEFAULT_MATTER = 'default';
export const DEFAULT_MATTER_TITLE = '默认对话';
export type Matter = { id: string; title: string };
type Scope = { owner: string; project: string };
export type MatterNotice = {
  message: IncomingMessage; text: string;
  card?: Omit<MatterPresentation, 'tenant' | 'chat' | 'user' | 'text'>;
};
export type HeldMatter = { id: string; message: IncomingMessage; choices: string[]; chosen: string | null };
const origin = (message: IncomingMessage) => JSON.stringify([message.tenant, message.id]);

export class MatterStore {
  constructor(private db: DatabaseSync, private transaction: <T>(work: () => T) => T) {
    // SQLite cannot drop the legacy UNIQUE constraint in place. Keep all IDs
    // and the names used by request foreign keys while replacing the table.
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      transaction(() => {
        const columns = db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[];
        if (!columns.some(c => c.name === 'title')) {
          db.exec(`
            CREATE TABLE matter_conversations (
              id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL,
              thread TEXT, last_execution TEXT, title TEXT
            );
            INSERT INTO matter_conversations(id,owner,project,thread,last_execution)
              SELECT id,owner,project,thread,last_execution FROM conversations;
            DROP TABLE conversations;
            ALTER TABLE matter_conversations RENAME TO conversations;
            CREATE UNIQUE INDEX default_conversation ON conversations(owner,project) WHERE title IS NULL;
            CREATE UNIQUE INDEX named_conversation ON conversations(owner,project,title) WHERE title IS NOT NULL;
          `);
          if (db.prepare('PRAGMA foreign_key_check').get()) throw Error('Matter migration would break a stored reference');
        }
        db.exec(`
          CREATE TABLE IF NOT EXISTS matter_focus (
            owner TEXT NOT NULL, project TEXT NOT NULL, choice TEXT NOT NULL,
            previous_choice TEXT, switch_after INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner,project)
          );
          CREATE TABLE IF NOT EXISTS matter_objects (
            owner TEXT NOT NULL, project TEXT NOT NULL, ref TEXT NOT NULL, conversation TEXT NOT NULL REFERENCES conversations(id),
            PRIMARY KEY(owner,project,ref)
          );
          CREATE TABLE IF NOT EXISTS matter_decisions (
            origin TEXT PRIMARY KEY, result TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS matter_inputs (
            origin TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, project TEXT NOT NULL,
            message TEXT NOT NULL, choices TEXT NOT NULL, input TEXT, chosen TEXT, projected INTEGER NOT NULL DEFAULT 0
          );
          CREATE INDEX IF NOT EXISTS unprojected_matter_inputs ON matter_inputs(id) WHERE projected=0 AND chosen IS NULL;
          CREATE TABLE IF NOT EXISTS matter_notices (
            origin TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL, projected INTEGER NOT NULL DEFAULT 0
          );
          CREATE INDEX IF NOT EXISTS unprojected_matter_notices ON matter_notices(origin) WHERE projected=0;
        `);
        const focusColumns = db.prepare('PRAGMA table_info(matter_focus)').all() as { name: string }[];
        if (!focusColumns.some(c => c.name === 'previous_choice')) db.exec('ALTER TABLE matter_focus ADD COLUMN previous_choice TEXT');
        if (!focusColumns.some(c => c.name === 'switch_after')) db.exec('ALTER TABLE matter_focus ADD COLUMN switch_after INTEGER NOT NULL DEFAULT 0');
      });
    } finally { db.exec('PRAGMA foreign_keys=ON'); }
  }

  owned(scope: Scope, id: string): Matter | undefined {
    return this.db.prepare('SELECT id,title FROM conversations WHERE owner=? AND project=? AND id=? AND title IS NOT NULL')
      .get(scope.owner, scope.project, id) as Matter | undefined;
  }

  named(scope: Scope, title: string): Matter | undefined {
    return this.db.prepare('SELECT id,title FROM conversations WHERE owner=? AND project=? AND title=?')
      .get(scope.owner, scope.project, title) as Matter | undefined;
  }

  list(scope: Scope, limit: number, offset = 0): Matter[] {
    return this.db.prepare('SELECT id,title FROM conversations WHERE owner=? AND project=? AND title IS NOT NULL ORDER BY rowid DESC LIMIT ? OFFSET ?')
      .all(scope.owner, scope.project, limit, offset) as Matter[];
  }

  focus(scope: Scope): string | undefined {
    return (this.db.prepare('SELECT choice FROM matter_focus WHERE owner=? AND project=?')
      .get(scope.owner, scope.project) as { choice: string } | undefined)?.choice;
  }

  previousFocusForFollowup(scope: Scope): string | undefined {
    // A submission records original admission even after the request is withdrawn.
    return (this.db.prepare(`SELECT f.previous_choice AS choice FROM matter_focus f WHERE f.owner=? AND f.project=?
      AND EXISTS (SELECT 1 FROM requests r JOIN submissions s ON s.request=r.id JOIN conversations c ON c.id=r.conversation
        WHERE c.owner=f.owner AND c.project=f.project AND COALESCE(CASE WHEN c.title IS NOT NULL THEN c.id END,?)=f.previous_choice
        AND r.rowid<=f.switch_after)
      AND NOT EXISTS (SELECT 1 FROM requests r JOIN submissions s ON s.request=r.id JOIN conversations c ON c.id=r.conversation
        WHERE c.owner=f.owner AND c.project=f.project AND COALESCE(CASE WHEN c.title IS NOT NULL THEN c.id END,?)=f.choice
        AND r.rowid>f.switch_after)`)
      .get(scope.owner, scope.project, DEFAULT_MATTER, DEFAULT_MATTER) as { choice: string } | undefined)?.choice;
  }

  private setFocus(scope: Scope, choice: string, clarified = false): void {
    const previous = this.focus(scope);
    if (!clarified && previous === choice) return;
    const from = previous ?? DEFAULT_MATTER;
    this.db.prepare(`INSERT INTO matter_focus(owner,project,choice,previous_choice,switch_after)
      VALUES (?,?,?,?,(SELECT COALESCE(MAX(rowid),0) FROM requests))
      ON CONFLICT(owner,project) DO UPDATE SET choice=excluded.choice,
        previous_choice=excluded.previous_choice,switch_after=excluded.switch_after`)
      .run(scope.owner, scope.project, choice, clarified || from === choice ? null : from);
  }

  decide<T>(message: IncomingMessage, work: () => T): T {
    return this.transaction(() => {
      const key = origin(message);
      const previous = this.db.prepare('SELECT result FROM matter_decisions WHERE origin=?').get(key) as { result: string } | undefined;
      if (previous) return JSON.parse(previous.result) as T;
      const result = work();
      this.db.prepare('INSERT INTO matter_decisions VALUES (?,?)').run(key, JSON.stringify(result));
      return result;
    });
  }

  create(scope: Scope, message: IncomingMessage, title: string): Matter {
    return this.decide(message, () => {
      this.db.prepare('INSERT OR IGNORE INTO conversations(id,owner,project) VALUES (?,?,?)')
        .run(randomUUID(), scope.owner, scope.project);
      const matter = this.named(scope, title) ?? { id: randomUUID(), title };
      this.db.prepare('INSERT OR IGNORE INTO conversations(id,owner,project,title) VALUES (?,?,?,?)')
        .run(matter.id, scope.owner, scope.project, title);
      this.setFocus(scope, matter.id);
      return matter;
    });
  }

  select(scope: Scope, choice: string): boolean {
    if (choice !== DEFAULT_MATTER && !this.owned(scope, choice)) return false;
    this.setFocus(scope, choice);
    return true;
  }

  bind(scope: Scope, message: IncomingMessage, ref: string): 'bound' | 'conflict' | 'no-matter' {
    return this.decide(message, () => {
      const current = this.focus(scope);
      if (!current || !this.owned(scope, current)) return 'no-matter';
      const bound = this.bound(scope, ref);
      if (bound && bound !== current) return 'conflict';
      this.db.prepare('INSERT OR IGNORE INTO matter_objects VALUES (?,?,?,?)').run(scope.owner, scope.project, ref, current);
      return 'bound';
    });
  }

  bound(scope: Scope, ref: string): string | undefined {
    return (this.db.prepare('SELECT conversation FROM matter_objects WHERE owner=? AND project=? AND ref=?')
      .get(scope.owner, scope.project, ref) as { conversation: string } | undefined)?.conversation;
  }

  notice(message: IncomingMessage): MatterNotice | undefined {
    const row = this.db.prepare('SELECT body FROM matter_notices WHERE origin=? AND owner=?')
      .get(origin(message), ownerKey(message)) as { body: string } | undefined;
    return row && JSON.parse(row.body) as MatterNotice;
  }

  retainNotice(message: IncomingMessage, build: () => Omit<MatterNotice, 'message'>): MatterNotice {
    return this.transaction(() => {
      const existing = this.notice(message);
      if (existing) return existing;
      const notice = { ...build(), message };
      this.db.prepare('INSERT INTO matter_notices(origin,owner,body) VALUES (?,?,?)')
        .run(origin(message), ownerKey(message), JSON.stringify(notice));
      return notice;
    });
  }

  unprojectedNotices(): MatterNotice[] {
    return (this.db.prepare('SELECT body FROM matter_notices WHERE projected=0').all() as { body: string }[])
      .map(row => JSON.parse(row.body) as MatterNotice);
  }

  noticeProjected(message: IncomingMessage): void {
    this.db.prepare('UPDATE matter_notices SET projected=1 WHERE origin=? AND owner=?').run(origin(message), ownerKey(message));
  }

  held(message: IncomingMessage, project: string): HeldMatter | undefined {
    const row = this.db.prepare('SELECT id,message,choices,chosen FROM matter_inputs WHERE origin=? AND owner=? AND project=?')
      .get(origin(message), ownerKey(message), project) as { id: string; message: string; choices: string; chosen: string | null } | undefined;
    return row && { ...row, message: JSON.parse(row.message) as IncomingMessage, choices: JSON.parse(row.choices) as string[] };
  }

  hold(scope: Scope, message: IncomingMessage, choices: string[], input?: string): HeldMatter {
    return this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO matter_inputs(origin,id,owner,project,message,choices,input) VALUES (?,?,?,?,?,?,?)')
        .run(origin(message), randomUUID(), scope.owner, scope.project, JSON.stringify(message), JSON.stringify(choices), input ?? null);
      return this.held(message, scope.project)!;
    });
  }

  unprojected(): HeldMatter[] {
    const rows = this.db.prepare('SELECT id,message,choices,chosen FROM matter_inputs WHERE projected=0 AND chosen IS NULL').all() as
      { id: string; message: string; choices: string; chosen: null }[];
    return rows.map(row => ({ ...row, message: JSON.parse(row.message) as IncomingMessage, choices: JSON.parse(row.choices) as string[] }));
  }

  projected(id: string): void {
    this.db.prepare('UPDATE matter_inputs SET projected=1 WHERE id=?').run(id);
  }

  consume<T>(scope: Scope, id: string, choice: string, submit: (original: IncomingMessage, input?: string) => T | undefined): T | undefined {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT message,choices,input,chosen FROM matter_inputs WHERE id=? AND owner=? AND project=?')
        .get(id, scope.owner, scope.project) as { message: string; choices: string; input: string | null; chosen: string | null } | undefined;
      if (!row || row.chosen || !(JSON.parse(row.choices) as string[]).includes(choice) ||
        (choice !== DEFAULT_MATTER && !this.owned(scope, choice))) return;
      const original = JSON.parse(row.message) as IncomingMessage;
      // Mark it consumed before admission in the same transaction. Admission
      // checks held messages so they cannot be scheduled by a duplicate ingress.
      this.db.prepare('UPDATE matter_inputs SET chosen=? WHERE id=?').run(choice, id);
      const value = submit(original, row.input ?? undefined);
      if (value === undefined) {
        this.db.prepare('UPDATE matter_inputs SET chosen=NULL WHERE id=?').run(id);
        return;
      }
      this.setFocus(scope, choice, true);
      return value;
    });
  }
}
