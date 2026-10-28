/**
 * @file SqliteJobPostingRepository
 * @description SQLite persistence for job postings. A posting is inserted once
 * when the user supplies it and updated in place when a model parses it; the
 * creation time is never rewritten.
 */

import type { JobPosting } from '../../../domain/generation/JobPosting'
import type { JobPostingRepository } from '../../../domain/generation/ports/JobPostingRepository'
import type { JobPostingId } from '../../../domain/shared/branded-id'
import type { SqlDatabase } from '../sqlite'
import { fromJobPostingRow, toJobPostingRow } from './mappers/JobPostingRowMapper'
import type { JobPostingRow } from './mappers/JobPostingRowMapper'

const COLUMNS =
  'id, raw_text, source, image_attachment_ids, conversation_id, resume_id, parsed_json, parsed_by_run_id, parsed_at, created_at'

export class SqliteJobPostingRepository implements JobPostingRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async findById(id: JobPostingId): Promise<JobPosting | null> {
    const rows = await this.#database.select<JobPostingRow>(
      `SELECT ${COLUMNS} FROM job_posting WHERE id = $1`,
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : fromJobPostingRow(row)
  }

  async listRecent(limit: number): Promise<readonly JobPosting[]> {
    if (limit <= 0) return []
    const rows = await this.#database.select<JobPostingRow>(
      `SELECT ${COLUMNS} FROM job_posting ORDER BY created_at DESC, id ASC LIMIT $1`,
      [limit],
    )
    return rows.map(fromJobPostingRow)
  }

  async insert(posting: JobPosting): Promise<void> {
    const row = toJobPostingRow(posting)
    await this.#database.execute(
      `INSERT INTO job_posting (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.id,
        row.raw_text,
        row.source,
        row.image_attachment_ids,
        row.conversation_id,
        row.resume_id,
        row.parsed_json,
        row.parsed_by_run_id,
        row.parsed_at,
        row.created_at,
      ],
    )
  }

  async save(posting: JobPosting): Promise<void> {
    const row = toJobPostingRow(posting)
    const result = await this.#database.execute(
      `UPDATE job_posting SET raw_text = $2, source = $3, image_attachment_ids = $4,
         conversation_id = $5, resume_id = $6, parsed_json = $7, parsed_by_run_id = $8, parsed_at = $9
       WHERE id = $1`,
      [
        row.id,
        row.raw_text,
        row.source,
        row.image_attachment_ids,
        row.conversation_id,
        row.resume_id,
        row.parsed_json,
        row.parsed_by_run_id,
        row.parsed_at,
      ],
    )
    if (result.rowsAffected === 0) {
      throw new Error(
        `Cannot save job posting "${posting.id}": the row does not exist. A parse updates an existing posting.`,
      )
    }
  }
}
