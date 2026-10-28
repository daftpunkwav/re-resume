/**
 * @file infoStore
 * @description The information panel's single store: the library read once for
 * the panel, the current module and entry, the search query and the two-second
 * agent-write highlight. Writes go through the `InfoService` facade and the
 * store re-reads the library afterwards, so ordering and counts stay whatever
 * the use cases decided rather than a second local copy of the rules.
 *
 * Responsibilities:
 * - Load the library, keeping the previous value on screen while a reload runs
 * - Validate the selection after every read (a deleted module or entry must not
 *   stay selected)
 * - Run the library writes and hand the caller their result or refusal
 * - Highlight entries the agent just wrote, clearing them after two seconds
 *
 * Constraints:
 * - The store never builds a service: the panel connects it to the composition
 *   root's facade once.
 * - A reload that fails after a successful write reports the read failure but
 *   does not pretend the write failed; the write's output already returned.
 */

import { create } from 'zustand'
import type {
  CreateCustomModuleInput,
  CreateCustomModuleOutput,
} from '../../../../application/info/createCustomModule'
import type {
  CreateInfoEntryInput,
  CreateInfoEntryOutput,
} from '../../../../application/info/createInfoEntry'
import type { DeleteCustomModuleOutput } from '../../../../application/info/deleteCustomModule'
import type { DeleteInfoEntryOutput } from '../../../../application/info/deleteInfoEntry'
import type { InfoModuleSummary } from '../../../../application/info/listInfoEntries'
import type { ReorderInfoEntriesOutput } from '../../../../application/info/reorderInfoEntries'
import type {
  UpdateCustomModuleInput,
  UpdateCustomModuleOutput,
} from '../../../../application/info/updateCustomModule'
import type { UpdateInfoEntryOutput } from '../../../../application/info/updateInfoEntry'
import type { InfoService } from '../../../../bootstrap/capabilities'
import type { CustomModuleDefinition } from '../../../../domain/info/CustomModule'
import type { InfoEntry } from '../../../../domain/info/InfoEntry'
import type { InfoModuleKind } from '../../../../domain/info/InfoModuleKind'
import type { CustomModuleId, InfoEntryId } from '../../../../domain/shared/branded-id'
import { describeError } from '../../../app/errorMessages'
import type { ReadableError } from '../../../app/errorMessages'

/** How long an agent-written entry keeps its highlight. */
export const AGENT_TOUCH_MS = 2000

/** The agent-write marker an entry row shows while the highlight lasts. */
export type AgentTouchKind = 'created' | 'updated'

export interface ModuleSelection {
  readonly moduleKind: InfoModuleKind
  readonly customModuleId: CustomModuleId | null
}

interface InfoState {
  readonly entries: readonly InfoEntry[]
  readonly customModules: readonly CustomModuleDefinition[]
  readonly summaries: readonly InfoModuleSummary[]
  /** Null until the first read names a module. */
  readonly selectedModule: ModuleSelection | null
  readonly selectedEntryId: InfoEntryId | null
  readonly query: string
  readonly loading: boolean
  readonly busy: boolean
  readonly error: ReadableError | null
  /** Entry id → what the agent did to it; present for `AGENT_TOUCH_MS`. */
  readonly agentTouched: Readonly<Record<string, AgentTouchKind>>
  connect(service: InfoService): void
  refresh(): Promise<void>
  selectModule(selection: ModuleSelection): void
  selectEntry(entryId: InfoEntryId | null): void
  setQuery(query: string): void
  clearError(): void
  markAgentTouched(ids: readonly InfoEntryId[], kind?: AgentTouchKind): void
  clearAgentTouches(): void
  createEntry(input: Omit<CreateInfoEntryInput, 'origin'>): Promise<CreateInfoEntryOutput>
  updateEntry(input: {
    readonly entryId: InfoEntryId
    readonly fields: Readonly<Record<string, unknown>>
  }): Promise<UpdateInfoEntryOutput>
  deleteEntry(
    entryId: InfoEntryId,
    confirmReferenced: boolean,
  ): Promise<DeleteInfoEntryOutput>
  reorderEntries(input: {
    readonly moduleKind: InfoModuleKind
    readonly customModuleId: CustomModuleId | null
    readonly orderedEntryIds: readonly InfoEntryId[]
  }): Promise<ReorderInfoEntriesOutput>
  createCustomModule(
    input: Omit<CreateCustomModuleInput, 'origin'>,
  ): Promise<CreateCustomModuleOutput>
  updateCustomModule(
    input: Pick<
      UpdateCustomModuleInput,
      'moduleId' | 'name' | 'fields' | 'confirmValuesLoss'
    >,
  ): Promise<UpdateCustomModuleOutput>
  deleteCustomModule(
    moduleId: CustomModuleId,
    confirmEntries: boolean,
  ): Promise<DeleteCustomModuleOutput>
}

interface EmptyState {
  readonly entries: readonly InfoEntry[]
  readonly customModules: readonly CustomModuleDefinition[]
  readonly summaries: readonly InfoModuleSummary[]
  readonly selectedModule: ModuleSelection | null
  readonly selectedEntryId: InfoEntryId | null
  readonly query: string
  readonly loading: boolean
  readonly busy: boolean
  readonly error: ReadableError | null
  readonly agentTouched: Readonly<Record<string, AgentTouchKind>>
}

const EMPTY_STATE: EmptyState = {
  entries: [],
  customModules: [],
  summaries: [],
  selectedModule: null,
  selectedEntryId: null,
  query: '',
  loading: true,
  busy: false,
  error: null,
  agentTouched: {},
}

let service: InfoService | null = null
let readGeneration = 0
let pendingWrites = 0
const agentTouchTimers = new Map<string, ReturnType<typeof setTimeout>>()

function requireService(): InfoService {
  if (service === null) {
    throw new Error('The information panel was used before its service was connected.')
  }
  return service
}

function selectionExists(
  selection: ModuleSelection | null,
  customModules: readonly CustomModuleDefinition[],
): selection is ModuleSelection {
  if (selection === null) return false
  if (selection.moduleKind !== 'custom') return true
  return (
    selection.customModuleId !== null &&
    customModules.some((module) => module.id === selection.customModuleId)
  )
}

function defaultSelection(): ModuleSelection {
  return { moduleKind: 'personal', customModuleId: null }
}

function entryIsInSelection(
  entry: InfoEntry | undefined,
  selection: ModuleSelection,
): boolean {
  if (entry === undefined) return false
  if (entry.moduleKind !== selection.moduleKind) return false
  return selection.moduleKind !== 'custom' || entry.customModuleId === selection.customModuleId
}

/**
 * Applies a read result and repairs the selection. A deleted custom module
 * falls back to the first module; a deleted entry becomes no selection, which
 * the panel turns into the module's empty state.
 */
function adoptLibrary(
  state: InfoState,
  entries: readonly InfoEntry[],
  summaries: readonly InfoModuleSummary[],
  customModules: readonly CustomModuleDefinition[],
): Partial<InfoState> {
  const selectedModule = selectionExists(state.selectedModule, customModules)
    ? state.selectedModule
    : defaultSelection()
  const selectedEntry = entries.find((entry) => entry.id === state.selectedEntryId)
  return {
    entries,
    summaries,
    customModules,
    selectedModule,
    selectedEntryId: entryIsInSelection(selectedEntry, selectedModule)
      ? state.selectedEntryId
      : null,
    loading: false,
    error: null,
  }
}

async function readLibrary(options: { readonly showLoading: boolean }): Promise<void> {
  const current = requireService()
  const request = readGeneration + 1
  readGeneration = request
  if (options.showLoading) {
    useInfoStore.setState({ loading: true, error: null })
  }
  try {
    const result = await current.listEntries()
    if (readGeneration !== request) return
    useInfoStore.setState((state) =>
      adoptLibrary(state, result.entries, result.summaries, result.customModules),
    )
  } catch (thrown) {
    if (readGeneration !== request) return
    useInfoStore.setState({ loading: false, error: describeError(thrown) })
  }
}

function beginWrite(): void {
  pendingWrites += 1
  if (pendingWrites === 1) useInfoStore.setState({ busy: true })
}

function endWrite(): void {
  pendingWrites -= 1
  if (pendingWrites === 0) useInfoStore.setState({ busy: false })
}

/** Keeps the busy flag balanced even when the use case refuses the write. */
async function runWrite<T>(write: (current: InfoService) => Promise<T>): Promise<T> {
  const current = requireService()
  beginWrite()
  try {
    return await write(current)
  } finally {
    endWrite()
  }
}

function clearTouchTimer(id: string): void {
  const timer = agentTouchTimers.get(id)
  if (timer === undefined) return
  clearTimeout(timer)
  agentTouchTimers.delete(id)
}

export const useInfoStore = create<InfoState>((set) => ({
  ...EMPTY_STATE,

  connect(nextService) {
    service = nextService
  },

  async refresh() {
    await readLibrary({ showLoading: true })
  },

  selectModule(selection) {
    // The query belongs to the module it was typed in; keeping it would show a
    // search term that matched nothing in the module now open.
    set({ selectedModule: selection, selectedEntryId: null, query: '' })
  },

  selectEntry(entryId) {
    set({ selectedEntryId: entryId })
  },

  setQuery(query) {
    set({ query })
  },

  clearError() {
    set({ error: null })
  },

  markAgentTouched(ids, kind = 'updated') {
    if (ids.length === 0) return
    const additions: Record<string, AgentTouchKind> = {}
    for (const id of ids) {
      clearTouchTimer(id)
      additions[id] = kind
      agentTouchTimers.set(
        id,
        setTimeout(() => {
          agentTouchTimers.delete(id)
          useInfoStore.setState((state) => {
            if (state.agentTouched[id] === undefined) return state
            const next = { ...state.agentTouched }
            delete next[id]
            return { agentTouched: next }
          })
        }, AGENT_TOUCH_MS),
      )
    }
    set((state) => ({ agentTouched: { ...state.agentTouched, ...additions } }))
  },

  clearAgentTouches() {
    for (const id of [...agentTouchTimers.keys()]) clearTouchTimer(id)
    set({ agentTouched: {} })
  },

  createEntry(input) {
    return runWrite(async (current) => {
      const output = await current.createEntry({ ...input, origin: 'user' })
      await readLibrary({ showLoading: false })
      return output
    })
  },

  updateEntry(input) {
    return runWrite(async (current) => {
      const output = await current.updateEntry({ ...input, origin: 'user' })
      await readLibrary({ showLoading: false })
      return output
    })
  },

  deleteEntry(entryId, confirmReferenced) {
    return runWrite(async (current) => {
      const output = await current.deleteEntry({
        entryId,
        confirmReferenced,
        origin: 'user',
      })
      await readLibrary({ showLoading: false })
      return output
    })
  },

  reorderEntries(input) {
    return runWrite(async (current) => {
      const output = await current.reorderEntries({
        moduleKind: input.moduleKind,
        customModuleId: input.customModuleId,
        orderedEntryIds: input.orderedEntryIds,
        origin: 'user',
      })
      await readLibrary({ showLoading: false })
      return output
    })
  },

  createCustomModule(input) {
    return runWrite(async (current) => {
      const output = await current.createCustomModule({ ...input, origin: 'user' })
      await readLibrary({ showLoading: false })
      return output
    })
  },

  updateCustomModule(input) {
    return runWrite(async (current) => {
      const output = await current.updateCustomModule({ ...input, origin: 'user' })
      await readLibrary({ showLoading: false })
      return output
    })
  },

  deleteCustomModule(moduleId, confirmEntries) {
    return runWrite(async (current) => {
      const output = await current.deleteCustomModule({
        moduleId,
        confirmEntries,
        origin: 'user',
      })
      await readLibrary({ showLoading: false })
      return output
    })
  },
}))

/** Test hook: forgets the connected service, the selection and every pending highlight. */
export function resetInfoStore(): void {
  service = null
  readGeneration += 1
  pendingWrites = 0
  for (const id of [...agentTouchTimers.keys()]) clearTouchTimer(id)
  useInfoStore.setState({ ...EMPTY_STATE })
}
