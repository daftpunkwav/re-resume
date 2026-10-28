/**
 * @file SqliteMessageContextRepository
 * @description SQLite persistence for the context chips attached to a message.
 * Position preserves the order the user added them in.
 */

import type { MessageContext } from '../../../domain/conversation/MessageContext'
import { isMessageContextKind } from '../../../domain/conversation/MessageContext'
import type { MessageContextRepository } from '../../../domain/conversation/ports/MessageContextRepository'
import type { MessageId } from '../../../domain/shared/branded-id'
import { asInfoEntryId, asJobPostingId, asResumeId } from '../../../domain/shared/branded-id'
import type { SqlDatabase } from '../sqlite'
import { RowMappingError } from '../JsonEnvelope'

interface ContextRow {
  readonly kind: unknown
  readonly ref_id: unknown
}

export class SqliteMessageContextRepository implements MessageContextRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async listByMessage(id: MessageId): Promise<readonly MessageContext[]> {
    const rows = await this.#database.select<ContextRow>(
      'SELECT kind, ref_id FROM message_context WHERE message_id = $1 ORDER BY position ASC',
      [id],
    )
    return rows.map((row) => fromContextRow(row, String(id)))
  }

  async insertAll(
    contexts: readonly { readonly messageId: MessageId; readonly context: MessageContext }[],
  ): Promise<void> {
    if (contexts.length === 0) return
    await this.#database.transaction(async (tx) => {
      for (const [position, entry] of contexts.entries()) {
        await tx.execute(
          `INSERT INTO message_context (message_id, kind, ref_id, position) VALUES ($1, $2, $3, $4)`,
          [entry.messageId, entry.context.kind, entry.context.refId, position],
        )
      }
    })
  }
}

function fromContextRow(row: ContextRow, messageId: string): MessageContext {
  const kind = row.kind
  if (!isMessageContextKind(kind)) {
    throw new RowMappingError(
      `message_context(${messageId}).kind`,
      'value is not one of the context kinds',
      kind,
    )
  }
  const refId = row.ref_id
  if (typeof refId !== 'string' || refId === '') {
    throw new RowMappingError(
      `message_context(${messageId}).ref_id`,
      'expected a non-empty identifier',
      refId,
    )
  }
  // The three reference kinds are branded differently, so each branch
  // reconstructs the identifier of that specific kind.
  switch (kind) {
    case 'entry':
      return { kind, refId: asInfoEntryId(refId) }
    case 'resume':
      return { kind, refId: asResumeId(refId) }
    case 'jobPosting':
      return { kind, refId: asJobPostingId(refId) }
  }
}
