/**
 * @file ToolRisk
 * @description Risk level declared when a tool is registered. The level, not a
 * prompt convention, decides how a call is executed.
 */

export const TOOL_RISKS = ['read', 'write', 'propose', 'destructive'] as const

export type ToolRisk = (typeof TOOL_RISKS)[number]

export function isToolRisk(raw: string): raw is ToolRisk {
  return (TOOL_RISKS as readonly string[]).includes(raw)
}
