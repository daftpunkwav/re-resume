/**
 * @file inMemoryCatalogRepositories
 * @description In-memory experience and profile repositories for use case tests.
 * They mirror the persistence contract, not the SQL schema: the row shape and
 * the envelope encoding belong to infrastructure and are exercised there.
 */

import type { Experience } from '../../src/domain/catalog/Experience'
import type { Profile } from '../../src/domain/catalog/Profile'
import { PROFILE_SEED_ID } from '../../src/domain/catalog/Profile'
import type { ExperienceRepository } from '../../src/domain/catalog/ports/ExperienceRepository'
import type { ProfileRepository } from '../../src/domain/catalog/ports/ProfileRepository'
import { asProfileId } from '../../src/domain/shared/branded-id'
import type { ExperienceId } from '../../src/domain/shared/branded-id'

export class InMemoryExperienceRepository implements ExperienceRepository {
  private readonly rows = new Map<ExperienceId, Experience>()

  async findById(id: ExperienceId): Promise<Experience | null> {
    return this.rows.get(id) ?? null
  }

  async listAll(): Promise<readonly Experience[]> {
    return [...this.rows.values()]
  }

  async save(experience: Experience): Promise<void> {
    this.rows.set(experience.id, experience)
  }

  async remove(id: ExperienceId): Promise<void> {
    this.rows.delete(id)
  }

  seed(...experiences: readonly Experience[]): void {
    for (const experience of experiences) this.rows.set(experience.id, experience)
  }

  get size(): number {
    return this.rows.size
  }
}

export class InMemoryProfileRepository implements ProfileRepository {
  constructor(private row: Profile) {}

  async get(): Promise<Profile> {
    return this.row
  }

  async save(profile: Profile): Promise<void> {
    this.row = profile
  }

  /** Mirrors the seeded singleton so tests start from the same state as production. */
  static seeded(now: string): InMemoryProfileRepository {
    return new InMemoryProfileRepository({
      id: asProfileId(PROFILE_SEED_ID),
      displayName: '',
      email: null,
      phone: null,
      links: [],
      version: 1,
      updatedAt: now as Profile['updatedAt'],
    })
  }
}
