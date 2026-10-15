/**
 * @file ModelProvider
 * @description Outbound model calls. Adding a vendor means adding an adapter;
 * no business logic below this port knows which vendor it is talking to.
 */

export interface ModelProvider {
  readonly id: string
  readonly modelId: string
  stream(request: ChatRequest, tools: readonly ToolSchema[]): AsyncIterable<ModelChunk>
}

/** Minimal shapes; provider adapters refine at their boundary. */
export interface ChatRequest {
  readonly system: string | null
  readonly messages: readonly {
    readonly role: 'user' | 'assistant'
    readonly text: string
  }[]
}

export type ModelChunk =
  | { readonly type: 'text'; readonly textDelta: string }
  | { readonly type: 'toolCall'; readonly name: string; readonly argsJson: string }

export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parametersJsonSchema: unknown
}
