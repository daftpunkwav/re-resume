/**
 * @file experienceDetailSchemas
 * @description Per-kind shapes for Experience.detail. The aggregate stores an
 * untyped record and delegates the shape to this layer, so this is the only
 * place the fields of a kind are declared.
 *
 * Responsibilities:
 * - Declare one schema per ExperienceKind and dispatch on the kind
 * - Strip unknown keys, so a field no schema carries cannot persist unnoticed
 *
 * Constraints:
 * - This module must not depend on use cases, repositories or UI components.
 * - Fields are stored exactly as supplied. The aggregate invents no defaults
 *   for detail, so an absent field stays absent rather than becoming "".
 */

import { z } from 'zod'
import type { ExperienceKind } from '../../domain/catalog/ExperienceKind'
import { err, ok } from '../../domain/shared/Result'
import type { Result } from '../../domain/shared/Result'

const nonEmptyText = z.string().trim().min(1)
const textList = z.array(nonEmptyText)

export const educationDetailSchema = z.object({
  school: nonEmptyText,
  degree: nonEmptyText,
  major: nonEmptyText,
  /** Kept as text: scales differ ("3.8", "3.8/4.0", "A") and the catalog does
   *  not compute an average across kinds. */
  gpa: nonEmptyText.optional(),
  honors: textList.optional(),
})

export const internshipDetailSchema = z.object({
  company: nonEmptyText,
  team: nonEmptyText.optional(),
  role: nonEmptyText,
  technologies: textList,
})

export const workDetailSchema = z.object({
  company: nonEmptyText,
  department: nonEmptyText.optional(),
  role: nonEmptyText,
  technologies: textList,
  highlights: textList,
})

export const projectDetailSchema = z.object({
  repoUrl: nonEmptyText.optional(),
  technologies: textList,
  role: nonEmptyText,
  highlights: textList,
})

export const awardDetailSchema = z.object({
  issuer: nonEmptyText,
  level: nonEmptyText.optional(),
  certificateNo: nonEmptyText.optional(),
})

export const skillDetailSchema = z.object({
  category: nonEmptyText,
  items: textList,
  proficiency: nonEmptyText.optional(),
})

export const summaryDetailSchema = z.object({
  highlights: textList,
})

/**
 * Typed as a record rather than a switch so that adding an ExperienceKind
 * fails to compile until its schema exists here.
 */
export const EXPERIENCE_DETAIL_SCHEMAS: Readonly<
  Record<ExperienceKind, z.ZodType<Record<string, unknown>>>
> = {
  education: educationDetailSchema,
  internship: internshipDetailSchema,
  work: workDetailSchema,
  project: projectDetailSchema,
  award: awardDetailSchema,
  skill: skillDetailSchema,
  summary: summaryDetailSchema,
}

export type ExperienceDetailError = z.ZodError

/** Validates a detail record against the schema its kind selects. */
export function parseExperienceDetail(
  kind: ExperienceKind,
  raw: Readonly<Record<string, unknown>>,
): Result<Record<string, unknown>, ExperienceDetailError> {
  const parsed = EXPERIENCE_DETAIL_SCHEMAS[kind].safeParse(raw)
  return parsed.success ? ok(parsed.data) : err(parsed.error)
}
