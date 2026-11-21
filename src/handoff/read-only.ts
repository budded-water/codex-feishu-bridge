import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { QUOTED_CONVERSATION_CHANGED } from './store.js';
import type { IncomingMessage } from '../types.js';

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

export function unprojectedTaskReplyNotices(db: DatabaseSync): { id: string; kind: 'reply' | 'thread-change' }[] {
  return db.prepare(`SELECT q.origin AS id, 'reply' AS kind FROM task_replies q
    WHERE q.result IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transport.projected_control_notices n
      WHERE n.origin='task-reply/' || q.origin AND n.status=q.kind)
    UNION ALL
    SELECT r.id, 'thread-change' FROM requests r LEFT JOIN transport.projected_tasks p ON p.execution=r.execution
    WHERE r.blocked=? AND COALESCE(p.notified,0)=0`).all(QUOTED_CONVERSATION_CHANGED) as { id: string; kind: 'reply' | 'thread-change' }[];
}

export function unprojectedAttachmentReceipts(db: DatabaseSync): IncomingMessage[] {
  const rows = db.prepare(`SELECT body FROM inbound_attachments a WHERE NOT EXISTS(
    SELECT 1 FROM transport.seen s WHERE s.tenant=json_extract(a.body,'$.tenant') AND s.id=json_extract(a.body,'$.id')) ORDER BY a.rowid`)
    .all() as { body: string }[];
  return rows.map(row => JSON.parse(row.body) as IncomingMessage);
}

export function pendingAttachmentRetirements(db: DatabaseSync): { id: string }[] {
  return db.prepare(`SELECT r.id FROM requests r
    JOIN reference_context ref ON ref.execution=r.execution AND ref.body IS NOT NULL
    LEFT JOIN executions e ON e.request=r.id
    LEFT JOIN submissions s ON s.request=r.id
    WHERE json_type(r.message,'$.attachment')='object' AND (
      (e.id IS NULL AND (r.blocked IS NOT NULL OR s.status='blocked'))
      OR (e.status IN ('completed','interrupted') AND EXISTS(
        SELECT 1 FROM transport.projected_tasks p WHERE p.execution=e.id AND p.checkpoint IS NOT NULL))
      OR (e.status='unknown' AND EXISTS(SELECT 1 FROM recoveries WHERE execution=e.id)
        AND NOT EXISTS(SELECT 1 FROM guards WHERE execution=e.id)))`)
    .all() as { id: string }[];
}
