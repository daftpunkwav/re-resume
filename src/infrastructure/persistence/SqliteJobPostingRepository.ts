/**
 * @file SqliteJobPostingRepository
 * @description SQLite persistence for job postings. The vocabulary comes from
 * the application layer, which owns writes to this table; the statement lives
 * here because the layering rules put every query in infrastructure.
 */

import type { JobPosting } from '../../domain/generation/JobPosting'
import type { JobPostingId } from '../../domain/shared/branded-id'
import type { JobPostingRepository } from '../../domain/generation/ports/JobPostingRepository'
import type { SqlDatabase } from './sqlite'
import { fromJobPosting, toJobPosting } from './mappers/JobPostingRowMapper'
import type { JobPostingRow } from './mappers/JobPostingRowMapper'

export class SqliteJobPostingRepository implements JobPostingRepository {
  constructor(private readonly database: SqlDatabase) {}

  async findById(id: JobPostingId): Promise<JobPosting | null> {
    const rows = await this.database.select<JobPostingRow>(
      'SELECT * FROM job_posting WHERE id = $1',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : toJobPosting(row)
  }

  async listAll(): Promise<readonly JobPosting[]> {
    const rows = await this.database.select<JobPostingRow>(
      'SELECT * FROM job_posting ORDER BY created_at DESC',
    )
    return rows.map(toJobPosting)
  }

  /**
   * An upsert rather than an insert: parsing a posting rewrites its parsed
   * payload while leaving its identity and creation time alone.
   */
  async save(jobPosting: JobPosting): Promise<void> {
    const row = fromJobPosting(jobPosting)
    await this.database.execute(
      `INSERT INTO job_posting
         (id, raw_text, source, parsed_json, parsed_by_run_id, parsed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         raw_text = excluded.raw_text,
         source = excluded.source,
         parsed_json = excluded.parsed_json,
         parsed_by_run_id = excluded.parsed_by_run_id,
         parsed_at = excluded.parsed_at`,
      [
        row.id,
        row.raw_text,
        row.source,
        row.parsed_json,
        row.parsed_by_run_id,
        row.parsed_at,
        row.created_at,
      ],
    )
  }
}
