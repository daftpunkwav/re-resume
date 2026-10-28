/**
 * @file ScriptedModelProvider
 * @description A model provider that replays a fixed script instead of calling
 * a service. The preview window needs deterministic Chinese text, and browser
 * tests need a stream that ends exactly the same way on every run.
 *
 * Responsibilities:
 * - Replay one chunk list for every request (the original preview behaviour)
 * - Replay a per-request list, or resolve one from the request, so a preview can
 *   drive a multi-turn tool chain whose later arguments depend on earlier results
 * - Optionally end a replay with a provider failure, for the failed-run state
 *
 * Constraints:
 * - Preview assembly only; no network, no credentials.
 * - The script is a list of chunks; an aborted signal ends the stream without
 *   delivering the remaining chunks, which is the cancellation contract every
 *   provider adapter has to honour.
 * - A resolver receives the request as it was sent and the zero-based request
 *   index; it must not mutate the request.
 */

import type {
  ChatRequest,
  ModelChunk,
  ModelProvider,
  ToolSchema,
} from '../../domain/generation/ports/ModelProvider'
import { ModelCallError } from '../http/ProviderAdapters/errors'

export interface ScriptedFailure {
  readonly message: string
  readonly retryable?: boolean
  readonly status?: number | null
  /** Number of scripted chunks delivered before the failure; default all of them. */
  readonly afterChunks?: number
}

/** One request's chunks, or a function that derives them from the request. */
export type ScriptedTurn =
  | readonly ModelChunk[]
  | ((request: ChatRequest, requestIndex: number) => readonly ModelChunk[])

export interface ScriptedModelProviderOptions {
  readonly id?: string
  readonly modelId?: string
  /** Chunks replayed for every request, in order. */
  readonly script: readonly ModelChunk[]
  /** Per-request scripts; when present they replace the repeating script. */
  readonly turns?: readonly ScriptedTurn[]
  /** Yields control between chunks so the consumer sees a real async stream. */
  readonly pause?: () => Promise<void>
  /** Fixed inter-chunk delay, for the preview's slow script. Overrides no pause. */
  readonly pauseMs?: number
  /** Ends the stream with this failure after the scripted chunks ran. */
  readonly failure?: ScriptedFailure
  /** Whether the scripted model accepts image parts; false unless a script needs them. */
  readonly supportsImages?: boolean
}

export class ScriptedModelProvider implements ModelProvider {
  readonly id: string
  readonly modelId: string
  readonly supportsImages: boolean
  readonly #script: readonly ModelChunk[]
  readonly #turns: readonly ScriptedTurn[] | undefined
  readonly #pause: () => Promise<void>
  readonly #failure: ScriptedFailure | undefined
  #requestIndex = 0

  constructor(options: ScriptedModelProviderOptions) {
    this.id = options.id ?? 'preview'
    this.modelId = options.modelId ?? 'preview-scripted'
    this.supportsImages = options.supportsImages ?? false
    this.#script = options.script
    this.#turns = options.turns
    this.#failure = options.failure
    const delay = options.pauseMs
    this.#pause =
      options.pause ??
      (delay === undefined || delay <= 0
        ? async () => undefined
        : () => new Promise((resolve) => setTimeout(resolve, delay)))
  }

  async *stream(
    request: ChatRequest,
    _tools: readonly ToolSchema[],
    signal?: AbortSignal,
  ): AsyncIterable<ModelChunk> {
    const requestIndex = this.#requestIndex
    this.#requestIndex += 1
    const chunks = this.#chunksFor(request, requestIndex)
    let delivered = 0
    for (const chunk of chunks) {
      if (signal?.aborted === true) return
      if (this.#failure !== undefined && this.#failure.afterChunks === delivered) {
        throw failureError(this.#failure)
      }
      await this.#pause()
      yield chunk
      delivered += 1
    }
    // A failure that was not reached inside the loop ends the stream after the
    // whole script; that is the "answer was produced, then the service failed"
    // shape the failed-run state renders.
    if (this.#failure !== undefined) throw failureError(this.#failure)
  }

  #chunksFor(request: ChatRequest, requestIndex: number): readonly ModelChunk[] {
    if (this.#turns === undefined) return this.#script
    const turn = this.#turns[requestIndex]
    if (turn === undefined) return []
    return typeof turn === 'function' ? turn(request, requestIndex) : turn
  }
}

function failureError(failure: ScriptedFailure): ModelCallError {
  return new ModelCallError(failure.message, {
    retryable: failure.retryable ?? false,
    status: failure.status ?? null,
  })
}
