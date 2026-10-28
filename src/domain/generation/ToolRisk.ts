/**
 * @file ToolRisk
 * @description Risk level declared when a tool is registered. The level decides
 * the card style and whether the call can be undone; it is not a prompt hint.
 *
 * - read: no side effect.
 * - write: changes structured data (library rows, composition, layout, resume
 *   metadata).
 * - draft: stores model-written prose in a resume override.
 */

export const TOOL_RISKS = ['read', 'write', 'draft'] as const

export type ToolRisk = (typeof TOOL_RISKS)[number]

export function isToolRisk(value: unknown): value is ToolRisk {
  return typeof value === 'string' && (TOOL_RISKS as readonly string[]).includes(value)
}
