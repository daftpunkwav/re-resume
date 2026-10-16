/**
 * @file ExperienceRepository
 * @description Persistence port for the experience aggregate. The interface
 * speaks domain types only; row shapes stay inside the infrastructure layer.
 */

import type { Experience } from '../Experience'
import type { ExperienceId } from '../../shared/branded-id'

export interface ExperienceRepository {
  findById(id: ExperienceId): Promise<Experience | null>
  listAll(): Promise<readonly Experience[]>
  save(experience: Experience): Promise<void>
  remove(id: ExperienceId): Promise<void>
}
