/**
 * @file stubCompositionRoot
 * @description A composition root for tests that need the provider but not the
 * native container. The same contract as the preview root, with the version and
 * service functions easy to override.
 */

import type { CompositionRoot } from '../../src/bootstrap/capabilities'
import { createInfoService } from '../../src/bootstrap/wiring/info'
import { createResumeService } from '../../src/bootstrap/wiring/resume'
import { DEFAULT_APP_SETTINGS } from '../../src/domain/settings/AppSettings'
import type { AppSettings } from '../../src/domain/settings/AppSettings'
import { FixtureTextMeasurer } from '../../src/infrastructure/measurement/FixtureTextMeasurer'
import { InMemorySecretStore } from '../../src/infrastructure/preview/inMemoryRepositories'
import {
  InMemoryAttachmentRepository,
  InMemoryJobPostingRepository,
} from '../../src/infrastructure/preview/inMemoryConversationRepositories'
import { createPreviewConversationService } from '../../src/bootstrap/previewConversation'
import {
  InMemoryChangeLogRepository,
  InMemoryCustomModuleRepository,
  InMemoryInfoEntryRepository,
} from '../../src/infrastructure/preview/inMemoryInfoRepositories'
import { InMemoryResumeRepository } from '../../src/infrastructure/preview/inMemoryResumeRepository'
import { ResumeEntryReferences } from '../../src/infrastructure/persistence/resume/ResumeEntryReferences'
import { FixedClock, SequentialIdGenerator } from './fakeEnvironment'

export function stubCompositionRoot(overrides: Partial<CompositionRoot> = {}): CompositionRoot {
  const settings: AppSettings = DEFAULT_APP_SETTINGS
  const { service: conversation } = createPreviewConversationService()
  const clock = new FixedClock()
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  const resumes = new InMemoryResumeRepository(clock)
  const info = createInfoService({
    entries,
    customModules,
    references: new ResumeEntryReferences(resumes),
    clock,
    ids: new SequentialIdGenerator('stub'),
  })
  return {
    appInfo: {
      version: '0.0.0-test',
      buildMode: 'test',
      runtime: 'browser',
      license: 'MIT',
      databaseFile: null,
    },
    settings: {
      read: async () => settings,
      save: async (patch) => ({ ...settings, ...patch }),
    },
    info,
    resume: createResumeService({
      resumes,
      entries,
      customModules,
      jobPostings: new InMemoryJobPostingRepository(),
      attachments: new InMemoryAttachmentRepository(),
      updateInfoEntry: info.updateEntry,
      measurer: new FixtureTextMeasurer(),
      clock,
      ids: new SequentialIdGenerator('stub-resume'),
    }),
    conversation,
    secrets: new InMemorySecretStore(),
    shutdown: async () => undefined,
    ...overrides,
  }
}


