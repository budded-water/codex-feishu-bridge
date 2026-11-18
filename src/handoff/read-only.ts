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
