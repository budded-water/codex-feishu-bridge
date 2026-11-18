import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export function openHandoffReader(admission: string, transport: string, hub?: string): DatabaseSync {
  const db = new DatabaseSync(admission, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
    const attach = (name: 'transport' | 'hub', path: string) => {
      const url = pathToFileURL(path);
      url.searchParams.set('mode', 'ro');
      db.prepare('ATTACH DATABASE ? AS ' + name).run(url.href);
    };
    attach('transport', transport);
    if (hub !== undefined) attach('hub', hub);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function unprojectedTaskReplyNotices(db: DatabaseSync): { origin: string }[] {
  return db.prepare(`SELECT q.origin FROM task_replies q
    WHERE q.result IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transport.projected_control_notices n
      WHERE n.origin='task-reply/' || q.origin AND n.status=q.kind) ORDER BY q.rowid`).all() as { origin: string }[];
}
