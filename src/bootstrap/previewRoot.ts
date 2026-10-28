/**
 * @file previewRoot
 * @description The composition root used by the browser preview. It answers
 * the same contract as the native root, backed by memory instead of SQLite, so
 * the interface needs no preview branch of its own.
 *
 * Responsibilities:
 * - Seed the fixture information library, the fixture resumes and the scripted
 *   conversation into in-memory repositories
 * - Use the deterministic clock and identifier source so a session is repeatable
 * - Answer the library's reference question from the in-memory resumes
 * - Measure with the fixture measurer, never the bundled fonts
 *
 * Constraints:
 * - Only loaded when the window is served in development with `?preview`; the
 *   production bundle does not contain this module.
 * - Areas added later extend this file by one wiring import and one spread;
 *   the root's contract stays in `capabilities.ts`.
 */

import type { CompositionRoot } from './capabilities'
import { describeAppInfo } from './buildInfo'
import { createAppSettingsService } from './wiring/appSettings'
import { createInfoService } from './wiring/info'
import { createResumeService } from './wiring/resume'
import {
  InMemoryAppSettingsRepository,
  InMemorySecretStore,
} from '../infrastructure/preview/inMemoryRepositories'
import {
  InMemoryChangeLogRepository,
  InMemoryCustomModuleRepository,
  InMemoryInfoEntryRepository,
} from '../infrastructure/preview/inMemoryInfoRepositories'
import {
  FakeClock,
  SequentialIdGenerator,
} from '../infrastructure/preview/deterministicEnvironment'
import { FixtureTextMeasurer } from '../infrastructure/measurement/FixtureTextMeasurer'
import { InMemoryResumeRepository } from '../infrastructure/preview/inMemoryResumeRepository'
import { ResumeEntryReferences } from '../infrastructure/persistence/resume/ResumeEntryReferences'
import { PREVIEW_SETTINGS } from '../infrastructure/preview/fixtures'
import {
  PREVIEW_INFO_CUSTOM_MODULES,
  PREVIEW_INFO_ENTRIES,
} from '../infrastructure/preview/fixtures.info'
import { PREVIEW_RESUMES } from '../infrastructure/preview/fixtures.resume'
import {
  InMemoryAttachmentRepository,
  InMemoryJobPostingRepository,
} from '../infrastructure/preview/inMemoryConversationRepositories'
import { createPreviewConversationService } from './previewConversation'

export function createPreviewRoot(): CompositionRoot {
  const clock = new FakeClock()
  const settingsRepository = new InMemoryAppSettingsRepository(PREVIEW_SETTINGS)
  const measurer = new FixtureTextMeasurer()

  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  entries.seed(PREVIEW_INFO_ENTRIES)
  customModules.seed(PREVIEW_INFO_CUSTOM_MODULES)

  const resumes = new InMemoryResumeRepository(clock)
  resumes.seed(PREVIEW_RESUMES)

  const info = createInfoService({
    entries,
    customModules,
    references: new ResumeEntryReferences(resumes),
    clock,
    ids: new SequentialIdGenerator('preview-info'),
  })
  const resume = createResumeService({
    resumes,
    entries,
    customModules,
    jobPostings: new InMemoryJobPostingRepository(),
    attachments: new InMemoryAttachmentRepository(),
    updateInfoEntry: info.updateEntry,
    measurer,
    clock,
    ids: new SequentialIdGenerator('preview-resume'),
  })
  const { service: conversation } = createPreviewConversationService()

  return {
    appInfo: describeAppInfo({ runtime: 'browser', databaseFile: null }),
    settings: createAppSettingsService({ repository: settingsRepository }),
    info,
    resume,
    conversation,
    secrets: new InMemorySecretStore(),
    shutdown: async (): Promise<void> => undefined,
  }
}


