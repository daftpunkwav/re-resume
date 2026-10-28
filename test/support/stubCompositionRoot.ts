/**
 * @file stubCompositionRoot
 * @description A composition root for tests that need the provider but not the
 * native container. The same contract as the preview root, with the version and
 * service functions easy to override.
 */

import type { CompositionRoot } from '../../src/bootstrap/capabilities'
import { createInfoService } from '../../src/bootstrap/wiring/info'
import { createResumeService } from '../../src/bootstrap/wiring/resume'
import { createLibraryChangesService } from '../../src/bootstrap/wiring/changes'
import { createProviderService } from '../../src/bootstrap/wiring/providers'
import { createAppSettingsService } from '../../src/bootstrap/wiring/appSettings'
import { createSeedDataService } from '../../src/bootstrap/wiring/seed'
import { DEFAULT_APP_SETTINGS } from '../../src/domain/settings/AppSettings'
import type { AppSettings } from '../../src/domain/settings/AppSettings'
import { BACKUP_APP_MARKER, BACKUP_DOCUMENT_VERSION, BACKUP_SCHEMA_VERSION } from '../../src/domain/backup/BackupDocument'
import type { DateTime } from '../../src/domain/shared/DateTime'
import { FixtureTextMeasurer } from '../../src/infrastructure/measurement/FixtureTextMeasurer'
import {
  InMemoryAppSettingsRepository,
  InMemoryProviderConfigRepository,
  InMemorySecretStore,
} from '../../src/infrastructure/preview/inMemoryRepositories'
import { createPreviewConversationService } from '../../src/bootstrap/previewConversation'
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
import { ScriptedModelProvider } from '../../src/infrastructure/preview/ScriptedModelProvider'

export function stubCompositionRoot(overrides: Partial<CompositionRoot> = {}): CompositionRoot {
  const settings: AppSettings = DEFAULT_APP_SETTINGS
  const conversationAssembly = createPreviewConversationService()
  const conversation = conversationAssembly.service
  const clock = new FixedClock()
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  const settingsRepository = new InMemoryAppSettingsRepository(settings)
  const secrets = new InMemorySecretStore()
  const resumes = new InMemoryResumeRepository(clock)
  const info = createInfoService({
    entries,
    customModules,
    references: new ResumeEntryReferences(resumes),
    clock,
    ids: new SequentialIdGenerator('stub'),
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
    ids: new SequentialIdGenerator('stub-resume'),
  })
  return {
    appInfo: {
      version: '0.0.0-test',
      buildMode: 'test',
      runtime: 'browser',
      license: 'MIT',
      databaseFile: null,
    },
    // A root for tests that only exercises the interface. Backup is available
    // but holds no content; a test that needs a real document supplies its own
    // override.
    backup: {
      canManageData: true,
      exportDocument: async () => ({
        v: BACKUP_DOCUMENT_VERSION,
        app: BACKUP_APP_MARKER,
        exportedAt: '2026-01-01T00:00:00.000Z' as DateTime,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        tables: {},
        attachments: [],
      }),
      inspectDocument: () => ({ tables: {}, attachments: 0 }),
      importDocument: async () => ({ tables: {}, attachments: 0 }),
      clearAllData: async () => ({
        removedAttachments: 0,
        removedSecrets: 0,
        undeletedFiles: [],
        undeletedSecrets: [],
      }),
      cleanupOrphanAttachments: async () => ({ removed: 0, undeletedFiles: [] }),
    },
    seed: createSeedDataService({
      settings: settingsRepository,
      info,
      resume,
      conversation,
      messages: conversationAssembly.state.messages,
      clock,
    }),
    settings: createAppSettingsService({ repository: settingsRepository }),
    info,
    resume,
    conversation,
    providers: createProviderService({
      providers: new InMemoryProviderConfigRepository(),
      settings: settingsRepository,
      secrets,
      clock,
      ids: new SequentialIdGenerator('stub-provider'),
      createProvider: () => new ScriptedModelProvider({ script: [] }),
    }),
    libraryChanges: createLibraryChangesService({ changes, entries, customModules, resumes, clock }),
    secrets,
    shutdown: async () => undefined,
    ...overrides,
  }
}
