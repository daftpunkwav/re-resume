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
 * - `?script=slow|failure` chooses the replay the scripted model uses; nothing
 *   else about the preview changes.
 */

import type { CompositionRoot } from './capabilities'
import { describeAppInfo } from './buildInfo'
import { createAppSettingsService } from './wiring/appSettings'
import { createInfoService } from './wiring/info'
import { createResumeService } from './wiring/resume'
import { createLibraryChangesService } from './wiring/changes'
import { createProviderService } from './wiring/providers'
import { createBackupService } from './wiring/appSettings'
import { createSeedDataService } from './wiring/seed'
import type { ProviderService } from './capabilities'
import type { AppSettingsRepository } from '../domain/settings/ports/AppSettingsRepository'
import type { SecretStore } from '../domain/generation/ports/SecretStore'
import {
  InMemoryAppSettingsRepository,
  InMemoryProviderConfigRepository,
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
import {
  PREVIEW_PROBE_SCRIPT,
  PREVIEW_PROVIDER_CREDENTIAL,
  PREVIEW_PROVIDERS,
  PREVIEW_SETTINGS,
} from '../infrastructure/preview/fixtures'
import {
  PREVIEW_CHANGE_RECORD,
  PREVIEW_CONVERSATION_SCRIPT,
  PREVIEW_FAILURE_MESSAGE,
  PREVIEW_FAILURE_SCRIPT,
  PREVIEW_SLOW_SCRIPT,
} from '../infrastructure/preview/fixtures.conversation'
import {
  PREVIEW_INFO_CUSTOM_MODULES,
  PREVIEW_INFO_ENTRIES,
} from '../infrastructure/preview/fixtures.info'
import { PREVIEW_RESUMES } from '../infrastructure/preview/fixtures.resume'
import {
  InMemoryAttachmentRepository,
  InMemoryJobPostingRepository,
} from '../infrastructure/preview/inMemoryConversationRepositories'
import { ScriptedModelProvider } from '../infrastructure/preview/ScriptedModelProvider'
import { createPreviewConversationService } from './previewConversation'
import type { PreviewConversationOptions } from './previewConversation'

/** The replay selected by `?script=`; the default script answers normally. */
function readReplay(): PreviewConversationOptions {
  if (typeof window === 'undefined') return {}
  const script = new URLSearchParams(window.location.search).get('script')
  switch (script) {
    case 'slow':
      return { script: PREVIEW_SLOW_SCRIPT, pauseMs: 420 }
    case 'failure':
      return {
        script: PREVIEW_FAILURE_SCRIPT,
        pauseMs: 160,
        failure: {
          message: PREVIEW_FAILURE_MESSAGE,
          retryable: true,
          status: 503,
          afterChunks: PREVIEW_FAILURE_SCRIPT.length,
        },
      }
    default:
      return { script: PREVIEW_CONVERSATION_SCRIPT }
  }
}

/**
 * The preview library, its change log and the undo service share one set of
 * repositories: undoing a preview write is visible to the information panel the
 * same way it is in the native root.
 */
function createPreviewLibrary(): {
  readonly info: CompositionRoot['info']
  readonly libraryChanges: CompositionRoot['libraryChanges']
  readonly resume: CompositionRoot['resume']
} {
  const clock = new FakeClock()
  const ids = new SequentialIdGenerator('preview-info')
  const changes = new InMemoryChangeLogRepository([PREVIEW_CHANGE_RECORD])
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
    ids,
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
    ids: new SequentialIdGenerator('preview-resume'),
  })
  return {
    info,
    resume,
    libraryChanges: createLibraryChangesService({ changes, entries, customModules, clock }),
  }
}

function createPreviewProviders(deps: {
  readonly settings: AppSettingsRepository
  readonly secrets: SecretStore
}): ProviderService {
  const providers = new InMemoryProviderConfigRepository(PREVIEW_PROVIDERS)
  const clock = new FakeClock()
  const ids = new SequentialIdGenerator('preview-provider')
  return createProviderService({
    providers,
    settings: deps.settings,
    secrets: deps.secrets,
    clock,
    ids,
    // The preview has no network. The probe replays one frame, which is what a
    // reachable endpoint would deliver, so the connection state is rendered
    // truthfully for the harness even though no socket is opened.
    createProvider: () =>
      new ScriptedModelProvider({ id: 'preview-probe', script: PREVIEW_PROBE_SCRIPT }),
  })
}

/** The memory state a preview window keeps across a settings rebuild. */
interface PreviewState {
  readonly settings: InMemoryAppSettingsRepository
  readonly secrets: InMemorySecretStore
  readonly conversation: CompositionRoot['conversation']
  readonly info: CompositionRoot['info']
  readonly resume: CompositionRoot['resume']
  readonly libraryChanges: CompositionRoot['libraryChanges']
  readonly providers: ProviderService
  readonly seed: CompositionRoot['seed']
}

let windowState: PreviewState | null = null

function createPreviewState(): PreviewState {
  const settings = new InMemoryAppSettingsRepository(PREVIEW_SETTINGS)
  const secrets = new InMemorySecretStore(
    PREVIEW_PROVIDERS.map((config) => [config.secretRef, PREVIEW_PROVIDER_CREDENTIAL] as const),
  )
  const library = createPreviewLibrary()
  const conversation = createPreviewConversationService(readReplay())
  return {
    settings,
    secrets,
    conversation: conversation.service,
    info: library.info,
    resume: library.resume,
    libraryChanges: library.libraryChanges,
    providers: createPreviewProviders({ settings, secrets }),
    seed: createSeedDataService({
      settings,
      info: library.info,
      resume: library.resume,
      conversation: conversation.service,
      messages: conversation.repositories.messages,
      clock: new FakeClock(),
    }),
  }
}

export interface PreviewRootOptions {
  /**
   * Keep the memory state across roots. The preview window sets this so a
   * settings rebuild behaves like the native window, whose database survives the
   * rebuild; a fresh call (a screenshot harness, a test) gets its own state.
   */
  readonly preserveState?: boolean
}

export function createPreviewRoot(options: PreviewRootOptions = {}): CompositionRoot {
  if (options.preserveState === true) windowState ??= createPreviewState()
  const state = windowState ?? createPreviewState()
  return {
    appInfo: describeAppInfo({ runtime: 'browser', databaseFile: null }),
    settings: createAppSettingsService({ repository: state.settings }),
    // Memory data has no file to export and nothing to clear on disk. The
    // settings surface reads this flag and states the limitation instead of
    // showing an export button that cannot produce a backup.
    backup: createBackupService({
      canManageData: false,
      secrets: state.secrets,
      backup: {
        dumpTables: async () => ({}),
        replaceAll: async () => undefined,
        clearAll: async () => undefined,
        listOrphanAttachments: async () => [],
        deleteAttachments: async () => undefined,
        listAttachmentStorageNames: async () => [],
        listProviderSecretRefs: async () => [],
      },
      files: {
        write: async () => undefined,
        read: async () => new Uint8Array(),
        delete: async () => undefined,
        list: async () => [],
      },
      clock: new FakeClock(),
    }),
    seed: state.seed,
    info: state.info,
    resume: state.resume,
    conversation: state.conversation,
    providers: state.providers,
    libraryChanges: state.libraryChanges,
    secrets: state.secrets,
    shutdown: async (): Promise<void> => undefined,
  }
}
