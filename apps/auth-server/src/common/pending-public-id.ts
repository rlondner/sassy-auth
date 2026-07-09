import { randomUUID } from 'crypto';

/**
 * bug-0148: every entity-creation flow uses a two-step transaction —
 * insert with a placeholder `publicId`, then update to the real Sqid
 * (which is derived from the auto-generated numeric id). Historically
 * that placeholder was a literal `'placeholder'`, so two concurrent
 * creates collided on the `publicId` unique constraint and surfaced as
 * a misleading `ConflictException('...name already exists')`.
 *
 * Using a per-request random UUID prefix eliminates the collision. The
 * `pending-` prefix matches the seed's convention so the seed's
 * housekeeping (see `seed.ts` `startsWith('pending-')` check) still
 * finds any row left behind by a transaction that failed between the
 * initial insert and the publicId update.
 */
export function generatePendingPublicId(): string {
  return `pending-${randomUUID()}`;
}
