/**
 * @file ToolRegistry
 * @description The contract every agent tool implements, and the capabilities
 * handed to each execution. Argument parsing returns a Result rather than
 * throwing, because a malformed tool call is an expected outcome, not a fault.
 */

import type { Result } from '../../shared/Result'
import type { Clock } from '../../catalog/ports/Clock'
import type { ExperienceRepository } from '../../catalog/ports/ExperienceRepository'
import type { ProfileRepository } from '../../catalog/ports/ProfileRepository'
import type { ResumeRepository } from '../../resume/ports/ResumeRepository'
import type { LayoutInput, LayoutOutput } from '../../resume/PageLayout'
import type { AgentRunRepository } from './AgentRunRepository'
import type { ToolRisk } from '../ToolRisk'

export interface RegisteredTool<I, O> {
  readonly name: string
  readonly description: string
  readonly risk: ToolRisk
  /** Validates raw tool-call arguments at the boundary. Returns Result, not throws. */
  parse(raw: unknown): Result<I>
  execute(input: I, ctx: ToolContext): Promise<O>
}

/** Capabilities handed to every tool execution. */
export interface ToolContext {
  readonly resumes: ResumeRepository
  readonly experiences: ExperienceRepository
  readonly profiles: ProfileRepository
  readonly runs: AgentRunRepository
  readonly clock: Clock
  /** layout() bound to the canonical measurer — checkResumeLayout runs on it.
   *  Possible only because LayoutInput/Output are domain types. */
  readonly layout: (input: LayoutInput) => LayoutOutput
}

export interface ToolRegistry {
  list(): readonly RegisteredTool<unknown, unknown>[]
  get(name: string): RegisteredTool<unknown, unknown> | undefined
}
