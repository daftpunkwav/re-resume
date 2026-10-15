/**
 * @file ProfileRepository
 * @description Persistence port for the single profile row.
 */

import type { Profile } from '../Profile'

export interface ProfileRepository {
  /** Returns the seeded singleton — never null. */
  get(): Promise<Profile>
  save(profile: Profile): Promise<void>
}
