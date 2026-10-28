/**
 * @file agentReveal.test
 * @description The revision diff behind "locate": which sections a new resume
 * revision changed, and which stored revision is the one before it.
 */

import { describe, expect, it } from 'vitest'

import {
  changedSectionIds,
  previousRevisionOf,
} from '../../../../src/presentation/features/resume/agentReveal'
import type { ResumeDocumentState } from '../../../../src/domain/resume/DocumentState'
import type { ResumeSection } from '../../../../src/domain/resume/ResumeSection'
import type { Revision } from '../../../../src/domain/resume/Revision'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import {
  asInfoEntryId,
  asResumeId,
  asResumeOverrideId,
  asResumeSectionId,
  asRevisionId,
  asTemplateId,
} from '../../../../src/domain/shared/branded-id'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

function section(
  id: string,
  entryIds: readonly string[],
  overrides: Partial<ResumeSection> = {},
): ResumeSection {
  return {
    id: asResumeSectionId(id),
    moduleKind: 'project',
    customModuleId: null,
    displayName: null,
    entryIds: entryIds.map((entryId) => asInfoEntryId(entryId)),
    visible: true,
    column: 1,
    sortOrder: 1,
    ...overrides,
  }
}

function state(
  sections: readonly ResumeSection[],
  overrides: ResumeDocumentState['overrides'] = [],
): ResumeDocumentState {
  return {
    sections,
    overrides,
    templateId: asTemplateId('apple-clean'),
    appearance: {} as ResumeDocumentState['appearance'],
    pageSetup: {} as ResumeDocumentState['pageSetup'],
    canvas: { freeBlocks: [] } as ResumeDocumentState['canvas'],
  }
}

function revision(id: string, seq: number, document: ResumeDocumentState, superseded = false): Revision {
  return {
    id: asRevisionId(id),
    resumeId: asResumeId('resume-1'),
    seq,
    label: '助手修改',
    origin: 'agent',
    runId: null,
    state: document,
    supersededAt: superseded ? AT : null,
    createdAt: AT,
  }
}

describe('changedSectionIds', () => {
  it('names an added section and an edited section, not an untouched one', () => {
    const before = state([section('s1', ['e1']), section('s2', ['e2'])])
    const after = state([
      section('s1', ['e1', 'e3']),
      section('s2', ['e2']),
      section('s3', ['e4']),
    ])

    expect([...changedSectionIds(before, after)].sort()).toEqual(['s1', 's3'])
  })

  it('names the section that renders a changed entry override', () => {
    const before = state([section('s1', ['e1']), section('s2', ['e2'])])
    const after = state(
      [section('s1', ['e1']), section('s2', ['e2'])],
      [
        {
          id: asResumeOverrideId('o1'),
          target: { kind: 'entry', entryId: asInfoEntryId('e2') },
          text: '更有针对性的描述',
          origin: 'agent',
          sourceRunId: null,
          editedByUser: false,
          createdAt: AT,
          updatedAt: AT,
        },
      ],
    )

    expect(changedSectionIds(before, after)).toEqual(['s2'])
  })

  it('falls back to the visible sections for the first stored revision', () => {
    const after = state([
      section('s1', ['e1']),
      section('s2', ['e2'], { visible: false }),
    ])

    expect(changedSectionIds(null, after)).toEqual(['s1'])
  })
})

describe('previousRevisionOf', () => {
  it('picks the newest live revision before the target', () => {
    const revisions = [
      revision('r1', 1, state([])),
      revision('r2', 2, state([])),
      revision('r3', 3, state([]), true),
      revision('r4', 4, state([])),
    ]

    expect(previousRevisionOf(revisions, revisions[3] as Revision)?.id).toBe('r2')
  })

  it('has no predecessor for the opening revision', () => {
    const first = revision('r1', 1, state([]))
    expect(previousRevisionOf([first], first)).toBeUndefined()
  })
})
