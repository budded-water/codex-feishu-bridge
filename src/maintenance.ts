import type { DatabaseSync } from 'node:sqlite';

export class Maintenance {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS maintenance (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL);
      INSERT OR IGNORE INTO maintenance VALUES (1,0);`);
  }
  get paused(): boolean { return Boolean((this.db.prepare('SELECT paused FROM maintenance WHERE id=1').get() as { paused: number }).paused); }
  quiesce(): void { this.db.prepare('UPDATE maintenance SET paused=1 WHERE id=1').run(); }
  resume(): void { this.db.prepare('UPDATE maintenance SET paused=0 WHERE id=1').run(); }
}
