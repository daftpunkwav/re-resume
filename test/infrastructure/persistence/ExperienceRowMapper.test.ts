import { describe, expect, it } from 'vitest'
import {
  fromExperienceRowSet,
  toClaimRows,
  toExperienceRow,
  toVariantRows,
} from '../../../src/infrastructure/persistence/mappers/ExperienceRowMapper'
import type { ClaimRow, ExperienceRow } from '../../../src/infrastructure/persistence/mappers/ExperienceRowMapper'
import { RowMappingError } from '../../../src/infrastructure/persistence/JsonEnvelope'
import { addClaim, addVariant, createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime, parseIsoDate } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  asAgentRunId,
  asClaimId,
  asExperienceId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'

const NOW = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const LATER = parseDateTime('2026-03-02T00:00:00.000Z') as DateTime

function workExperience(): Experience {
  const created = createExperience(
    {
      id: asExperienceId('exp-1'),
      kind: 'work',
      title: '后端工程师',
      organization: '某公司',
      startDate: parseIsoDate('2024-01-01'),
      isCurrent: true,
      detail: { teamSize: 5, stack: ['TypeScript', 'Rust'] },
    },
    NOW,
  )
  const withVariant = addVariant(
    created,
    {
      id: asVariantId('var-1'),
      label: '架构导向',
      content: '主导服务拆分',
      emphasis: '服务拆分',
      draftedByRunId: asAgentRunId('run-1'),
      confirmedAt: null,
    },
    LATER,
  )
  return addClaim(
    withVariant,
    {
      id: asClaimId('claim-1'),
      kind: 'metric',
      statement: '线上延迟下降 30%',
      sourceField: 'detail.latency',
      status: 'confirmed',
    },
    LATER,
  )
}

function readExperience(row: ExperienceRow, experience: Experience = workExperience()): Experience {
  return fromExperienceRowSet({
    experience: row,
    variants: toVariantRows(experience),
    claims: toClaimRows(experience),
  })
}

function experienceRowWith(overrides: Partial<ExperienceRow>): ExperienceRow {
  return { ...toExperienceRow(workExperience()), ...overrides }
}

describe('ExperienceRowMapper', () => {
  it('round-trips an experience with its variants and claims', () => {
    const experience = workExperience()

    const restored = fromExperienceRowSet({
      experience: toExperienceRow(experience),
      variants: toVariantRows(experience),
      claims: toClaimRows(experience),
    })

    expect(restored).toEqual(experience)
  })

  it('stores detail inside a versioned envelope rather than as a bare value', () => {
    const row = toExperienceRow(workExperience())

    expect(JSON.parse(row.detail_json)).toEqual({ v: 1, data: { teamSize: 5, stack: ['TypeScript', 'Rust'] } })
  })

  it('stores is_current as the SQLite boolean', () => {
    const row = toExperienceRow(workExperience())

    expect(row.is_current).toBe(1)
  })

  it('rebuilds identifiers with their brands rather than as bare strings', () => {
    const experience = workExperience()

    const restored = readExperience(toExperienceRow(experience))

    expect(restored.variants[0]?.id).toBe(asVariantId('var-1'))
    expect(restored.variants[0]?.draftedByRunId).toBe(asAgentRunId('run-1'))
    expect(restored.claims[0]?.experienceId).toBe(asExperienceId('exp-1'))
  })

  it('rejects an experience kind outside the closed set', () => {
    expect(() => readExperience(experienceRowWith({ kind: 'apprenticeship' }))).toThrow(RowMappingError)
    expect(() => readExperience(experienceRowWith({ kind: 'apprenticeship' }))).toThrow(
      /experience.kind/,
    )
  })

  it('rejects a calendar date that does not exist', () => {
    expect(() => readExperience(experienceRowWith({ start_date: '2026-02-31' }))).toThrow(RowMappingError)
  })

  it('rejects a calendar date that is not in YYYY-MM-DD form', () => {
    expect(() => readExperience(experienceRowWith({ start_date: '2026-1-1' }))).toThrow(RowMappingError)
  })

  it('rejects a timestamp column that is not a timestamp', () => {
    expect(() => readExperience(experienceRowWith({ updated_at: 'yesterday' }))).toThrow(
      /experience.updated_at/,
    )
  })

  it('rejects a bare JSON object or array as detail, which is not an envelope', () => {
    expect(() => readExperience(experienceRowWith({ detail_json: '{}' }))).toThrow(
      /envelope version missing/,
    )
    expect(() => readExperience(experienceRowWith({ detail_json: '[]' }))).toThrow(
      /not a JSON envelope object/,
    )
  })

  it('rejects an envelope version this build does not know', () => {
    expect(() =>
      readExperience(experienceRowWith({ detail_json: '{"v":2,"data":{}}' })),
    ).toThrow(/envelope version 2 is not supported/)
  })

  it('rejects an envelope payload that is not an object', () => {
    expect(() => readExperience(experienceRowWith({ detail_json: '{"v":1,"data":[]}' }))).toThrow(
      /envelope payload is not a JSON object/,
    )
  })

  it('rejects an is_current column that is neither 0 nor 1', () => {
    expect(() => readExperience(experienceRowWith({ is_current: 2 }))).toThrow(/SQLite boolean/)
  })

  it('rejects a claim status outside the closed set', () => {
    const experience = workExperience()
    const corrupted = [withClaimField(experience, { status: 'archived' })]

    expect(() =>
      fromExperienceRowSet({ experience: toExperienceRow(experience), variants: [], claims: corrupted }),
    ).toThrow(/claim.status/)
  })

  it('rejects a claim kind outside the closed set', () => {
    const experience = workExperience()
    const corrupted = [withClaimField(experience, { kind: 'opinion' })]

    expect(() =>
      fromExperienceRowSet({ experience: toExperienceRow(experience), variants: [], claims: corrupted }),
    ).toThrow(/claim.kind/)
  })
})

/** Corrupts one column of the fixture's first claim row. */
function withClaimField(experience: Experience, changes: Partial<ClaimRow>): ClaimRow {
  const [first] = toClaimRows(experience)
  if (first === undefined) throw new Error('the fixture must own at least one claim row')
  return { ...first, ...changes }
}
