import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ownerKey, type IncomingMessage } from '../types.js';

export const DEFAULT_MATTER = 'default';
export type Matter = { id: string; title: string };
type Scope = { owner: string; project: string };
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
            owner TEXT NOT NULL, project TEXT NOT NULL, choice TEXT NOT NULL, PRIMARY KEY(owner,project)
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
            message TEXT NOT NULL, choices TEXT NOT NULL, chosen TEXT, projected INTEGER NOT NULL DEFAULT 0
          );
          CREATE INDEX IF NOT EXISTS unprojected_matter_inputs ON matter_inputs(id) WHERE projected=0 AND chosen IS NULL;
        `);
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

  private setFocus(scope: Scope, choice: string): void {
    this.db.prepare(`INSERT INTO matter_focus VALUES (?,?,?) ON CONFLICT(owner,project) DO UPDATE SET choice=excluded.choice`)
      .run(scope.owner, scope.project, choice);
  }

  private decide<T>(message: IncomingMessage, work: () => T): T {
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

  select(scope: Scope, message: IncomingMessage, choice: string): boolean {
    return this.decide(message, () => {
      if (choice !== DEFAULT_MATTER && !this.owned(scope, choice)) return false;
      this.setFocus(scope, choice);
      return true;
    });
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

  held(message: IncomingMessage, project: string): HeldMatter | undefined {
    const row = this.db.prepare('SELECT id,message,choices,chosen FROM matter_inputs WHERE origin=? AND owner=? AND project=?')
      .get(origin(message), ownerKey(message), project) as { id: string; message: string; choices: string; chosen: string | null } | undefined;
    return row && { ...row, message: JSON.parse(row.message) as IncomingMessage, choices: JSON.parse(row.choices) as string[] };
  }

  hold(scope: Scope, message: IncomingMessage, choices: string[]): HeldMatter {
    return this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO matter_inputs(origin,id,owner,project,message,choices) VALUES (?,?,?,?,?,?)')
        .run(origin(message), randomUUID(), scope.owner, scope.project, JSON.stringify(message), JSON.stringify(choices));
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

  consume<T>(scope: Scope, id: string, choice: string, submit: (original: IncomingMessage) => T | undefined): T | undefined {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT message,choices,chosen FROM matter_inputs WHERE id=? AND owner=? AND project=?')
        .get(id, scope.owner, scope.project) as { message: string; choices: string; chosen: string | null } | undefined;
      if (!row || row.chosen || !(JSON.parse(row.choices) as string[]).includes(choice) ||
        (choice !== DEFAULT_MATTER && !this.owned(scope, choice))) return;
      const original = JSON.parse(row.message) as IncomingMessage;
      // Mark it consumed before admission in the same transaction. Admission
      // checks held messages so they cannot be scheduled by a duplicate ingress.
      this.db.prepare('UPDATE matter_inputs SET chosen=? WHERE id=?').run(choice, id);
      const value = submit(original);
      if (value === undefined) {
        this.db.prepare('UPDATE matter_inputs SET chosen=NULL WHERE id=?').run(id);
        return;
      }
      this.setFocus(scope, choice);
      return value;
    });
  }
}
