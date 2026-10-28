/**
 * @file capabilities
 * @description The surface the composition root exposes to the interface. The
 * interface receives ready-to-call services and never sees a repository, a SQL
 * string or a provider.
 *
 * Responsibilities:
 * - Declare the service facades the root hands out, as interfaces
 * - Keep the root's contract separate from the assembly that implements it
 *
 * Constraints:
 * - Types declared here may name domain ports but must not name an
 *   infrastructure implementation: the interface is compiled into the window
 *   without the native layer behind it.
 * - A capability is added here when the interface can call it, not before.
 */

import type {
  CreateCustomModuleInput,
  CreateCustomModuleOutput,
} from '../application/info/createCustomModule'
import type {
  CreateInfoEntryInput,
  CreateInfoEntryOutput,
} from '../application/info/createInfoEntry'
import type {
  DeleteCustomModuleInput,
  DeleteCustomModuleOutput,
} from '../application/info/deleteCustomModule'
import type {
  DeleteInfoEntryInput,
  DeleteInfoEntryOutput,
} from '../application/info/deleteInfoEntry'
import type {
  ListInfoEntriesInput,
  ListInfoEntriesOutput,
} from '../application/info/listInfoEntries'
import type {
  ReorderCustomModulesInput,
  ReorderCustomModulesOutput,
} from '../application/info/reorderCustomModules'
import type {
  ReorderInfoEntriesInput,
  ReorderInfoEntriesOutput,
} from '../application/info/reorderInfoEntries'
import type {
  SearchInfoEntriesInput,
  SearchInfoEntriesOutput,
} from '../application/info/searchInfoEntries'
import type {
  UpdateCustomModuleInput,
  UpdateCustomModuleOutput,
} from '../application/info/updateCustomModule'
import type {
  UpdateInfoEntryInput,
  UpdateInfoEntryOutput,
} from '../application/info/updateInfoEntry'
import type {
  AddCanvasBlockInput,
  AddCanvasBlockOutput,
} from '../application/resume/addCanvasBlock'
import type {
  CheckLayoutOverflowInput,
  CheckLayoutOverflowOutput,
} from '../application/resume/checkLayoutOverflow'
import type {
  CreateResumeInput,
  CreateResumeOutput,
} from '../application/resume/createResume'
import type {
  DeleteOverrideInput,
  DeleteOverrideOutput,
} from '../application/resume/deleteOverride'
import type {
  DuplicateResumeInput,
  DuplicateResumeOutput,
} from '../application/resume/duplicateResume'
import type { FindMissingReferencesInput } from '../application/resume/findMissingReferences'
import type { FreezeResumeOutput } from '../application/resume/freezeResume'
import type {
  MoveCanvasBlockInput,
  MoveCanvasBlockOutput,
} from '../application/resume/moveCanvasBlock'
import type {
  ReadMaterializedDocumentInput,
  ReadMaterializedDocumentOutput,
} from '../application/resume/readMaterializedDocument'
import type {
  RemoveCanvasBlockInput,
  RemoveCanvasBlockOutput,
} from '../application/resume/removeCanvasBlock'
import type {
  RemoveSectionInput,
  RemoveSectionOutput,
} from '../application/resume/removeSection'
import type { RenameResumeInput } from '../application/resume/renameResume'
import type {
  ResizeCanvasBlockInput,
  ResizeCanvasBlockOutput,
} from '../application/resume/resizeCanvasBlock'
import type {
  SaveOverrideToLibraryInput,
  SaveOverrideToLibraryOutput,
} from '../application/resume/saveOverrideToLibrary'
import type {
  SetAppearanceInput,
  SetAppearanceOutput,
} from '../application/resume/setAppearance'
import type {
  SetPageSetupInput,
  SetPageSetupOutput,
} from '../application/resume/setPageSetup'
import type {
  SetSectionDisplayInput,
  SetSectionDisplayOutput,
} from '../application/resume/setSectionDisplay'
import type {
  SetSectionOrderInput,
  SetSectionOrderOutput,
} from '../application/resume/setSectionOrder'
import type {
  SetSectionSelectionInput,
  SetSectionSelectionOutput,
} from '../application/resume/setSectionSelection'
import type { SetTemplateInput, SetTemplateOutput } from '../application/resume/setTemplate'
import type { UpdateResumeTargetInput } from '../application/resume/updateResumeTarget'
import type {
  WriteEntryOverrideInput,
  WriteEntryOverrideOutput,
} from '../application/resume/writeEntryOverride'
import type {
  WriteSummaryOverrideInput,
  WriteSummaryOverrideOutput,
} from '../application/resume/writeSummaryOverride'
import type { AppSettings } from '../domain/settings/AppSettings'
import type { SecretStore } from '../domain/generation/ports/SecretStore'
import type { MissingReference } from '../domain/resume/MissingReference'
import type { Resume } from '../domain/resume/Resume'
import type { Revision } from '../domain/resume/Revision'
import type { TemplateDefinition } from '../domain/resume/Template'
import type { ResumeId } from '../domain/shared/branded-id'
import type { ConversationService } from './wiring/conversation'

/** Build information shown in the about section. Every field is a fact about the running build. */
export interface AppInfo {
  readonly version: string
  /** 'development', 'production' or 'test'. */
  readonly buildMode: string
  /** Which container runs the window. */
  readonly runtime: 'tauri' | 'browser'
  readonly license: string
  /** Absolute path of the database the window reads, or null when none is opened. */
  readonly databaseFile: string | null
}

export interface AppSettingsService {
  readonly read: () => Promise<AppSettings>
  readonly save: (patch: Partial<AppSettings>) => Promise<AppSettings>
}

/**
 * The information library as the interface sees it: the library use cases,
 * already bound to their repositories, clock and identifier source. The facade
 * hands out domain values and throws `DomainError` for a refusal; it hides which
 * storage answers.
 */
export interface InfoService {
  readonly listEntries: (input?: ListInfoEntriesInput) => Promise<ListInfoEntriesOutput>
  readonly searchEntries: (input: SearchInfoEntriesInput) => Promise<SearchInfoEntriesOutput>
  readonly createEntry: (input: CreateInfoEntryInput) => Promise<CreateInfoEntryOutput>
  readonly updateEntry: (input: UpdateInfoEntryInput) => Promise<UpdateInfoEntryOutput>
  readonly deleteEntry: (input: DeleteInfoEntryInput) => Promise<DeleteInfoEntryOutput>
  readonly reorderEntries: (input: ReorderInfoEntriesInput) => Promise<ReorderInfoEntriesOutput>
  readonly createCustomModule: (
    input: CreateCustomModuleInput,
  ) => Promise<CreateCustomModuleOutput>
  readonly updateCustomModule: (
    input: UpdateCustomModuleInput,
  ) => Promise<UpdateCustomModuleOutput>
  readonly deleteCustomModule: (
    input: DeleteCustomModuleInput,
  ) => Promise<DeleteCustomModuleOutput>
  readonly reorderCustomModules: (
    input: ReorderCustomModulesInput,
  ) => Promise<ReorderCustomModulesOutput>
}

/**
 * The resume document as the interface sees it: every document use case, already
 * bound to the store, the library, the measurer, the clock and the identifier
 * source. The facade hands out domain values and throws `DomainError` for a
 * refusal; it hides which storage answers.
 */
export interface ResumeService {
  readonly listResumes: () => Promise<readonly Resume[]>
  readonly listTemplates: () => readonly TemplateDefinition[]
  readonly createResume: (input: CreateResumeInput) => Promise<CreateResumeOutput>
  readonly duplicateResume: (input: DuplicateResumeInput) => Promise<DuplicateResumeOutput>
  readonly renameResume: (input: RenameResumeInput) => Promise<void>
  readonly deleteResume: (resumeId: ResumeId) => Promise<void>
  readonly updateResumeTarget: (input: UpdateResumeTargetInput) => Promise<void>
  readonly undo: (resumeId: ResumeId) => Promise<Revision>
  readonly redo: (resumeId: ResumeId) => Promise<Revision>
  readonly setSectionSelection: (
    input: SetSectionSelectionInput,
  ) => Promise<SetSectionSelectionOutput>
  readonly setSectionOrder: (input: SetSectionOrderInput) => Promise<SetSectionOrderOutput>
  readonly setSectionDisplay: (
    input: SetSectionDisplayInput,
  ) => Promise<SetSectionDisplayOutput>
  readonly removeSection: (input: RemoveSectionInput) => Promise<RemoveSectionOutput>
  readonly writeSummaryOverride: (
    input: WriteSummaryOverrideInput,
  ) => Promise<WriteSummaryOverrideOutput>
  readonly writeEntryOverride: (
    input: WriteEntryOverrideInput,
  ) => Promise<WriteEntryOverrideOutput>
  readonly deleteOverride: (input: DeleteOverrideInput) => Promise<DeleteOverrideOutput>
  readonly saveOverrideToLibrary: (
    input: SaveOverrideToLibraryInput,
  ) => Promise<SaveOverrideToLibraryOutput>
  readonly setTemplate: (input: SetTemplateInput) => Promise<SetTemplateOutput>
  readonly setAppearance: (input: SetAppearanceInput) => Promise<SetAppearanceOutput>
  readonly setPageSetup: (input: SetPageSetupInput) => Promise<SetPageSetupOutput>
  readonly addCanvasBlock: (input: AddCanvasBlockInput) => Promise<AddCanvasBlockOutput>
  readonly moveCanvasBlock: (input: MoveCanvasBlockInput) => Promise<MoveCanvasBlockOutput>
  readonly resizeCanvasBlock: (
    input: ResizeCanvasBlockInput,
  ) => Promise<ResizeCanvasBlockOutput>
  readonly removeCanvasBlock: (
    input: RemoveCanvasBlockInput,
  ) => Promise<RemoveCanvasBlockOutput>
  readonly materializeDocument: (
    input: ReadMaterializedDocumentInput,
  ) => Promise<ReadMaterializedDocumentOutput>
  readonly findMissingReferences: (
    input: FindMissingReferencesInput,
  ) => Promise<readonly MissingReference[]>
  readonly checkLayoutOverflow: (
    input: CheckLayoutOverflowInput,
  ) => Promise<CheckLayoutOverflowOutput>
  readonly freezeResume: (resumeId: ResumeId) => Promise<FreezeResumeOutput>
}

export interface CompositionRoot {
  readonly appInfo: AppInfo
  readonly settings: AppSettingsService
  /** Conversations, messages, attachments and the agent run of one turn. */
  readonly conversation: ConversationService
  readonly info: InfoService
  readonly resume: ResumeService
  /**
   * The encrypted credential store. The interface reaches it through the
   * provider settings once those exist; the root owns the handle so the window
   * never names the native store itself.
   */
  readonly secrets: SecretStore
  /** Releases this root's claim on the shared database. */
  readonly shutdown: () => Promise<void>
}
