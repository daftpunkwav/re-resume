/**
 * @file ScriptedModelProvider
 * @description A model provider that replays a fixed script instead of calling
 * a service. The preview window needs deterministic Chinese text, and browser
 * tests need a stream that ends exactly the same way on every run.
 *
 * Constraints:
 * - Preview assembly only; no network, no credentials.
 * - The script is a list of chunks; an aborted signal ends the stream without
 *   delivering the remaining chunks, which is the cancellation contract every
 *   provider adapter has to honour.
 * - A script may end in a provider failure, which is how the preview renders the
 *   failed-run state without a real endpoint.
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

export interface ScriptedModelProviderOptions {
  readonly id?: string
  readonly modelId?: string
  /** Chunks replayed for every request, in order. */
  readonly script: readonly ModelChunk[]
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
  readonly #pause: () => Promise<void>
  readonly #failure: ScriptedFailure | undefined

  constructor(options: ScriptedModelProviderOptions) {
    this.id = options.id ?? 'preview'
    this.modelId = options.modelId ?? 'preview-scripted'
    this.supportsImages = options.supportsImages ?? false
    this.#script = options.script
    this.#failure = options.failure
    const delay = options.pauseMs
    this.#pause =
      options.pause ??
      (delay === undefined || delay <= 0
        ? async () => undefined
        : () => new Promise((resolve) => setTimeout(resolve, delay)))
  }

  async *stream(
    _request: ChatRequest,
    _tools: readonly ToolSchema[],
    signal?: AbortSignal,
  ): AsyncIterable<ModelChunk> {
    let delivered = 0
    for (const chunk of this.#script) {
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
}

function failureError(failure: ScriptedFailure): ModelCallError {
  return new ModelCallError(failure.message, {
    retryable: failure.retryable ?? false,
    status: failure.status ?? null,
  })
}
