/**
 * @file runStore
 * @description The live state of the assistant run that is streaming right now:
 * its identifier, the answer buffer, the tool cards being executed and the token
 * usage the provider reported. Committed messages belong to `conversationStore`;
 * this store exists so a text delta updates one buffer instead of the transcript,
 * and so the composer can tell "idle" from "running" without reading a message.
 *
 * Responsibilities:
 * - Reduce the nine AgentEvent kinds into one display state
 * - Keep the streamed answer buffer that the last bubble renders
 * - Track which invocation is running, so its card can show a live status
 * - Remember token usage per assistant message for the message footer
 *
 * Constraints:
 * - Display state only: nothing here decides what is persisted. `done` is
 *   followed by an authoritative message reload in `conversationStore`.
 * - One conversation streams at most one run; `begin` resets everything that
 *   belonged to the previous answer.
 */

import { create } from 'zustand'
import type { AgentEvent } from '../../../../domain/generation/AgentEvent'
import type { ToolRisk } from '../../../../domain/generation/ToolRisk'
import type {
  AgentRunId,
  ChangeRecordId,
  ConversationId,
  MessageId,
  ResumeId,
  RevisionId,
  ToolInvocationId,
} from '../../../../domain/shared/branded-id'

export type RunStatus = 'idle' | 'running' | 'cancelling'

export type ToolCardStatus = 'running' | 'ok' | 'failed'

/** What the interface knows about one tool call while the run is live. */
export interface ToolCardState {
  readonly invocationId: ToolInvocationId
  readonly messageId: MessageId
  readonly toolName: string
  readonly label: string
  readonly risk: ToolRisk
  readonly status: ToolCardStatus
  /** Redacted argument summary from `toolStart`. */
  readonly argsSummary: string
  /** Redacted outcome summary from `toolEnd`; empty while running. */
  readonly summary: string
  readonly changeIds: readonly ChangeRecordId[]
  readonly revisionId: RevisionId | null
  readonly resumeId: ResumeId | null
}

export interface TokenUsage {
  readonly promptTokens: number
  readonly completionTokens: number
}

interface RunState {
  readonly status: RunStatus
  readonly conversationId: ConversationId | null
  readonly runId: AgentRunId | null
  readonly assistantMessageId: MessageId | null
  /** True once `runStarted` arrived; before that the user turn is only optimistic. */
  readonly started: boolean
  readonly turn: number
  readonly buffer: string
  readonly usageByMessage: Readonly<Record<string, TokenUsage>>
  readonly toolCards: Readonly<Record<string, ToolCardState>>
  /** Readable failure raised by the `error` event, for the run status region. */
  readonly errorText: string | null
  /** Starts a new run; clears the previous answer's display state. */
  begin(conversationId: ConversationId): void
  /** Marks the stop request as in flight, so the button can report it. */
  markCancelling(): void
  applyEvent(event: AgentEvent): void
  /** Releases the stream state after the turn promise settled. */
  finish(): void
  /** Drops everything when the open conversation changes. */
  reset(): void
}

const EMPTY_RUN = {
  status: 'idle',
  conversationId: null,
  runId: null,
  assistantMessageId: null,
  started: false,
  turn: 0,
  buffer: '',
  usageByMessage: {},
  toolCards: {},
  errorText: null,
} as const satisfies Partial<RunState>

export const useRunStore = create<RunState>((set, get) => ({
  ...EMPTY_RUN,

  begin(conversationId) {
    set({
      ...EMPTY_RUN,
      status: 'running',
      conversationId,
      usageByMessage: get().usageByMessage,
    })
  },

  markCancelling() {
    if (get().status !== 'running') return
    set({ status: 'cancelling' })
  },

  applyEvent(event) {
    switch (event.type) {
      case 'runStarted':
        set({
          status: 'running',
          runId: event.runId,
          conversationId: event.conversationId,
          assistantMessageId: event.assistantMessageId,
          started: true,
        })
        return
      case 'textDelta':
        set((state) => ({ buffer: state.buffer + event.delta }))
        return
      case 'turnStarted':
        set({ turn: event.turn })
        return
      case 'toolStart':
        set((state) => ({
          toolCards: {
            ...state.toolCards,
            [event.invocationId]: {
              invocationId: event.invocationId,
              messageId: event.messageId,
              toolName: event.toolName,
              label: event.label,
              risk: event.risk,
              status: 'running',
              argsSummary: event.argsSummary,
              summary: '',
              changeIds: [],
              revisionId: null,
              resumeId: null,
            },
          },
        }))
        return
      case 'toolEnd':
        set((state) => {
          const existing = state.toolCards[event.invocationId]
          if (existing === undefined) return state
          return {
            toolCards: {
              ...state.toolCards,
              [event.invocationId]: {
                ...existing,
                status: event.status,
                summary: event.summary,
                changeIds: event.changeIds,
                revisionId: event.revisionId,
                resumeId: event.resumeId,
              },
            },
          }
        })
        return
      case 'changeRecorded':
        // The card already carries these identifiers from `toolEnd`; the event
        // is kept in the reducer so a later subscriber (the workspace panels)
        // can react to it without the transcript learning a second source.
        return
      case 'usage':
        set((state) => {
          const messageId = state.assistantMessageId
          if (messageId === null) return state
          return {
            usageByMessage: {
              ...state.usageByMessage,
              [messageId]: {
                promptTokens: event.promptTokens,
                completionTokens: event.completionTokens,
              },
            },
          }
        })
        return
      case 'error':
        set({ errorText: event.message })
        return
      case 'done':
        set({ status: 'idle', errorText: event.errorText })
        return
    }
  },

  finish() {
    set((state) => ({ ...state, status: 'idle' }))
  },

  reset() {
    set({ ...EMPTY_RUN })
  },
}))

/** The streamed answer of the run in flight; empty between runs. */
export function useStreamBuffer(): string {
  return useRunStore((state) => state.buffer)
}

/** The run status the composer and the status region read. */
export function useRunStatus(): RunStatus {
  return useRunStore((state) => state.status)
}

/** True while an answer is being produced, including a stop request in flight. */
export function isRunBusy(status: RunStatus): boolean {
  return status !== 'idle'
}
