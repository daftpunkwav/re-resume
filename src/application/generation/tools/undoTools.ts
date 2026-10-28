/**
 * @file undoTools
 * @description Taking back one agent write. Two mechanisms meet here: a library
 * write is reversed by its change record (newest first, per the change log's
 * ordering rules), while a resume document write is reversed by moving the
 * revision cursor back — and only while that revision is still the cursor, since
 * a later write would make the undo lie about the current document.
 *
 * Responsibilities:
 * - `undoRevision`: the capability the tool card uses for a resume write
 * - `undoAgentChange`: reverses a set of library change identifiers and/or one
 *   resume revision, refusing anything that was not written by an agent
 * - `undoLastChange` tool: the model's own spelling of "take that back"
 *
 * Constraints:
 * - Undo never produces a new change record or revision: the stamp or the moved
 *   cursor is the audit.
 * - A user's manual edit is never undone from a tool card; the origin check
 *   refuses it.
 */

import { z } from 'zod'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import type { ChangeRecordId, ResumeId, RevisionId } from '../../../domain/shared/branded-id'
import {
  asChangeRecordId,
  asResumeId,
  asRevisionId,
} from '../../../domain/shared/branded-id'
import { DomainError } from '../../../domain/shared/DomainError'
import { createLibraryChangeInverseWriter } from '../../changes/libraryChangeInverseWriter'
import { undoLibraryChange } from '../../changes/undoLibraryChange'
import { undoResumeChange } from '../../resume/undoResumeChange'
import type { ToolPackDeps } from './deps'
import { defineTool, executeSafely } from './toolSchema'
import type { ToolDefinition } from './toolSchema'

export interface UndoRevisionInput {
  readonly resumeId: ResumeId
  readonly revisionId: RevisionId
}

export interface UndoRevisionOutput {
  readonly label: string
}

/** The card-level undo of one resume revision. */
export async function undoRevision(
  deps: Pick<ToolPackDeps, 'resumes'>,
  input: UndoRevisionInput,
): Promise<UndoRevisionOutput> {
  const resume = await deps.resumes.findById(input.resumeId)
  if (resume === null) {
    throw new DomainError('resumeNotFound', 'The resume does not exist.', {
      entity: 'resume',
      id: input.resumeId,
      blockers: [input.resumeId],
    })
  }
  if (resume.status === 'frozen') {
    throw new DomainError('resumeFrozen', '冻结的简历不能撤销修改。', {
      entity: 'resume',
      id: input.resumeId,
      blockers: [],
    })
  }
  if (resume.currentRevision !== input.revisionId) {
    throw new DomainError(
      'changeOutOfOrder',
      '该修改已不是简历的当前版本，无法撤销；请先撤销更晚的修改。',
      {
        entity: 'resume',
        id: input.resumeId,
        blockers: [input.revisionId, resume.currentRevision],
      },
    )
  }
  const revision = await deps.resumes.readRevision(input.revisionId)
  if (revision === null) {
    throw new DomainError('changeNotFound', '要撤销的修订不存在。', {
      entity: 'resume',
      id: input.resumeId,
      blockers: [input.revisionId],
    })
  }
  if (revision.origin !== 'agent') {
    throw new DomainError('changeOutOfOrder', '只能撤销 Agent 产生的修改。', {
      entity: 'resume',
      id: input.resumeId,
      blockers: [input.revisionId],
    })
  }
  await undoResumeChange({ resumes: deps.resumes }, input.resumeId)
  return { label: revision.label }
}

export interface UndoAgentChangeInput {
  /** Library change identifiers, applied in reverse order. */
  readonly changeIds?: readonly ChangeRecordId[]
  /** A resume revision; requires `resumeId`. */
  readonly revisionId?: RevisionId
  readonly resumeId?: ResumeId
}

export interface UndoAgentChangeOutput {
  readonly undone: readonly string[]
}

/**
 * Reverses the agent writes a tool card names. Library changes are undone newest
 * first; a resume revision is undone only while it is the cursor.
 */
export async function undoAgentChange(
  deps: Pick<
    ToolPackDeps,
    'changes' | 'entries' | 'customModules' | 'resumes' | 'clock'
  >,
  input: UndoAgentChangeInput,
): Promise<UndoAgentChangeOutput> {
  const undone: string[] = []
  const inverse = createLibraryChangeInverseWriter({
    changes: deps.changes,
    entries: deps.entries,
    customModules: deps.customModules,
    clock: deps.clock,
  })
  for (const changeId of [...(input.changeIds ?? [])].reverse()) {
    const record = await deps.changes.findById(changeId)
    if (record === null) {
      throw new DomainError('changeNotFound', '要撤销的修改记录不存在。', {
        entity: 'changeRecord',
        id: changeId,
        blockers: [changeId],
      })
    }
    if (record.origin !== 'agent') {
      throw new DomainError('changeOutOfOrder', '只能撤销 Agent 产生的修改。', {
        entity: 'changeRecord',
        id: changeId,
        blockers: [changeId],
      })
    }
    const undoneRecord = await undoLibraryChange(
      { changes: deps.changes, inverse, clock: deps.clock },
      { changeId },
    )
    undone.push(undoneRecord.label)
  }
  if (input.revisionId !== undefined) {
    if (input.resumeId === undefined) {
      throw new DomainError('blankRequiredField', '撤销简历修订需要提供简历标识。', {
        entity: 'resume',
        id: '',
        blockers: ['resumeId'],
      })
    }
    const result = await undoRevision(deps, {
      resumeId: input.resumeId,
      revisionId: input.revisionId,
    })
    undone.push(result.label)
  }
  if (undone.length === 0) {
    throw new DomainError('blankRequiredField', '没有指定要撤销的修改。', {
      entity: 'changeRecord',
      id: '',
      blockers: ['changeId'],
    })
  }
  return { undone }
}

export function createUndoTools(deps: ToolPackDeps): readonly ToolDefinition<unknown>[] {
  return [
    defineTool({
      name: 'undoLastChange',
      description:
        '撤销上一步 Agent 修改：target=library 时按 changeId 撤销信息库变更；target=resume 时回退简历最近一次修订。',
      risk: 'write',
      schema: z.strictObject({
        target: z.enum(['resume', 'library']),
        resumeId: z.string().trim().min(1).optional(),
        changeId: z.string().trim().min(1).optional(),
      }),
      execute: (input, _context: ToolContext) =>
        executeSafely(async () => {
          if (input.target === 'library') {
            if (input.changeId === undefined) {
              throw new DomainError('blankRequiredField', '撤销信息库变更需要提供 changeId。', {
                entity: 'changeRecord',
                id: '',
                blockers: ['changeId'],
              })
            }
            const result = await undoAgentChange(deps, {
              changeIds: [asChangeRecordId(input.changeId)],
            })
            return { undone: true, label: result.undone[0] ?? '' }
          }
          if (input.resumeId === undefined) {
            throw new DomainError('blankRequiredField', '撤销简历修订需要提供 resumeId。', {
              entity: 'resume',
              id: '',
              blockers: ['resumeId'],
            })
          }
          const resumeId = asResumeId(input.resumeId)
          const resume = await deps.resumes.findById(resumeId)
          if (resume === null) {
            throw new DomainError('resumeNotFound', 'The resume does not exist.', {
              entity: 'resume',
              id: resumeId,
              blockers: [resumeId],
            })
          }
          const result = await undoAgentChange(deps, {
            resumeId,
            revisionId: asRevisionId(resume.currentRevision),
          })
          return { undone: true, label: result.undone[0] ?? '' }
        }),
    }),
  ]
}
