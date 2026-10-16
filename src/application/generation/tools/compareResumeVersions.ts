/**
 * @file compareResumeVersions
 * @description Diffs two points of a resume's history for the agent preview.
 * It shares CompareVersions with the editor's version list, so the agent and
 * the user read the same diff.
 *
 * Constraints:
 * - Versions are addressed by identifier, never by seq: revision seq and
 *   snapshot seq are independent counters, so a number cannot name both. The
 *   two id namespaces are told apart by which table holds the value.
 */

import { z } from 'zod'
import { compareVersions } from '../../resume/CompareVersions'
import type { VersionDiff, VersionSelector } from '../../resume/CompareVersions'
import { DomainError } from '../../../domain/shared/DomainError'
import type { Resume } from '../../../domain/resume/Resume'
import type { ResumeRepository } from '../../../domain/resume/ports/ResumeRepository'
import { asResumeId, asRevisionId, asSnapshotId } from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

export const compareResumeVersionsInputSchema = z.object({
  resumeId: z.string().trim().min(1),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
}).strict()

export interface CompareResumeVersionsInput {
  readonly resumeId: string
  /** A RevisionId or a SnapshotId; which one is decided by where it resolves. */
  readonly from: string
  readonly to: string
}

export type CompareResumeVersionsResult =
  | { readonly kind: 'compared'; readonly resumeId: string; readonly diff: VersionDiff }
  | { readonly kind: 'notFound'; readonly resumeId: string }

export const compareResumeVersions: RegisteredTool<
  CompareResumeVersionsInput,
  CompareResumeVersionsResult
> = {
  name: 'compareResumeVersions',
  description:
    'Diff two revisions or snapshots of one resume, addressed by revision or snapshot id.',
  risk: 'read',
  parse: (raw: unknown): Result<CompareResumeVersionsInput> => {
    const parsed = compareResumeVersionsInputSchema.safeParse(raw)
    return parsed.success ? ok(parsed.data) : err(parsed.error)
  },
  execute: async (
    input: CompareResumeVersionsInput,
    ctx: ToolContext,
  ): Promise<CompareResumeVersionsResult> => {
    const resume = await ctx.resumes.findById(asResumeId(input.resumeId))
    if (resume === null) return { kind: 'notFound', resumeId: input.resumeId }
    const from = await resolveSelector(ctx.resumes, resume, input.from)
    const to = await resolveSelector(ctx.resumes, resume, input.to)
    return {
      kind: 'compared',
      resumeId: resume.id,
      diff: await compareVersions(ctx.resumes, from, to),
    }
  },
}

async function resolveSelector(
  resumeRepo: ResumeRepository,
  resume: Resume,
  versionId: string,
): Promise<VersionSelector> {
  if (resume.snapshots.some((snapshot) => snapshot.id === versionId)) {
    return { kind: 'snapshot', id: asSnapshotId(versionId) }
  }
  const revision = await resumeRepo.readRevision(asRevisionId(versionId))
  if (revision !== null && revision.resumeId === resume.id) {
    return { kind: 'revision', id: revision.id }
  }
  // The closed DomainError code set has no not-found member; this is the code
  // CompareVersions itself reports for an unresolvable version.
  throw new DomainError('cursorNotOnLiveChain', 'The selected version does not exist.', {
    entity: 'resume',
    id: resume.id,
    blockers: [versionId],
  })
}
