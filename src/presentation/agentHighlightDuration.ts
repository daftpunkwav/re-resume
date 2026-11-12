/**
 * @file agentHighlightDuration
 * @description How long the workspace keeps pointing at what the agent just
 * wrote: the resume canvas flashes the changed sections and the information
 * panel marks the touched entries for the same window, so the two panels read
 * as one acknowledgement rather than two unrelated timers.
 *
 * Constraints:
 * - A product constant, not a store detail: both panels must agree, so neither
 *   store owns the value and a change to one is a change to both.
 */

export const AGENT_HIGHLIGHT_MS = 2000
