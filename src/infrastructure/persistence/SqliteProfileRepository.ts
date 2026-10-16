/**
 * @file SqliteProfileRepository
 * @description SQLite persistence for the single profile row. The row is
 * seeded by the init migration, so get() is a total function: there is no
 * create path and no null to handle.
 *
 * Constraints:
 * - UpdateProfile is the only mutation path in the application layer; this
 *   repository therefore only ever updates the existing row and never inserts
 *   a second one.
 * - links_json follows the shared envelope contract; it is written and read
 *   through the same helpers a profile block's inline copy uses, so a link
 *   cannot be serialised one way and parsed another.
 */

import { parseDateTime } from '../../domain/shared/DateTime'
import { asProfileId } from '../../domain/shared/branded-id'
import type { Profile } from '../../domain/catalog/Profile'
import type { ProfileRepository } from '../../domain/catalog/ports/ProfileRepository'
import { RowMappingError } from './mappers/JsonEnvelope'
import { parseProfileLinksEnvelope, serializeProfileLinks } from './mappers/ResumeRowMapper'
import type { SqlDatabase } from './sqlite'

interface ProfileRow {
  readonly id: string
  readonly display_name: string
  readonly email: string | null
  readonly phone: string | null
  readonly links_json: string
  readonly version: number
  readonly updated_at: string
}

export class SqliteProfileRepository implements ProfileRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async get(): Promise<Profile> {
    const rows = await this.#database.select<ProfileRow>('SELECT * FROM profile LIMIT 1')
    const row = rows[0]
    if (row === undefined) {
      throw new RowMappingError(
        'profile',
        'the seeded singleton row is missing, so the init migration has not run against this database',
        null,
      )
    }
    const updatedAt = parseDateTime(row.updated_at)
    if (updatedAt === null) {
      throw new RowMappingError('profile.updated_at', 'expected an ISO 8601 timestamp', row.updated_at)
    }
    return {
      id: asProfileId(row.id),
      displayName: row.display_name,
      email: row.email,
      phone: row.phone,
      links: parseProfileLinksEnvelope(row.links_json, 'profile.links_json'),
      version: row.version,
      updatedAt,
    }
  }

  async save(profile: Profile): Promise<void> {
    await this.#database.execute(
      `UPDATE profile
       SET display_name = $1, email = $2, phone = $3, links_json = $4, version = $5, updated_at = $6
       WHERE id = $7`,
      [
        profile.displayName,
        profile.email,
        profile.phone,
        serializeProfileLinks(profile.links),
        profile.version,
        profile.updatedAt,
        profile.id,
      ],
    )
  }
}
