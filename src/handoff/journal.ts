import { DatabaseSync } from 'node:sqlite';
import type { ControlDisposition } from '../types.js';

export interface JournalMessage {
  id: string; chat: string; body: string; reply_to: string | null; mentions: string | null;
  final: number; prompt_id: string | null; transient: number;
}
export interface JournalProjection {
  task?: { id: string; owner: string; trigger: string; directory: string; thread: string | null; turn: string | null };
  messages: JournalMessage[];
  prompts: { id: string; status: string; expires: number | null }[];
}

export function readJournal<T>(path: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path, { readOnly: true });
  try { db.exec('BEGIN'); return read(db); }
  finally { db.close(); }
}

export function journalProjection(path: string): JournalProjection {
  return readJournal(path, db => ({
    task: db.prepare(`SELECT tasks.id,sessions.owner,trigger_message AS trigger,directory,thread,turn
      FROM tasks JOIN sessions ON sessions.id=tasks.session LIMIT 1`).get() as JournalProjection['task'],
    messages: db.prepare(`SELECT id,chat,body,reply_to,mentions,final,prompt_id,task IS NOT NULL AS transient
      FROM outbox ORDER BY sequence`).all() as unknown as JournalMessage[],
    prompts: db.prepare('SELECT id,status,expires FROM approvals').all() as JournalProjection['prompts'],
  }));
}

export function journalControl(path: string, message: Pick<import('../types.js').IncomingMessage, 'tenant' | 'id'>): ControlDisposition | undefined {
  return readJournal(path, db => (db.prepare('SELECT status FROM relayed_controls WHERE origin=?')
    .get(JSON.stringify([message.tenant, message.id])) as { status: ControlDisposition } | undefined)?.status);
}
