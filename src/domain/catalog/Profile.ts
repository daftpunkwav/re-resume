/**
 * @file Profile
 * @description The single profile row: the identity fields a resume header
 * shows. ProfileFields is the shared shape so a new field is defined once and
 * reused by ProfileContent and the frozen snapshot.
 *
 * Constraints:
 * - There is exactly one profile; it is seeded by the init migration.
 * - UpdateProfile is the only mutation path, and every update bumps version.
 */

import type { DateTime } from '../shared/DateTime'
import type { ProfileId } from '../shared/branded-id'

/** The copyable identity fields; ProfileContent and the snapshot inline this
 *  shape, so adding a field is one edit here, not three. */
export interface ProfileFields {
  readonly displayName: string
  readonly email: string | null
  readonly phone: string | null
  readonly links: readonly ProfileLink[]
}

export interface ProfileLink {
  readonly label: string
  readonly url: string
}

export interface Profile extends ProfileFields {
  readonly id: ProfileId
  /** Monotonic; bumped by every UpdateProfile, compared by the block's refVersion. */
  readonly version: number
  readonly updatedAt: DateTime
}

export interface ProfilePatch {
  readonly displayName?: string
  readonly email?: string | null
  readonly phone?: string | null
  readonly links?: readonly ProfileLink[]
}

export const PROFILE_SEED_ID = 'default'

export function updateProfile(
  profile: Profile,
  patch: ProfilePatch,
  now: DateTime,
): Profile {
  return {
    ...profile,
    displayName: patch.displayName ?? profile.displayName,
    email: patch.email === undefined ? profile.email : patch.email,
    phone: patch.phone === undefined ? profile.phone : patch.phone,
    links: patch.links ?? profile.links,
    version: profile.version + 1,
    updatedAt: now,
  }
}

/** Extracts the copyable subset a resume profile block snapshots. */
export function toProfileFields(profile: Profile): ProfileFields {
  return {
    displayName: profile.displayName,
    email: profile.email,
    phone: profile.phone,
    links: profile.links,
  }
}
