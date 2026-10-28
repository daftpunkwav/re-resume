/**
 * @file conversationStore
 * @description The conversation list, the open transcript and the composer of
 * the assistant. One store owns the stored side of the conversation; the live
 * stream buffer lives in `runStore`.
 *
 * Responsibilities:
 * - Load the sidebar list, restore the last session and open a session's
 *   transcript with its context chips
 * - Drive one turn: create the session, send, cancel, retry, and re-read the
 *   stored transcript after the run settles
 * - Reduce the AgentEvent stream into store updates
 * - Apply the list operations (rename, pin, delete) and the per-write undo
 *
 * Constraints:
 * - The persisted message list is the truth. Events update display state only;
 *   `done` and the turn promise both end with an authoritative reload.
 * - One conversation streams at most one run; `send` refuses while a run is in
 *   flight, and the database gate in the run loop is the second line.
 * - The store never touches a repository or a provider: it calls the capability
 *   facade handed in by `connect`.
 */

import { create } from 'zustand'
import type {
  AppSettingsService,
  InfoService,
  LibraryChangesService,
} from '../../../../bootstrap/capabilities'
import type { ConversationService } from '../../../../bootstrap/wiring/conversation'
import type { Conversation } from '../../../../domain/conversation/Conversation'
import type {
  ConversationGroups,
  ListConversationsOutput,
} from '../../../../application/conversation/listConversations'
import type { Message } from '../../../../domain/conversation/Message'
import type { MessageContext } from '../../../../domain/conversation/MessageContext'
import type { AgentEvent } from '../../../../domain/generation/AgentEvent'
import type {
  ChangeRecordId,
  ResumeId,
  RevisionId,
} from '../../../../domain/shared/branded-id'
import { moduleDescriptor } from '../../../../domain/info/InfoModuleKind'
import type { CustomModuleDefinition } from '../../../../domain/info/CustomModule'
import { describeError } from '../../../app/errorMessages'
import type { ReadableError } from '../../../app/errorMessages'
import { showToast } from '../../../app/stores/toastStore'
import { useSettingsStore } from '../../../app/stores/settingsStore'
import { useRunStore } from './runStore'

/** How many stored messages one session opens; the newest N, oldest first. */
export const MESSAGE_WINDOW = 2000

/** A chip the composer can send: the stored reference plus the label it shows. */
export interface ComposerContext {
  readonly context: MessageContext
  readonly label: string
}

export interface ConversationServices {
  readonly conversation: ConversationService
  readonly info: InfoService
  readonly settings: AppSettingsService
  readonly libraryChanges: LibraryChangesService
}

export type ListStatus = 'idle' | 'loading' | 'ready' | 'failed'
export type MessagesStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface ConversationState {
  readonly conversations: readonly Conversation[]
  readonly groups: ConversationGroups | null
  readonly activeId: Conversation['id'] | null
  /** True while the open region is a new session that has no row yet. */
  readonly draft: boolean
  readonly messages: readonly Message[]
  /** Ids the newest reload added; only these play the enter animation. */
  readonly enterIds: ReadonlySet<string>
  /** Stored chips per user message. */
  readonly contextsByMessage: Readonly<Record<string, readonly MessageContext[]>>
  /** Resolved chip labels per information entry. */
  readonly contextEntries: Readonly<Record<string, string>>
  readonly listStatus: ListStatus
  readonly messagesStatus: MessagesStatus
  readonly error: ReadableError | null
  /** The user turn shown while the run has not persisted it yet. */
  readonly pendingUser: {
    readonly text: string
    readonly contexts: readonly MessageContext[]
  } | null
  readonly composer: {
    readonly text: string
    readonly contexts: readonly ComposerContext[]
  }
  readonly undoBusy: ReadonlySet<string>
  readonly undone: ReadonlySet<string>
  connect(services: ConversationServices | null): void
  loadConversations(): Promise<void>
  /**
   * Starts an empty session. initial is the settle after the first list load:
   * it must not erase a draft or a failure the user already caused.
   */
  startDraft(mode?: 'reset' | 'initial'): void
  openConversation(conversationId: Conversation['id']): Promise<void>
  loadMessagesFor(conversationId: Conversation['id']): Promise<void>
  refreshContextEntries(): Promise<void>
  setComposerText(text: string): void
  addContext(context: MessageContext, label: string): void
  removeContext(context: MessageContext): void
  send(): Promise<void>
  sendMessage(text: string, contexts: readonly MessageContext[]): Promise<void>
  cancel(): Promise<void>
  retry(messageId: Message['id']): Promise<void>
  applyEvent(event: AgentEvent): void
  renameConversation(conversationId: Conversation['id'], title: string): Promise<boolean>
  togglePinned(conversationId: Conversation['id'], pinned: boolean): Promise<boolean>
  removeConversation(conversationId: Conversation['id']): Promise<boolean>
  undoChange(changeId: ChangeRecordId): Promise<boolean>
  undoRevision(resumeId: ResumeId, revisionId: RevisionId): Promise<boolean>
  clearError(): void
}

/** The service object of the root currently mounted; replaced on a rebuild. */
let services: ConversationServices | null = null

/** Makes only the newest transcript read write, whatever settles first. */
let messageGeneration = 0

/** Makes only the newest list read write. */
let listGeneration = 0

const EMPTY = {
  conversations: [],
  groups: null,
  activeId: null,
  draft: false,
  messages: [],
  enterIds: new Set<string>(),
  contextsByMessage: {},
  contextEntries: {},
  listStatus: 'idle',
  messagesStatus: 'idle',
  error: null,
  pendingUser: null,
  composer: { text: '', contexts: [] },
  undoBusy: new Set<string>(),
  undone: new Set<string>(),
} as const satisfies Partial<ConversationState>

/** The opens: only the newest request may write what the region shows. */
function contextLabelFor(context: MessageContext, entries: Readonly<Record<string, string>>): string {
  switch (context.kind) {
    case 'entry':
      return entries[context.refId] ?? '信息条目'
    case 'resume':
      return '简历'
    case 'jobPosting':
      return '岗位描述'
  }
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  ...EMPTY,

  connect(next) {
    if (services === next) return
    services = next
    useRunStore.getState().reset()
    messageGeneration += 1
    listGeneration += 1
    set({ ...EMPTY })
    if (next === null) return
    void get().loadConversations()
  },

  async loadConversations() {
    const current = services
    if (current === null) return
    const generation = listGeneration + 1
    listGeneration = generation
    set({ listStatus: 'loading' })
    let listed: ListConversationsOutput
    try {
      listed = await current.conversation.listConversations()
    } catch (failure) {
      if (generation !== listGeneration) return
      set({ listStatus: 'failed', error: describeError(failure) })
      return
    }
    if (generation !== listGeneration) return
    set({
      conversations: listed.conversations,
      groups: listed.groups,
      listStatus: 'ready',
    })
    const activeId = get().activeId
    if (activeId !== null) {
      // A session deleted elsewhere (or by this window) leaves the region empty
      // rather than showing a transcript that no longer has a row.
      if (!listed.conversations.some((conversation) => conversation.id === activeId)) {
        get().startDraft()
      }
      return
    }
    if (get().draft) return
    let lastConversationId: string | null = null
    try {
      const settings = await current.settings.read()
      lastConversationId = settings.lastConversationId
    } catch {
      // The preference is a convenience: a window that cannot read it still
      // opens the most recent session below.
    }
    if (generation !== listGeneration) return
    const preferred =
      listed.conversations.find((conversation) => conversation.id === lastConversationId) ??
      listed.conversations[0]
    if (preferred === undefined) {
      // The empty library is not a user action; a failure already shown for a
      // send must stay visible instead of being cleared by this settle.
      get().startDraft('initial')
      return
    }
    await get().openConversation(preferred.id)
  },

  startDraft(mode = 'reset') {
    messageGeneration += 1
    useRunStore.getState().reset()
    set({
      activeId: null,
      draft: true,
      messages: [],
      messagesStatus: 'idle',
      pendingUser: null,
      ...(mode === 'reset' ? { error: null } : {}),
      enterIds: new Set<string>(),
      composer: { text: '', contexts: [] },
    })
  },

  async openConversation(conversationId) {
    const current = services
    if (current === null) return
    messageGeneration += 1
    useRunStore.getState().reset()
    set({
      activeId: conversationId,
      draft: false,
      messages: [],
      messagesStatus: 'loading',
      pendingUser: null,
      error: null,
      enterIds: new Set<string>(),
    })
    // The preference is written through the settings store, which owns the
    // applied value and its cache; a direct save would be overwritten by the
    // next debounced settings write.
    useSettingsStore.getState().update({ lastConversationId: conversationId })
    await Promise.all([get().loadMessagesFor(conversationId), get().refreshContextEntries()])
  },

  async loadMessagesFor(conversationId) {
    const current = services
    if (current === null) return
    if (get().activeId !== conversationId) return
    const generation = messageGeneration + 1
    messageGeneration = generation
    const firstLoad = get().messages.length === 0
    try {
      const [messages, contexts] = await Promise.all([
        current.conversation.listMessages(conversationId, MESSAGE_WINDOW),
        current.conversation.listMessageContexts(conversationId, MESSAGE_WINDOW),
      ])
      if (generation !== messageGeneration || get().activeId !== conversationId) return
      const previousIds = new Set(get().messages.map((message) => message.id))
      const enterIds = firstLoad
        ? new Set<string>()
        : new Set(
            messages
              .filter((message) => !previousIds.has(message.id))
              .map((message) => message.id),
          )
      set({
        messages,
        messagesStatus: 'ready',
        enterIds,
        contextsByMessage: Object.fromEntries(contexts),
      })
    } catch (failure) {
      if (generation !== messageGeneration || get().activeId !== conversationId) return
      set({ messagesStatus: 'failed', error: describeError(failure) })
    }
  },

  async refreshContextEntries() {
    const current = services
    if (current === null) return
    try {
      const library = await current.info.listEntries({})
      const labels: Record<string, string> = {}
      for (const entry of library.entries) {
        const customModule: CustomModuleDefinition | undefined =
          entry.customModuleId === null
            ? undefined
            : library.customModules.find((module) => module.id === entry.customModuleId)
        labels[entry.id] = `${moduleDescriptor(entry.moduleKind, customModule ?? null).label}：${entry.title}`
      }
      set({ contextEntries: labels })
    } catch (failure) {
      // A chip without a resolved label still names its kind; the failure is
      // reported once through the conversation error rather than per chip.
      set({ error: describeError(failure) })
    }
  },

  setComposerText(text) {
    set((state) => ({ composer: { ...state.composer, text } }))
  },

  addContext(context, label) {
    set((state) => {
      const exists = state.composer.contexts.some(
        (chip) => chip.context.kind === context.kind && chip.context.refId === context.refId,
      )
      if (exists) return state
      return {
        composer: {
          ...state.composer,
          contexts: [...state.composer.contexts, { context, label }],
        },
      }
    })
  },

  removeContext(context) {
    set((state) => ({
      composer: {
        ...state.composer,
        contexts: state.composer.contexts.filter(
          (chip) => !(chip.context.kind === context.kind && chip.context.refId === context.refId),
        ),
      },
    }))
  },

  async send() {
    const state = get()
    if (state.composer.text.trim() === '') return
    const contexts = state.composer.contexts.map((chip) => chip.context)
    // The composer is cleared once the turn is known to be on its way; a failure
    // before that point leaves the draft where the user can send it again.
    await get().sendMessage(state.composer.text, contexts)
  },

  async sendMessage(text, contexts) {
    const current = services
    if (current === null) return
    if (useRunStore.getState().status !== 'idle') return
    const clean = text.trim()
    if (clean === '') return
    let conversationId = get().activeId
    set({ error: null })
    if (conversationId === null) {
      try {
        const created = await current.conversation.createConversation({})
        conversationId = created.id
        set({ activeId: created.id, draft: false })
        useSettingsStore.getState().update({ lastConversationId: created.id })
      } catch (failure) {
        // The draft is untouched: the text, its chips and its place in the
        // composer are exactly what the user handed over.
        set({ error: describeError(failure) })
        return
      }
    }
    set({
      composer: { text: '', contexts: [] },
      pendingUser: { text: clean, contexts },
    })
    useRunStore.getState().begin(conversationId)
    try {
      await current.conversation.runTurn(
        {
          conversationId,
          userMessage: {
            conversationId,
            kind: 'user',
            markdown: clean,
            contexts,
          },
          model: null,
          activeResumeId: null,
        },
        (event) => get().applyEvent(event),
      )
    } catch (failure) {
      set({ error: describeError(failure) })
      if (!useRunStore.getState().started) {
        // Nothing was persisted before the failure: the draft stays usable,
        // including the chips the user attached to it.
        set({
          composer: {
            text: clean,
            contexts: contexts.map((context) => ({
              context,
              label: contextLabelFor(context, get().contextEntries),
            })),
          },
          pendingUser: null,
        })
      }
    } finally {
      const started = useRunStore.getState().started
      useRunStore.getState().finish()
      await Promise.all([get().loadMessagesFor(conversationId), get().loadConversations()])
      if (started) set({ pendingUser: null })
    }
  },

  async cancel() {
    const current = services
    const conversationId = get().activeId
    if (current === null || conversationId === null) return
    if (useRunStore.getState().status !== 'running') return
    useRunStore.getState().markCancelling()
    try {
      await current.conversation.cancelRun({ conversationId })
    } catch (failure) {
      set({ error: describeError(failure) })
    }
  },

  async retry(messageId) {
    const current = services
    const conversationId = get().activeId
    if (current === null || conversationId === null) return
    if (useRunStore.getState().status !== 'idle') return
    set({ error: null, pendingUser: null })
    useRunStore.getState().begin(conversationId)
    try {
      await current.conversation.retryRun(
        { conversationId, messageId },
        (event) => get().applyEvent(event),
      )
    } catch (failure) {
      set({ error: describeError(failure) })
    } finally {
      useRunStore.getState().finish()
      await Promise.all([get().loadMessagesFor(conversationId), get().loadConversations()])
    }
  },

  applyEvent(event) {
    useRunStore.getState().applyEvent(event)
    switch (event.type) {
      case 'runStarted':
        set({ pendingUser: null })
        void get().loadMessagesFor(event.conversationId)
        return
      case 'toolStart':
      case 'toolEnd': {
        const conversationId = get().activeId
        if (conversationId !== null) void get().loadMessagesFor(conversationId)
        return
      }
      case 'error':
        set({ error: { message: event.message, blockers: [] } })
        return
      case 'done': {
        const conversationId = get().activeId
        if (conversationId !== null) void get().loadMessagesFor(conversationId)
        void get().loadConversations()
        return
      }
      case 'textDelta':
      case 'turnStarted':
      case 'changeRecorded':
      case 'usage':
        return
    }
  },

  async renameConversation(conversationId, title) {
    const current = services
    if (current === null) return false
    try {
      await current.conversation.renameConversation({ conversationId, title })
      await get().loadConversations()
      return true
    } catch (failure) {
      const readable = describeError(failure)
      set({ error: readable })
      showToast('danger', readable.message)
      return false
    }
  },

  async togglePinned(conversationId, pinned) {
    const current = services
    if (current === null) return false
    try {
      await current.conversation.togglePinned({ conversationId, pinned })
      await get().loadConversations()
      return true
    } catch (failure) {
      const readable = describeError(failure)
      set({ error: readable })
      showToast('danger', readable.message)
      return false
    }
  },

  async removeConversation(conversationId) {
    const current = services
    if (current === null) return false
    if (get().activeId === conversationId && useRunStore.getState().status !== 'idle') {
      // The run still writes to this conversation; deleting the row under it
      // would turn its next message write into a foreign-key failure.
      const blocked = { message: '请先停止生成，再删除这段对话。', blockers: [] }
      set({ error: blocked })
      showToast('danger', blocked.message)
      return false
    }
    try {
      const fallback =
        get().conversations.find((conversation) => conversation.id !== conversationId) ?? null
      await current.conversation.deleteConversation({ conversationId })
      set((state) => ({
        conversations: state.conversations.filter(
          (conversation) => conversation.id !== conversationId,
        ),
      }))
      if (get().activeId === conversationId) {
        if (fallback === null) get().startDraft()
        else await get().openConversation(fallback.id)
      } else {
        await get().loadConversations()
      }
      return true
    } catch (failure) {
      const readable = describeError(failure)
      set({ error: readable })
      showToast('danger', readable.message)
      return false
    }
  },

  async undoChange(changeId) {
    const current = services
    if (current === null) return false
    if (get().undoBusy.has(changeId) || get().undone.has(changeId)) return false
    set((state) => ({ undoBusy: new Set(state.undoBusy).add(changeId) }))
    try {
      await current.libraryChanges.undo({ changeId })
      set((state) => {
        const busy = new Set(state.undoBusy)
        busy.delete(changeId)
        return {
          undoBusy: busy,
          undone: new Set(state.undone).add(changeId),
        }
      })
      showToast('success', '已撤销这次修改')
      void get().refreshContextEntries()
      return true
    } catch (failure) {
      set((state) => {
        const busy = new Set(state.undoBusy)
        busy.delete(changeId)
        return { undoBusy: busy, error: describeError(failure) }
      })
      return false
    }
  },

  async undoRevision(resumeId, revisionId) {
    const current = services
    if (current === null) return false
    if (get().undoBusy.has(revisionId) || get().undone.has(revisionId)) return false
    set((state) => ({ undoBusy: new Set(state.undoBusy).add(revisionId) }))
    try {
      await current.libraryChanges.undoRevision({ resumeId, revisionId })
      set((state) => {
        const busy = new Set(state.undoBusy)
        busy.delete(revisionId)
        return {
          undoBusy: busy,
          undone: new Set(state.undone).add(revisionId),
        }
      })
      showToast('success', '已撤销这次修改')
      return true
    } catch (failure) {
      set((state) => {
        const busy = new Set(state.undoBusy)
        busy.delete(revisionId)
        return { undoBusy: busy, error: describeError(failure) }
      })
      return false
    }
  },

  clearError() {
    set({ error: null })
  },
}))

/** The chip label a stored context shows, given the resolved entry titles. */
export function labelForContext(
  context: MessageContext,
  contextEntries: Readonly<Record<string, string>>,
): string {
  return contextLabelFor(context, contextEntries)
}
