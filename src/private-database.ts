import { mkdirSync, lstatSync, realpathSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openPrivateDatabase(directory: string, filename: 'bridge.db' | 'handoff.db'): DatabaseSync {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error('State directory must not be a symlink');
  chmodSync(realpathSync(directory), 0o700);
  const path = join(directory, filename);
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error('State database must not be a symlink');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    return db;
  } catch (error) { db.close(); throw error; }
}
