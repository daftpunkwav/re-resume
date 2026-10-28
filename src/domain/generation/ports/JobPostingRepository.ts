/**
 * @file JobPostingRepository
 * @description Persistence port for job postings. `insert` and `save` are
 * separate because a posting is created once and parsed later; the parse
 * updates the existing row instead of creating a second one.
 */

import type { JobPosting } from '../JobPosting'
import type { JobPostingId } from '../../shared/branded-id'

export interface JobPostingRepository {
  findById(id: JobPostingId): Promise<JobPosting | null>
  listRecent(limit: number): Promise<readonly JobPosting[]>
  insert(posting: JobPosting): Promise<void>
  save(posting: JobPosting): Promise<void>
}
