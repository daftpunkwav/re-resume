/**
 * @file resumeStudioRoot
 * @description A resume studio wired to the in-memory preview storage. Tests
 * seed the information library and then drive the same use cases the panel
 * calls, so the store, the renderer and the persistence contract are exercised
 * together without a desktop container.
 */

import { createInfoService } from '../../src/bootstrap/wiring/info'
import { createResumeService } from '../../src/bootstrap/wiring/resume'
import type { CompositionRoot, InfoService, ResumeService } from '../../src/bootstrap/capabilities'
import type { InfoEntry } from '../../src/domain/info/InfoEntry'
import type { CustomModuleDefinition } from '../../src/domain/info/CustomModule'
import type { ResumeId, TemplateId } from '../../src/domain/shared/branded-id'
import { listTemplates } from '../../src/domain/resume/Template'
import { FixtureTextMeasurer } from '../../src/infrastructure/measurement/FixtureTextMeasurer'
import {
  InMemoryChangeLogRepository,
  InMemoryCustomModuleRepository,
  InMemoryInfoEntryRepository,
} from '../../src/infrastructure/preview/inMemoryInfoRepositories'
import {
  InMemoryAttachmentRepository,
  InMemoryJobPostingRepository,
} from '../../src/infrastructure/preview/inMemoryConversationRepositories'
import { InMemoryResumeRepository } from '../../src/infrastructure/preview/inMemoryResumeRepository'
import { ResumeEntryReferences } from '../../src/infrastructure/persistence/resume/ResumeEntryReferences'
import { FixedClock, SequentialIdGenerator } from './fakeEnvironment'
import { infoEntryFixture } from './infoFixtures'
import { stubCompositionRoot } from './stubCompositionRoot'

export interface ResumeStudioRoot {
  readonly root: CompositionRoot
  readonly info: InfoService
  readonly resume: ResumeService
  readonly entries: InMemoryInfoEntryRepository
  readonly resumes: InMemoryResumeRepository
  readonly clock: FixedClock
}

/** One entry per built-in module the studio can reference. */
export function studioEntries(): readonly InfoEntry[] {
  return [
    infoEntryFixture({
      id: 'entry-personal',
      moduleKind: 'personal',
      fields: { fullName: '林清越' },
      sortOrder: 1,
    }),
    infoEntryFixture({
      id: 'entry-intent',
      moduleKind: 'jobIntent',
      fields: { targetRole: '前端工程师' },
      sortOrder: 1,
    }),
    infoEntryFixture({
      id: 'entry-education',
      moduleKind: 'education',
      fields: { school: '复旦大学', degree: 'master', startDate: '2021-09', endDate: 'present' },
      sortOrder: 1,
    }),
    infoEntryFixture({
      id: 'entry-project',
      moduleKind: 'project',
      fields: {
        name: '订单中台',
        startDate: '2024-01',
        description: '负责结算链路的组件化拆分。',
      },
      sortOrder: 1,
    }),
    infoEntryFixture({
      id: 'entry-skill',
      moduleKind: 'skill',
      fields: { name: 'TypeScript' },
      sortOrder: 1,
    }),
  ]
}

export function newResumeStudioRoot(input?: {
  readonly entries?: readonly InfoEntry[]
  readonly customModules?: readonly CustomModuleDefinition[]
  readonly seedResumes?: boolean
  /** Replaces the export capability, so an export test need not render a PDF. */
  readonly exportService?: CompositionRoot['export']
}): ResumeStudioRoot {
  const clock = new FixedClock()
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  entries.seed(input?.entries ?? studioEntries())
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  customModules.seed(input?.customModules ?? [])
  const resumes = new InMemoryResumeRepository(clock)
  const info = createInfoService({
    entries,
    customModules,
    references: new ResumeEntryReferences(resumes),
    clock,
    ids: new SequentialIdGenerator('info'),
  })
  const resume = createResumeService({
    resumes,
    entries,
    customModules,
    jobPostings: new InMemoryJobPostingRepository(),
    attachments: new InMemoryAttachmentRepository(),
    updateInfoEntry: info.updateEntry,
    measurer: new FixtureTextMeasurer(),
    clock,
    ids: new SequentialIdGenerator('resume'),
  })
  // A seeded resume is created through the create use case so its revision
  // chain starts the same way the panel's own creation path starts it.
  return {
    root: stubCompositionRoot(
      input?.exportService === undefined
        ? { info, resume }
        : { info, resume, export: input.exportService },
    ),
    info,
    resume,
    entries,
    resumes,
    clock,
  }
}

export interface SeededResume {
  readonly resumeId: ResumeId
  readonly title: string
}

/**
 * Creates a resume and selects the given entry ids for the matching chapters.
 * The chapter ids come from the document the use case returned, not from a
 * second copy of the template's chapter order.
 */
export async function seedResume(
  studio: ResumeStudioRoot,
  options: {
    readonly title: string
    readonly templateId?: TemplateId
    readonly entries?: readonly InfoEntry[]
  },
): Promise<SeededResume> {
  const fallback = listTemplates()[0]
  if (fallback === undefined) throw new Error('The template registry is empty.')
  const created = await studio.resume.createResume({
    title: options.title,
    templateId: options.templateId ?? fallback.id,
  })
  const entries = options.entries ?? studioEntries()
  for (const entry of entries) {
    if (entry.moduleKind === 'custom') continue
    const rendered = await studio.resume.renderResume(created.resumeId)
    const section = rendered.resume.document.sections.find(
      (candidate) => candidate.moduleKind === entry.moduleKind,
    )
    if (section === undefined) continue
    await studio.resume.setSectionSelection({
      resumeId: created.resumeId,
      moduleKind: entry.moduleKind,
      customModuleId: null,
      entryIds: [entry.id],
    })
  }
  return { resumeId: created.resumeId, title: options.title }
}
