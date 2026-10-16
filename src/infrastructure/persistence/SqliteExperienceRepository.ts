/**
 * @file SqliteExperienceRepository
 * @description SQLite persistence for the experience aggregate. The aggregate
 * is three tables (fact, variant, claim), so save() writes all three inside one
 * transaction: a partially applied aggregate is an aggregate whose factVersion
 * disagrees with its statements.
 *
 * Constraints:
 * - Claim rows are never deleted by a use case — the claim lifecycle ends at
 *   rejected — so the only cascade that removes them is deleting the
 *   experience. The delete-missing step below exists so save() persists the
 *   aggregate it was handed rather than merging it into what is stored.
 * - Deleting a referenced variant or claim is refused by the application layer
 *   before this point; the database's partial unique index on active claim
 *   statements is the second line of defence, not the first.
 */

import type { Experience } from '../../domain/catalog/Experience'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ExperienceId } from '../../domain/shared/branded-id'
import {
  fromExperienceRowSet,
  toClaimRows,
  toExperienceRow,
  toVariantRows,
} from './mappers/ExperienceRowMapper'
import type {
  ClaimRow,
  ExperienceRow,
  VariantRow,
} from './mappers/ExperienceRowMapper'
import type { SqlDatabase, SqlValue } from './sqlite'

export class SqliteExperienceRepository implements ExperienceRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async findById(id: ExperienceId): Promise<Experience | null> {
    const experienceRows = await this.#database.select<ExperienceRow>(
      'SELECT * FROM experience WHERE id = $1',
      [id],
    )
    const experienceRow = experienceRows[0]
    if (experienceRow === undefined) return null
    return fromExperienceRowSet({
      experience: experienceRow,
      variants: await this.#selectVariantsOf(id),
      claims: await this.#selectClaimsOf(id),
    })
  }

  async listAll(): Promise<readonly Experience[]> {
    const experienceRows = await this.#database.select<ExperienceRow>(
      'SELECT * FROM experience ORDER BY created_at ASC, id ASC',
    )
    if (experienceRows.length === 0) return []
    const variantsByExperience = groupByExperience(
      await this.#database.select<VariantRow>('SELECT * FROM variant ORDER BY created_at ASC, id ASC'),
    )
    const claimsByExperience = groupByExperience(
      await this.#database.select<ClaimRow>('SELECT * FROM claim ORDER BY created_at ASC, id ASC'),
    )
    return experienceRows.map((experience) =>
      fromExperienceRowSet({
        experience,
        variants: variantsByExperience.get(experience.id) ?? [],
        claims: claimsByExperience.get(experience.id) ?? [],
      }),
    )
  }

  async save(experience: Experience): Promise<void> {
    const row = toExperienceRow(experience)
    const variantRows = toVariantRows(experience)
    const claimRows = toClaimRows(experience)
    await this.#database.transaction(async (tx) => {
      await this.#upsertExperience(tx, row)
      // Absent rows go first: removing one variant and adding another that
      // reuses its label is a legal edit of the aggregate, and the unique index
      // on (experience_id, label) would reject the insert while the row it
      // displaces is still there.
      await this.#deleteVariantsAbsentFrom(tx, experience.id, variantRows.map((each) => each.id))
      await this.#deleteClaimsAbsentFrom(tx, experience.id, claimRows.map((each) => each.id))
      for (const variantRow of variantRows) await this.#upsertVariant(tx, variantRow)
      for (const claimRow of claimRows) await this.#upsertClaim(tx, claimRow)
    })
  }

  async remove(id: ExperienceId): Promise<void> {
    // Variants and claims follow through ON DELETE CASCADE, which is only
    // enforced while the foreign_keys pragma is on.
    await this.#database.execute('DELETE FROM experience WHERE id = $1', [id])
  }

  async #selectVariantsOf(id: ExperienceId): Promise<readonly VariantRow[]> {
    return this.#database.select<VariantRow>(
      'SELECT * FROM variant WHERE experience_id = $1 ORDER BY created_at ASC, id ASC',
      [id],
    )
  }

  async #selectClaimsOf(id: ExperienceId): Promise<readonly ClaimRow[]> {
    return this.#database.select<ClaimRow>(
      'SELECT * FROM claim WHERE experience_id = $1 ORDER BY created_at ASC, id ASC',
      [id],
    )
  }

  async #upsertExperience(tx: SqlDatabase, row: ExperienceRow): Promise<void> {
    await tx.execute(
      `INSERT INTO experience
         (id, kind, title, organization, start_date, end_date, is_current, detail_json, fact_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         organization = excluded.organization,
         start_date = excluded.start_date,
         end_date = excluded.end_date,
         is_current = excluded.is_current,
         detail_json = excluded.detail_json,
         fact_version = excluded.fact_version,
         updated_at = excluded.updated_at`,
      [
        row.id,
        row.kind,
        row.title,
        row.organization,
        row.start_date,
        row.end_date,
        row.is_current,
        row.detail_json,
        row.fact_version,
        row.created_at,
        row.updated_at,
      ],
    )
  }

  async #upsertVariant(tx: SqlDatabase, row: VariantRow): Promise<void> {
    await tx.execute(
      `INSERT INTO variant
         (id, experience_id, label, content, emphasis, drafted_by_run_id, confirmed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         experience_id = excluded.experience_id,
         label = excluded.label,
         content = excluded.content,
         emphasis = excluded.emphasis,
         drafted_by_run_id = excluded.drafted_by_run_id,
         confirmed_at = excluded.confirmed_at,
         updated_at = excluded.updated_at`,
      [
        row.id,
        row.experience_id,
        row.label,
        row.content,
        row.emphasis,
        row.drafted_by_run_id,
        row.confirmed_at,
        row.created_at,
        row.updated_at,
      ],
    )
  }

  async #upsertClaim(tx: SqlDatabase, row: ClaimRow): Promise<void> {
    await tx.execute(
      `INSERT INTO claim
         (id, experience_id, kind, statement, source_field, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         experience_id = excluded.experience_id,
         kind = excluded.kind,
         statement = excluded.statement,
         source_field = excluded.source_field,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      [row.id, row.experience_id, row.kind, row.statement, row.source_field, row.status, row.created_at, row.updated_at],
    )
  }

  async #deleteVariantsAbsentFrom(
    tx: SqlDatabase,
    experienceId: ExperienceId,
    keepIds: readonly string[],
  ): Promise<void> {
    await this.#deleteAbsentFrom(tx, 'variant', experienceId, keepIds)
  }

  async #deleteClaimsAbsentFrom(
    tx: SqlDatabase,
    experienceId: ExperienceId,
    keepIds: readonly string[],
  ): Promise<void> {
    await this.#deleteAbsentFrom(tx, 'claim', experienceId, keepIds)
  }

  async #deleteAbsentFrom(
    tx: SqlDatabase,
    table: 'variant' | 'claim',
    experienceId: ExperienceId,
    keepIds: readonly string[],
  ): Promise<void> {
    // An empty IN () list is a syntax error, so an aggregate that emptied its
    // own collection is written as an unconditional delete.
    if (keepIds.length === 0) {
      await tx.execute(`DELETE FROM ${table} WHERE experience_id = $1`, [experienceId])
      return
    }
    const placeholders = keepIds.map((_, index) => `$${index + 2}`).join(', ')
    await tx.execute(
      `DELETE FROM ${table} WHERE experience_id = $1 AND id NOT IN (${placeholders})`,
      [experienceId, ...keepIds] satisfies SqlValue[],
    )
  }
}

function groupByExperience<TRow extends { readonly experience_id: string }>(
  rows: readonly TRow[],
): ReadonlyMap<string, TRow[]> {
  const grouped = new Map<string, TRow[]>()
  for (const row of rows) {
    const existing = grouped.get(row.experience_id)
    if (existing === undefined) {
      grouped.set(row.experience_id, [row])
    } else {
      existing.push(row)
    }
  }
  return grouped
}
