/**
 * @file SqliteAttachmentRepository
 * @description SQLite persistence for attachment metadata. The unique index on
 * the digest makes the row itself the deduplication point.
 */

import type { Attachment } from '../../../domain/conversation/Attachment'
import type { AttachmentRepository } from '../../../domain/conversation/ports/AttachmentRepository'
import type { AttachmentId } from '../../../domain/shared/branded-id'
import type { SqlDatabase } from '../sqlite'
import { fromAttachmentRow, toAttachmentRow } from './mappers/AttachmentRowMapper'
import type { AttachmentRow } from './mappers/AttachmentRowMapper'

const COLUMNS =
  'id, kind, mime_type, byte_size, storage_name, width, height, sha256, created_at'

export class SqliteAttachmentRepository implements AttachmentRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async findById(id: AttachmentId): Promise<Attachment | null> {
    const rows = await this.#database.select<AttachmentRow>(
      `SELECT ${COLUMNS} FROM attachment WHERE id = $1`,
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : fromAttachmentRow(row)
  }

  async findBySha256(sha256: string): Promise<Attachment | null> {
    const rows = await this.#database.select<AttachmentRow>(
      `SELECT ${COLUMNS} FROM attachment WHERE sha256 = $1`,
      [sha256],
    )
    const row = rows[0]
    return row === undefined ? null : fromAttachmentRow(row)
  }

  async listByIds(ids: readonly AttachmentId[]): Promise<readonly Attachment[]> {
    if (ids.length === 0) return []
    const placeholders = ids.map((_, position) => `$${position + 1}`).join(', ')
    const rows = await this.#database.select<AttachmentRow>(
      `SELECT ${COLUMNS} FROM attachment WHERE id IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
      [...ids],
    )
    return rows.map(fromAttachmentRow)
  }

  async insert(attachment: Attachment): Promise<void> {
    const row = toAttachmentRow(attachment)
    await this.#database.execute(
      `INSERT INTO attachment (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.id,
        row.kind,
        row.mime_type,
        row.byte_size,
        row.storage_name,
        row.width,
        row.height,
        row.sha256,
        row.created_at,
      ],
    )
  }
}
