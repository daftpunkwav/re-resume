/**
 * @file driftingExperienceRepository
 * @description A scripted catalog repository double whose answers change after
 * it is armed. Use cases that read the library more than once are observed
 * against a read that went stale between the two passes.
 */

import type { Experience } from '../../src/domain/catalog/Experience'
import type { ExperienceRepository } from '../../src/domain/catalog/ports/ExperienceRepository'
import type { ExperienceId } from '../../src/domain/shared/branded-id'

/**
 * A repository that answers with a different experience on every read, so a
 * second pass over the same blocks sees a different claim status than the
 * first. That is what a rejection landing between two reads looks like.
 */
export class DriftingExperienceRepository implements ExperienceRepository {
  /** Reads since the drift was armed. */
  reads = 0
  armed = false

  constructor(
    private readonly confirmed: Experience,
    private readonly rejected: Experience,
  ) {}

  async findById(_id: ExperienceId): Promise<Experience | null> {
    if (!this.armed) return this.confirmed
    this.reads += 1
    return this.reads === 1 ? this.confirmed : this.rejected
  }

  async listAll(): Promise<readonly Experience[]> {
    return []
  }

  async save(_experience: Experience): Promise<void> {}

  async remove(_id: ExperienceId): Promise<void> {}
}
