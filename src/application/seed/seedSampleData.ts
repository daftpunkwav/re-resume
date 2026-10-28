/**
 * @file seedSampleData
 * @description Fills an empty library with the sample candidate so a first-time
 * reader can try the whole flow: information entries, a custom module, two
 * resumes (one draft, one finalized) and one conversation.
 *
 * Responsibilities:
 * - Refuse to run twice: `sampleDataSeeded` is written only after everything
 *   below it succeeded
 * - Write every library and resume value through the ordinary use cases, with
 *   `origin: 'user'`; nothing pretends to be an assistant write
 * - Rebuild the selection of both resumes from the entries it just created
 *
 * Constraints:
 * - The last flag write is the commit point. A failure before it leaves the
 *   sample partially imported, which the settings section reports; running the
 *   action again continues from the settings row rather than pretending the
 *   sample is complete.
 * - The seeded assistant message is completed through the message port: the
 *   seed has no run, and a message left `streaming` would render as a
 *   permanently running turn.
 */

import type { CustomModuleDefinition } from '../../domain/info/CustomModule'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type { Conversation } from '../../domain/conversation/Conversation'
import type { Message } from '../../domain/conversation/Message'
import type { MessageRepository } from '../../domain/conversation/ports/MessageRepository'
import type { AppSettingsRepository } from '../../domain/settings/ports/AppSettingsRepository'
import type { Clock } from '../../domain/shared/Clock'
import type { ConversationId, ResumeId } from '../../domain/shared/branded-id'
import type {
  CreateInfoEntryInput,
  CreateInfoEntryOutput,
} from '../info/createInfoEntry'
import type {
  CreateCustomModuleInput,
  CreateCustomModuleOutput,
} from '../info/createCustomModule'
import type { ListInfoEntriesInput, ListInfoEntriesOutput } from '../info/listInfoEntries'
import type { CreateResumeInput, CreateResumeOutput } from '../resume/createResume'
import type { FreezeResumeOutput } from '../resume/freezeResume'
import type {
  SetSectionSelectionInput,
  SetSectionSelectionOutput,
} from '../resume/setSectionSelection'
import type { CreateConversationInput } from '../conversation/createConversation'
import type { AppendMessageInput } from '../conversation/appendMessage'
import type { SectionSelection } from '../resume/sectionSelection'
import { saveAppSettings } from '../settings/saveAppSettings'
import {
  SAMPLE_CONVERSATION_MESSAGES,
  SAMPLE_CONVERSATION_TITLE,
  SAMPLE_CUSTOM_ENTRIES,
  SAMPLE_CUSTOM_MODULE,
  SAMPLE_DRAFT_RESUME,
  SAMPLE_ENTRIES,
  SAMPLE_FROZEN_RESUME,
} from './sampleContent'
import type { SampleResumePlan } from './sampleContent'

/** The information-library facade the seed needs; the capability satisfies it. */
export interface SeedInfoService {
  listEntries(input?: ListInfoEntriesInput): Promise<ListInfoEntriesOutput>
  createEntry(input: CreateInfoEntryInput): Promise<CreateInfoEntryOutput>
  createCustomModule(input: CreateCustomModuleInput): Promise<CreateCustomModuleOutput>
}

/** The resume facade the seed needs. */
export interface SeedResumeService {
  createResume(input: CreateResumeInput): Promise<CreateResumeOutput>
  setSectionSelection(input: SetSectionSelectionInput): Promise<SetSectionSelectionOutput>
  freezeResume(resumeId: ResumeId): Promise<FreezeResumeOutput>
}

/** The conversation facade the seed needs. */
export interface SeedConversationService {
  createConversation(input?: CreateConversationInput): Promise<Conversation>
  appendMessage(input: AppendMessageInput): Promise<Message>
}

export interface SeedSampleDataDeps {
  readonly settings: AppSettingsRepository
  readonly info: SeedInfoService
  readonly resume: SeedResumeService
  readonly conversation: SeedConversationService
  /** The message port, used only to complete the seeded assistant message. */
  readonly messages: MessageRepository
  readonly clock: Clock
}

export interface SeedSampleDataOutput {
  readonly alreadySeeded: boolean
  readonly infoEntries: number
  readonly resumes: number
  readonly messages: number
  readonly conversationId: ConversationId | null
}

interface SeededLibrary {
  readonly entries: readonly InfoEntry[]
  readonly customModule: CustomModuleDefinition
}

export async function seedSampleData(
  deps: SeedSampleDataDeps,
): Promise<SeedSampleDataOutput> {
  const current = await deps.settings.read()
  if (current?.sampleDataSeeded === true) {
    return { alreadySeeded: true, infoEntries: 0, resumes: 0, messages: 0, conversationId: null }
  }

  const library = await seedLibrary(deps)
  await seedResume(deps, SAMPLE_DRAFT_RESUME, library)
  const frozen = await seedResume(deps, SAMPLE_FROZEN_RESUME, library)
  await deps.resume.freezeResume(frozen.resumeId)

  const conversation = await seedConversation(deps)

  await saveAppSettings({ settings: deps.settings }, { sampleDataSeeded: true })
  return {
    alreadySeeded: false,
    infoEntries: library.entries.length,
    resumes: 2,
    messages: SAMPLE_CONVERSATION_MESSAGES.length,
    conversationId: conversation.id,
  }
}

async function seedLibrary(deps: SeedSampleDataDeps): Promise<SeededLibrary> {
  const customModule = (
    await deps.info.createCustomModule({
      name: SAMPLE_CUSTOM_MODULE.name,
      fields: SAMPLE_CUSTOM_MODULE.fields.map((field) => ({ ...field })),
      origin: 'user',
    })
  ).module
  const entries: InfoEntry[] = []
  for (const sample of SAMPLE_ENTRIES) {
    const created = await deps.info.createEntry({
      moduleKind: sample.moduleKind,
      fields: sample.fields,
      origin: 'user',
    })
    entries.push(created.entry)
  }
  const fieldKeys = new Map(
    customModule.fields.map((field) => [field.label, field.key] as const),
  )
  for (const sample of SAMPLE_CUSTOM_ENTRIES) {
    const fields: Record<string, string> = { title: sample.title }
    for (const [label, value] of Object.entries(sample.values)) {
      const key = fieldKeys.get(label)
      if (key === undefined) {
        throw new Error(`The sample custom entry names an undeclared field: ${label}.`)
      }
      fields[key] = value
    }
    const created = await deps.info.createEntry({
      moduleKind: 'custom',
      customModuleId: customModule.id,
      fields,
      origin: 'user',
    })
    entries.push(created.entry)
  }
  return { entries, customModule }
}

async function seedResume(
  deps: SeedSampleDataDeps,
  plan: SampleResumePlan,
  library: SeededLibrary,
): Promise<CreateResumeOutput> {
  // createResume applies the initial selection and writes the opening revision;
  // nothing else is needed before a resume is frozen.
  return deps.resume.createResume({
    title: plan.title,
    targetJob: { ...plan.targetJob, jobPostingId: null },
    initialSelection: buildSelection(plan, library),
    origin: 'user',
  })
}

function buildSelection(
  plan: SampleResumePlan,
  library: SeededLibrary,
): readonly SectionSelection[] {
  const byModule = new Map<InfoModuleKind, InfoEntry[]>()
  for (const entry of library.entries) {
    const list = byModule.get(entry.moduleKind) ?? []
    list.push(entry)
    byModule.set(entry.moduleKind, list)
  }
  const selections: SectionSelection[] = []
  for (const [moduleKind, count] of Object.entries(plan.selection)) {
    const entries = (byModule.get(moduleKind as InfoModuleKind) ?? []).slice(0, count)
    if (entries.length === 0) continue
    selections.push({
      moduleKind: moduleKind as InfoModuleKind,
      customModuleId: null,
      entryIds: entries.map((entry) => entry.id),
    })
  }
  const custom = (byModule.get('custom') ?? []).slice(0, plan.customCount)
  if (custom.length > 0) {
    selections.push({
      moduleKind: 'custom',
      customModuleId: library.customModule.id,
      entryIds: custom.map((entry) => entry.id),
    })
  }
  return selections
}

async function seedConversation(deps: SeedSampleDataDeps): Promise<Conversation> {
  const conversation = await deps.conversation.createConversation({
    title: SAMPLE_CONVERSATION_TITLE,
  })
  for (const sample of SAMPLE_CONVERSATION_MESSAGES) {
    const message = await deps.conversation.appendMessage({
      conversationId: conversation.id,
      kind: sample.role,
      markdown: sample.markdown,
    })
    if (sample.role === 'assistant') {
      // The seed has no run, so the assistant message never completes by
      // streaming; the transcript has to say it is finished.
      await deps.messages.update({
        ...message,
        status: 'complete',
        updatedAt: deps.clock.now(),
      })
    }
  }
  return conversation
}
