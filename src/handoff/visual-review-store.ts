import type { DatabaseSync } from 'node:sqlite';
import type { CardResult } from '../approval.js';
import type { VisualAttachment, VisualPhase, VisualReviewClick, VisualReviewView } from '../visual-review.js';
import type { IncomingMessage } from '../types.js';
import type { VisualOperation, VisualOperationResult, VisualReviewBinding } from './visual-review-workflow.js';

interface ReviewRow {
  id: string;
  chat: string;
  tenant: string;
  actor: string;
  body: string;
  binding: string;
  phase: VisualPhase;
  mergeCommit: string | null;
  result: string | null;
  message: string | null;
  images: string | null;
  revision: number;
}

export class VisualReviewStore {
  constructor(private db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS visual_review_cards (
        id TEXT PRIMARY KEY, chat TEXT NOT NULL, tenant TEXT NOT NULL, actor TEXT NOT NULL, body TEXT NOT NULL, binding TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'pending', mergeCommit TEXT, result TEXT,
        message TEXT UNIQUE, images TEXT, revision INTEGER NOT NULL DEFAULT 0,
        rendered INTEGER NOT NULL DEFAULT 0, next INTEGER NOT NULL DEFAULT 0,
        reviewedAt INTEGER, mergeApprovedAt INTEGER, uploadApprovedAt INTEGER
      )
    `);
  }

  register(id: string, owner: Pick<IncomingMessage, 'chat' | 'tenant' | 'user'>, body: string, binding: VisualReviewBinding) {
    this.db.prepare('INSERT INTO visual_review_cards(id,chat,tenant,actor,body,binding) VALUES(?,?,?,?,?,?)')
      .run(id, owner.chat, owner.tenant, owner.user, body, JSON.stringify(binding));
  }

  delivered(id: string, message: string, images: VisualAttachment[]) {
    this.db.prepare('UPDATE visual_review_cards SET message=?,images=? WHERE id=? AND (message IS NULL OR message=?)')
      .run(message, JSON.stringify(images), id, message);
  }

  view(id: string): VisualReviewView | undefined {
    const row = this.row(id);
    return row && this.presentation(row);
  }

  context(message: string): string | undefined {
    const row = this.db.prepare('SELECT * FROM visual_review_cards WHERE message=?').get(message) as unknown as ReviewRow | undefined;
    if (!row) return;
    const { phase, binding, mergeCommit, result } = this.presentation(row);
    return JSON.stringify({ repository: binding.repository, candidate: binding.commit, pullRequest: binding.pullRequest, phase, mergeCommit, result });
  }

  decide(click: VisualReviewClick): CardResult {
    const row = this.row(click.id);
    if (!row || row.message !== click.message || row.chat !== click.chat || row.tenant !== click.tenant ||
        row.actor !== click.user || !row.images) return 'rejected';
    const binding = JSON.parse(row.binding) as VisualReviewBinding;
    if (click.decision === 'accept') {
      if (row.phase !== 'pending') return 'duplicate';
      this.db.prepare('UPDATE visual_review_cards SET reviewedAt=? WHERE id=?').run(Date.now(), row.id);
      this.transition(row.id, 'reviewed');
    } else if (click.decision === 'merge') {
      if (!binding.pullRequest || !binding.workflow) return 'rejected';
      if (row.phase !== 'pending' && row.phase !== 'reviewed') return 'duplicate';
      // Other cards for the same PR may still be visible. Never use them to
      // relaunch an in-flight or uncertain write against that PR.
      if (this.db.prepare(`SELECT 1 FROM visual_review_cards WHERE id<>? AND
        json_extract(binding,'$.repository')=? AND json_extract(binding,'$.pullRequest')=? AND
        phase NOT IN ('pending','reviewed','merge-blocked') LIMIT 1`).get(row.id, binding.repository, binding.pullRequest)) return 'rejected';
      const now = Date.now();
      this.db.prepare('UPDATE visual_review_cards SET reviewedAt=COALESCE(reviewedAt,?),mergeApprovedAt=? WHERE id=?').run(now, now, row.id);
      this.transition(row.id, 'merge-queued');
    } else {
      if (!binding.workflow?.uploadTarget || !row.mergeCommit) return 'rejected';
      if (row.phase !== 'merged') return 'duplicate';
      if (this.db.prepare(`SELECT 1 FROM visual_review_cards WHERE id<>? AND
        json_extract(binding,'$.workflow.uploadTarget')=? AND phase IN ('upload-queued','uploading','upload-unknown') LIMIT 1`)
        .get(row.id, binding.workflow.uploadTarget)) return 'rejected';
      this.db.prepare('UPDATE visual_review_cards SET uploadApprovedAt=? WHERE id=?').run(Date.now(), row.id);
      this.transition(row.id, 'upload-queued');
    }
    return 'accepted';
  }

  recoverLaunches() {
    this.db.exec(`UPDATE visual_review_cards SET phase=CASE phase WHEN 'merging' THEN 'merge-unknown' ELSE 'upload-unknown' END,
      revision=revision+1,next=0 WHERE phase IN ('merging','uploading')`);
  }

  take(): VisualOperation | undefined {
    const row = this.db.prepare("SELECT * FROM visual_review_cards WHERE phase IN ('merge-queued','upload-queued') ORDER BY rowid LIMIT 1")
      .get() as unknown as ReviewRow | undefined;
    if (!row) return;
    const action = row.phase === 'merge-queued' ? 'merge' : 'upload';
    this.transition(row.id, action === 'merge' ? 'merging' : 'uploading');
    return { id: row.id, action, binding: JSON.parse(row.binding) as VisualReviewBinding, mergeCommit: row.mergeCommit ?? undefined };
  }

  finish(operation: VisualOperation, result?: VisualOperationResult) {
    const phase = result?.status === 'blocked' ? (operation.action === 'merge' ? 'merge-blocked' : 'upload-blocked')
      : result?.status ?? (operation.action === 'merge' ? 'merge-unknown' : 'upload-unknown');
    this.db.prepare(`UPDATE visual_review_cards SET phase=?,result=?,mergeCommit=COALESCE(?,mergeCommit),revision=revision+1,next=0
      WHERE id=? AND phase=?`).run(phase, result ? JSON.stringify(result) : null, result?.status === 'merged' ? result.mergeCommit : null,
        operation.id, operation.action === 'merge' ? 'merging' : 'uploading');
  }

  pendingUpdates(now: number) {
    const rows = this.db.prepare(`SELECT * FROM visual_review_cards WHERE message IS NOT NULL AND rendered<revision AND next<=?
      ORDER BY rowid LIMIT 10`).all(now) as unknown as ReviewRow[];
    return rows.map(row => ({ card: this.presentation(row), revision: row.revision, message: row.message!, body: row.body,
      images: JSON.parse(row.images!) as VisualAttachment[] }));
  }

  settleUpdate(id: string, revision: number, success: boolean) {
    if (success) this.db.prepare('UPDATE visual_review_cards SET rendered=MAX(rendered,?) WHERE id=?').run(revision, id);
    else this.db.prepare('UPDATE visual_review_cards SET next=? WHERE id=? AND revision=?').run(Date.now() + 5_000, id, revision);
  }

  outstanding(): number {
    const value = this.db.prepare(`SELECT count(*) AS count FROM visual_review_cards
      WHERE phase IN ('merge-queued','merging','upload-queued','uploading') OR (message IS NOT NULL AND rendered<revision)`).get();
    return Number(value?.count);
  }

  private row(id: string): ReviewRow | undefined {
    return this.db.prepare('SELECT * FROM visual_review_cards WHERE id=?').get(id) as unknown as ReviewRow | undefined;
  }

  private presentation(row: ReviewRow): VisualReviewView {
    return { id: row.id, binding: JSON.parse(row.binding), phase: row.phase, mergeCommit: row.mergeCommit ?? undefined,
      result: row.result ? JSON.parse(row.result) : undefined };
  }

  private transition(id: string, phase: VisualPhase) {
    this.db.prepare('UPDATE visual_review_cards SET phase=?,revision=revision+1,next=0 WHERE id=?').run(phase, id);
  }
}
