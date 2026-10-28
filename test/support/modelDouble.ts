/**
 * @file modelDouble
 * @description A ModelProvider test double that replays one script per request
 * and records the request and the offered tool schemas.
 */

import type {
  ChatRequest,
  ModelChunk,
  ModelProvider,
  ToolSchema,
} from '../../src/domain/generation/ports/ModelProvider'

export interface ScriptedTurn {
  readonly chunks?: readonly ModelChunk[]
  readonly error?: Error
  /** Yields control so a test can act while the stream is in flight. */
  readonly beforeEachChunk?: () => void | Promise<void>
}

export class AggregateModelDouble implements ModelProvider {
  readonly id = 'scripted'
  readonly modelId = 'scripted-model'
  readonly requests: ChatRequest[] = []
  readonly offeredTools: (readonly ToolSchema[])[] = []
  readonly turns: ScriptedTurn[] = []
  supportsImages = false
  #turn = 0

  constructor(turns: readonly ScriptedTurn[] = []) {
    this.turns.push(...turns)
  }

  enqueue(turn: ScriptedTurn): void {
    this.turns.push(turn)
  }

  /** Number of requests the run loop has issued so far. */
  get calls(): number {
    return this.#turn
  }

  async *stream(
    request: ChatRequest,
    tools: readonly ToolSchema[],
    signal?: AbortSignal,
  ): AsyncIterable<ModelChunk> {
    this.requests.push(request)
    this.offeredTools.push(tools)
    const turn = this.turns[this.#turn] ?? { chunks: [] }
    this.#turn += 1
    if (turn.error !== undefined) throw turn.error
    for (const chunk of turn.chunks ?? []) {
      if (signal?.aborted === true) return
      if (turn.beforeEachChunk !== undefined) await turn.beforeEachChunk()
      yield chunk
    }
  }
}
