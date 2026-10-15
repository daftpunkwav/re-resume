/**
 * @file JobPostingRepository
 * @description Persistence port for job postings. It lives here rather than in
 * the application layer because an implementation in infrastructure must not
 * import from the layer above it, and a port belongs to the context whose data
 * it serves.
 */

import type { JobPosting } from '../JobPosting'
import type { JobPostingId } from '../../shared/branded-id'

export interface JobPostingRepository {
  findById(id: JobPostingId): Promise<JobPosting | null>
  listAll(): Promise<readonly JobPosting[]>
  save(jobPosting: JobPosting): Promise<void>
}
