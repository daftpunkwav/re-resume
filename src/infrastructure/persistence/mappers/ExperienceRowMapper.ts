/**
 * @file ExperienceRowMapper
 * @description Row 鈫?aggregate mapping for the experience aggregate: the fact
 * row plus the variant and claim rows it owns. This is the only place a stored
 * string becomes a branded identifier, a calendar brand or a validated enum, so
 * a malformed row is refused here instead of surfacing as a wrong resume block
 * several layers up.
 *
 * Constraints:
 * - Enum and date columns are validated, never coerced. SQLite happily stores
 *   anything in a TEXT column even where a CHECK constraint normally applies;
 *   the mapper cannot rely on the constraint having fired.
 * - The mapper assembles the aggregate from the three row families but never
 *   re-derives business rules: reading a stored row is not a mutation.
 */

import { isExperienceKind } from '../../../domain/catalog/ExperienceKind'
import { isClaimKind } from '../../../domain/catalog/ClaimKind'
import { isClaimStatus } from '../../../domain/catalog/ClaimStatus'
import { parseDateTime, parseIsoDate } from '../../../domain/shared/DateTime'
import type { DateTime, IsoDate } from '../../../domain/shared/DateTime'
import {
  asAgentRunId,
  asClaimId,
  asExperienceId,
  asVariantId,
} from '../../../domain/shared/branded-id'
import type { Experience } from '../../../domain/catalog/Experience'
import type { Variant } from '../../../domain/catalog/Variant'
import type { Claim } from '../../../domain/catalog/Claim'
import { RowMappingError, readJsonRecordEnvelope, writeJsonEnvelope } from '../JsonEnvelope'

export interface ExperienceRow {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly organization: string | null
  readonly start_date: string | null
  readonly end_date: string | null
  readonly is_current: number
  readonly detail_json: string
  readonly fact_version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface VariantRow {
  readonly id: string
  readonly experience_id: string
  readonly label: string
  readonly content: string
  readonly emphasis: string | null
  readonly drafted_by_run_id: string | null
  readonly confirmed_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface ClaimRow {
  readonly id: string
  readonly experience_id: string
  readonly kind: string
  readonly statement: string
  readonly source_field: string | null
  readonly status: string
  readonly created_at: string
  readonly updated_at: string
}

/** The three row families one aggregate is stored as. */
export interface ExperienceRowSet {
  readonly experience: ExperienceRow
  readonly variants: readonly VariantRow[]
  readonly claims: readonly ClaimRow[]
}

export function toExperienceRow(experience: Experience): ExperienceRow {
  return {
    id: experience.id,
    kind: experience.kind,
    title: experience.title,
    organization: experience.organization,
    start_date: experience.startDate,
    end_date: experience.endDate,
    is_current: experience.isCurrent ? 1 : 0,
    detail_json: writeJsonEnvelope(experience.detail),
    fact_version: experience.factVersion,
    created_at: experience.createdAt,
    updated_at: experience.updatedAt,
  }
}

export function toVariantRow(variant: Variant): VariantRow {
  return {
    id: variant.id,
    experience_id: variant.experienceId,
    label: variant.label,
    content: variant.content,
    emphasis: variant.emphasis,
    drafted_by_run_id: variant.draftedByRunId,
    confirmed_at: variant.confirmedAt,
    created_at: variant.createdAt,
    updated_at: variant.updatedAt,
  }
}

export function toClaimRow(claim: Claim): ClaimRow {
  return {
    id: claim.id,
    experience_id: claim.experienceId,
    kind: claim.kind,
    statement: claim.statement,
    source_field: claim.sourceField,
    status: claim.status,
    created_at: claim.createdAt,
    updated_at: claim.updatedAt,
  }
}

export function toVariantRows(experience: Experience): readonly VariantRow[] {
  return experience.variants.map(toVariantRow)
}

export function toClaimRows(experience: Experience): readonly ClaimRow[] {
  return experience.claims.map(toClaimRow)
}

export function fromVariantRow(row: VariantRow): Variant {
  return {
    id: asVariantId(requiredText(row.id, 'variant.id')),
    experienceId: asExperienceId(requiredText(row.experience_id, 'variant.experience_id')),
    label: requiredText(row.label, 'variant.label'),
    content: requiredText(row.content, 'variant.content'),
    emphasis: nullableText(row.emphasis, 'variant.emphasis'),
    draftedByRunId:
      row.drafted_by_run_id === null
        ? null
        : asAgentRunId(requiredText(row.drafted_by_run_id, 'variant.drafted_by_run_id')),
    confirmedAt: nullableTimestamp(row.confirmed_at, 'variant.confirmed_at'),
    createdAt: requiredTimestamp(row.created_at, 'variant.created_at'),
    updatedAt: requiredTimestamp(row.updated_at, 'variant.updated_at'),
  }
}

export function fromClaimRow(row: ClaimRow): Claim {
  return {
    id: asClaimId(requiredText(row.id, 'claim.id')),
    experienceId: asExperienceId(requiredText(row.experience_id, 'claim.experience_id')),
    kind: requiredEnum(row.kind, 'claim.kind', isClaimKind),
    statement: requiredText(row.statement, 'claim.statement'),
    sourceField: nullableText(row.source_field, 'claim.source_field'),
    status: requiredEnum(row.status, 'claim.status', isClaimStatus),
    createdAt: requiredTimestamp(row.created_at, 'claim.created_at'),
    updatedAt: requiredTimestamp(row.updated_at, 'claim.updated_at'),
  }
}

export function fromExperienceRowSet(rows: ExperienceRowSet): Experience {
  const row = rows.experience
  return {
    id: asExperienceId(requiredText(row.id, 'experience.id')),
    kind: requiredEnum(row.kind, 'experience.kind', isExperienceKind),
    title: requiredText(row.title, 'experience.title'),
    organization: nullableText(row.organization, 'experience.organization'),
    startDate: nullableIsoDate(row.start_date, 'experience.start_date'),
    endDate: nullableIsoDate(row.end_date, 'experience.end_date'),
    isCurrent: requiredFlag(row.is_current, 'experience.is_current'),
    detail: readJsonRecordEnvelope(row.detail_json, 'experience.detail_json'),
    variants: rows.variants.map(fromVariantRow),
    claims: rows.claims.map(fromClaimRow),
    factVersion: requiredInteger(row.fact_version, 'experience.fact_version'),
    createdAt: requiredTimestamp(row.created_at, 'experience.created_at'),
    updatedAt: requiredTimestamp(row.updated_at, 'experience.updated_at'),
  }
}

function requiredText(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new RowMappingError(column, 'expected text', value)
  }
  return value
}

function nullableText(value: unknown, column: string): string | null {
  if (value === null || value === undefined) return null
  return requiredText(value, column)
}

function requiredInteger(value: unknown, column: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RowMappingError(column, 'expected an integer', value)
  }
  return value
}

function requiredFlag(value: unknown, column: string): boolean {
  if (value !== 0 && value !== 1) {
    throw new RowMappingError(column, 'expected the SQLite boolean 0 or 1', value)
  }
  return value === 1
}

function requiredTimestamp(value: unknown, column: string): DateTime {
  const raw = requiredText(value, column)
  const parsed = parseDateTime(raw)
  if (parsed === null) {
    throw new RowMappingError(column, 'expected an ISO 8601 timestamp', raw)
  }
  return parsed
}

function nullableTimestamp(value: unknown, column: string): DateTime | null {
  if (value === null || value === undefined) return null
  return requiredTimestamp(value, column)
}

function nullableIsoDate(value: unknown, column: string): IsoDate | null {
  if (value === null || value === undefined) return null
  const raw = requiredText(value, column)
  const parsed = parseIsoDate(raw)
  if (parsed === null) {
    throw new RowMappingError(column, 'expected a YYYY-MM-DD calendar date', raw)
  }
  return parsed
}

function requiredEnum<T extends string>(
  value: unknown,
  column: string,
  isMember: (raw: string) => raw is T,
): T {
  const raw = requiredText(value, column)
  if (!isMember(raw)) {
    throw new RowMappingError(column, 'is not one of the permitted values', raw)
  }
  return raw
}
