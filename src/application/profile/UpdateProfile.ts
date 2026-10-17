/**
 * @file UpdateProfile
 * @description The only mutation path for the single profile row. Resume
 * profile blocks copy these values at insertion time, so a change here never
 * reaches an existing resume on its own; it only makes the block's refVersion
 * fall behind.
 *
 * Responsibilities:
 * - Validate the identity fields and the link list
 * - Persist the profile with an incremented version
 *
 * Constraints:
 * - There is no create path: the row is seeded by the init migration, which is
 *   what lets a first agent draft copy a profile on a fresh install.
 * - An empty display name stays legal. The seeded row carries an empty one, and
 *   the freeze check treats a nameless profile block as no content, so refusing
 *   to store it would make the profile impossible to clear.
 */

import { z } from 'zod'
import { updateProfile as updateProfileAggregate } from '../../domain/catalog/Profile'
import type { Profile } from '../../domain/catalog/Profile'
import type { Clock } from '../../domain/shared/Clock'
import type { ProfileRepository } from '../../domain/catalog/ports/ProfileRepository'
import { err, ok } from '../../domain/shared/Result'
import type { Result } from '../../domain/shared/Result'

/**
 * A form hands over '' when the user clears a field, so blank means "no value"
 * rather than a validation failure. The trim runs before the format check;
 * Zod's format validators see the raw string otherwise.
 */
function optionalText(accepts: (raw: string) => boolean, message: string) {
  return z
    .string()
    .trim()
    .transform((raw) => (raw === '' ? null : raw))
    .refine((raw) => raw === null || accepts(raw), { message })
    .nullable()
    .optional()
}

const profileLinkSchema = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().pipe(z.url()),
})

const updateProfileCommandSchema = z.object({
  displayName: z.string().trim().optional(),
  email: optionalText((raw) => z.email().safeParse(raw).success, 'Expected a valid email address.'),
  phone: optionalText((raw) => raw.length > 0, 'Expected a phone number.'),
  links: z.array(profileLinkSchema).optional(),
})

export interface UpdateProfileDeps {
  readonly profileRepo: ProfileRepository
  readonly clock: Clock
}

export interface UpdateProfileCommand {
  readonly displayName?: string
  readonly email?: string | null
  readonly phone?: string | null
  readonly links?: readonly { readonly label: string; readonly url: string }[]
}

export async function updateProfile(
  deps: UpdateProfileDeps,
  command: UpdateProfileCommand,
): Promise<Result<Profile, z.ZodError>> {
  const parsed = updateProfileCommandSchema.safeParse(command)
  if (!parsed.success) return err(parsed.error)

  const profile = await deps.profileRepo.get()
  const updated = updateProfileAggregate(profile, parsed.data, deps.clock.now())
  await deps.profileRepo.save(updated)
  return ok(updated)
}
