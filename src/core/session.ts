/**
 * The session. The one writer.
 *
 * Takes:   a SiteDocument.
 * Returns: the current document, its derived state, and the op log.
 * Assumes: nothing outside this class mutates the document (invariant I1).
 *          Undo is a rolling cache of the last 50 states — freeze patch 10 — because
 *          exact geometric inverses under floating-point drift are a five-day trap.
 */

import type { SiteDocument } from './types';
import { derive, contentHash, type Derived } from './site';
import { apply, metrics, toJsonl, type Op, type OpKind, type Metrics } from './ops';

const UNDO_DEPTH = 50;

export class Session {
  doc: SiteDocument;
  derived: Derived;
  ops: Op[] = [];
  /** Warnings a human has explicitly accepted, with a reason. */
  accepted = new Map<string, string>();

  /** The document as loaded. Replay starts here: replay is authoritative. */
  private readonly origin: SiteDocument;
  private undoStack: SiteDocument[] = [];
  private listeners: Array<(why: OpKind | 'INIT' | 'UNDO') => void> = [];
  private lastOpAt = Date.now();

  constructor(doc: SiteDocument) {
    this.doc = doc;
    this.origin = JSON.parse(JSON.stringify(doc)) as SiteDocument;
    this.derived = derive(doc);
  }

  on(fn: (why: OpKind | 'INIT' | 'UNDO') => void): void {
    this.listeners.push(fn);
  }

  private emit(why: OpKind | 'INIT' | 'UNDO'): void {
    for (const fn of this.listeners) fn(why);
  }

  /** The only path that writes to the document. */
  do(kind: OpKind, targets: string[], payload: Record<string, unknown>, label: string): Op {
    const now = Date.now();
    const op: Op = {
      seq: this.ops.length,
      ts: new Date(now).toISOString(),
      actor: 'USER',
      kind,
      targets,
      payload,
      prev_hash: this.derived.hash,
      dt_ms: Math.min(now - this.lastOpAt, 30_000),
      label,
    };
    const next = apply(this.doc, op);
    this.lastOpAt = now;
    this.undoStack.push(this.doc);
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.doc = next;
    this.ops.push(op);
    if (kind === 'ACCEPT_WARNING') {
      this.accepted.set(String(payload.finding_id), String(payload.reason ?? ''));
    }
    this.derived = derive(this.doc);
    this.emit(kind);
    return op;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    const op = this.ops.pop();
    if (op?.kind === 'ACCEPT_WARNING') this.accepted.delete(String(op.payload.finding_id));
    this.doc = prev;
    this.derived = derive(this.doc);
    this.emit('UNDO');
  }

  get metrics(): Metrics {
    return metrics(this.doc, this.ops);
  }

  /**
   * Tamper evidence: the log must chain back to the document it claims to describe.
   * If it does not, the document is opened as TAMPERED and briefing is refused.
   */
  verifyChain(): boolean {
    let cur = this.origin;
    for (const op of this.ops) {
      if (op.prev_hash !== contentHash(cur)) return false;
      cur = apply(cur, op);
    }
    return contentHash(cur) === this.derived.hash;
  }

  get opsJsonl(): string {
    return toJsonl(this.ops);
  }

  get opsHash(): string {
    return contentHash(this.ops);
  }
}
