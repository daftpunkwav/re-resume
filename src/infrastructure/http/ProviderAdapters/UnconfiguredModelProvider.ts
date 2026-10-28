/**
 * @file UnconfiguredModelProvider
 * @description The provider the application uses when no model service is
 * configured, or when the configured one has no credential. It fails every
 * request with a readable, non-retryable reason instead of leaving the
 * conversation in a state that never resolves.
 *
 * Constraints:
 * - Never retried: nothing changes between two attempts, and the interface
 *   offers the settings entry instead.
 */

import type {
  ChatRequest,
  ModelChunk,
  ModelProvider,
  ToolSchema,
} from '../../../domain/generation/ports/ModelProvider'
import { ModelCallError } from './errors'

/** Text shown when no configured service can answer. Kept stable for the interface. */
export const UNCONFIGURED_PROVIDER_MESSAGE =
  '尚未配置可用的模型服务，请在设置中填写 API 地址、模型名称与密钥。'

export class UnconfiguredModelProvider implements ModelProvider {
  readonly id = 'unconfigured'
  readonly modelId = ''
  readonly supportsImages = false

  stream(
    _request: ChatRequest,
    _tools: readonly ToolSchema[],
    _signal?: AbortSignal,
  ): AsyncIterable<ModelChunk> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<ModelChunk>> => {
          throw new ModelCallError(UNCONFIGURED_PROVIDER_MESSAGE, {
            retryable: false,
            status: null,
          })
        },
      }),
    }
  }
}
