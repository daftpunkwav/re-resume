/**
 * @file ExperienceKind
 * @description The closed set of experience categories. Kept as a tuple so the
 * value set and the derived type cannot drift apart.
 */

export const EXPERIENCE_KINDS = [
  'education',
  'internship',
  'work',
  'project',
  'award',
  'skill',
  'summary',
] as const

export type ExperienceKind = (typeof EXPERIENCE_KINDS)[number]

export function isExperienceKind(raw: string): raw is ExperienceKind {
  return (EXPERIENCE_KINDS as readonly string[]).includes(raw)
}
