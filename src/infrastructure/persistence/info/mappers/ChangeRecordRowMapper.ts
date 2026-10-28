/**
 * @file ChangeRecordRowMapper
 * @description Row mapping for the append-only change log. The before and after
 * payloads are stored inside the shared JSON envelope even though they are
 * already JSON text of their own: the envelope is what carries the format
 * version, and a payload read by a build that does not know the version must
 * fail rather than be replayed by an undo it was not written for.
 *
 * Constraints:
 * - `undoneAt` is the only column a normal write never changes after insert;
 *   the upsert exists for the undo path, which stamps the record in the same
 *   transaction as the inverse operation.
 * - Enumeration columns are checked here as well as by the DDL, so a row written
 *   by an older or external writer cannot enter the domain.
 */

import { isChangeOp, isChangeOrigin, isChangeScope } from '../../../../domain/changes/ChangeRecord'
import type { ChangeRecord } from '../../../../domain/changes/ChangeRecord'
import {
  asAgentRunId,
  asChangeRecordId,
  asConversationId,
} from '../../../../domain/shared/branded-id'
import { readJsonStringEnvelope, RowMappingError, writeJsonEnvelope } from '../../JsonEnvelope'
import type { SqlDatabase, SqlValue } from '../../sqlite'
import type { Row } from './rowContract'
import {
  optionalDateTime,
  optionalString,
  requiredDateTime,
  requiredString,
} from './rowContract'

export const CHANGE_RECORD_COLUMNS =
  'id, scope, entity, entity_id, op, before_json, after_json, origin, run_id, ' +
  'conversation_id, label, undone_at, created_at'

/** Values in the order of `CHANGE_RECORD_COLUMNS`. */
export function changeRecordRowValues(record: ChangeRecord): readonly SqlValue[] {
  return [
    record.id,
    record.scope,
    record.entity,
    record.entityId,
    record.op,
    record.beforeJson === null ? null : writeJsonEnvelope(record.beforeJson),
    record.afterJson === null ? null : writeJsonEnvelope(record.afterJson),
    record.origin,
    record.runId,
    record.conversationId,
    record.label,
    record.undoneAt,
    record.createdAt,
  ]
}

function optionalJsonPayload(row: Row, column: string): string | null {
  const raw = row[column]
  if (raw === null || raw === undefined) return null
  return readJsonStringEnvelope(raw, column)
}

/** Maps one change_record row, rejecting anything outside the closed value sets. */
export function mapChangeRecordRow(row: Row): ChangeRecord {
  const scope = requiredString(row, 'scope')
  if (!isChangeScope(scope)) {
    throw new RowMappingError('change_record.scope', 'is not a change scope this build knows', scope)
  }
  const op = requiredString(row, 'op')
  if (!isChangeOp(op)) {
    throw new RowMappingError('change_record.op', 'is not a change operation this build knows', op)
  }
  const origin = requiredString(row, 'origin')
  if (!isChangeOrigin(origin)) {
    throw new RowMappingError('change_record.origin', 'is not a change origin this build knows', origin)
  }
  const runId = optionalString(row, 'run_id')
  const conversationId = optionalString(row, 'conversation_id')
  return {
    id: asChangeRecordId(requiredString(row, 'id')),
    scope,
    entity: requiredString(row, 'entity'),
    entityId: requiredString(row, 'entity_id'),
    op,
    beforeJson: optionalJsonPayload(row, 'before_json'),
    afterJson: optionalJsonPayload(row, 'after_json'),
    origin,
    runId: runId === null ? null : asAgentRunId(runId),
    conversationId: conversationId === null ? null : asConversationId(conversationId),
    label: requiredString(row, 'label'),
    undoneAt: optionalDateTime(row, 'undone_at'),
    createdAt: requiredDateTime(row, 'created_at'),
  }
}

/**
 * Inserts a change record, or stamps `undone_at` when the identifier is already
 * present.
 *
 * The upsert is the seam the undo path uses: the inverse write passes the record
 * being undone with `undoneAt` set, so the state change and its audit stamp land
 * in one transaction. A normal write always carries a fresh identifier and
 * inserts, so the log stays append-only in practice.
 */
export async function insertOrStampChangeRecord(
  database: SqlDatabase,
  record: ChangeRecord,
): Promise<void> {
  await database.execute(
    `INSERT INTO change_record (${CHANGE_RECORD_COLUMNS}) ` +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ' +
      'ON CONFLICT (id) DO UPDATE SET undone_at = excluded.undone_at',
    changeRecordRowValues(record),
  )
}
