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
 */

import type {
  ChatRequest,
  ModelChunk,
  ModelProvider,
  ToolSchema,
} from '../../domain/generation/ports/ModelProvider'

export interface ScriptedModelProviderOptions {
  readonly id?: string
  readonly modelId?: string
  /** Chunks replayed for every request, in order. */
  readonly script: readonly ModelChunk[]
  /** Yields control between chunks so the consumer sees a real async stream. */
  readonly pause?: () => Promise<void>
  /** Whether the scripted model accepts image parts; false unless a script needs them. */
  readonly supportsImages?: boolean
}

export class ScriptedModelProvider implements ModelProvider {
  readonly id: string
  readonly modelId: string
  readonly supportsImages: boolean
  readonly #script: readonly ModelChunk[]
  readonly #pause: () => Promise<void>

  constructor(options: ScriptedModelProviderOptions) {
    this.id = options.id ?? 'preview'
    this.modelId = options.modelId ?? 'preview-scripted'
    this.supportsImages = options.supportsImages ?? false
    this.#script = options.script
    this.#pause = options.pause ?? (async () => undefined)
  }

  async *stream(
    _request: ChatRequest,
    _tools: readonly ToolSchema[],
    signal?: AbortSignal,
  ): AsyncIterable<ModelChunk> {
    for (const chunk of this.#script) {
      if (signal?.aborted === true) return
      await this.#pause()
      yield chunk
    }
  }
}
