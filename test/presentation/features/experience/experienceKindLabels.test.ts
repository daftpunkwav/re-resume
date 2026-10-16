/**
 * @file experienceKindLabels.test
 * @description The detail form is generated from the Zod schemas, so a new kind
 * or a new field appears there without this feature changing. That only holds
 * while every field those schemas declare has interface text.
 */

import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { EXPERIENCE_DETAIL_SCHEMAS } from '../../../../src/application/catalog/experienceDetailSchemas'
import {
  CLAIM_KIND_LABELS,
  CLAIM_STATUS_LABELS,
  describeCommandFailure,
  EXPERIENCE_FIELD_LABELS,
  EXPERIENCE_KIND_LABELS,
} from '../../../../src/presentation/features/experience/experienceKindLabels'
import { CLAIM_KINDS } from '../../../../src/domain/catalog/ClaimKind'
import { CLAIM_STATUSES } from '../../../../src/domain/catalog/ClaimStatus'
import { EXPERIENCE_KINDS } from '../../../../src/domain/catalog/ExperienceKind'

describe('catalog vocabulary', () => {
  it('names every kind, status and detail field the schemas declare', () => {
    const unnamed: string[] = []
    for (const kind of EXPERIENCE_KINDS) {
      if (EXPERIENCE_KIND_LABELS[kind] === undefined) unnamed.push(`kind:${kind}`)
      const schema = EXPERIENCE_DETAIL_SCHEMAS[kind] as z.ZodObject<{ [key: string]: z.ZodType }>
      for (const field of Object.keys(schema.shape)) {
        if (EXPERIENCE_FIELD_LABELS[field] === undefined) unnamed.push(`${kind}.${field}`)
      }
    }
    for (const kind of CLAIM_KINDS) {
      if (CLAIM_KIND_LABELS[kind] === undefined) unnamed.push(`claimKind:${kind}`)
    }
    for (const status of CLAIM_STATUSES) {
      if (CLAIM_STATUS_LABELS[status] === undefined) unnamed.push(`claimStatus:${status}`)
    }

    expect(unnamed).toEqual([])
  })

  it('names the offending field in a rejected command', () => {
    const rejected = EXPERIENCE_DETAIL_SCHEMAS.education.safeParse({ degree: '学士' })

    expect(rejected.success).toBe(false)
    if (rejected.success) return
    expect(describeCommandFailure(rejected.error)).toMatch(/^学校：/)
  })
})
