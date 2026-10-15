/**
 * @file AgentRunRepository
 * @description Persistence port for agent runs. Runs are never deleted in v1:
 * they carry provenance that variant and revision rows point at.
 */

import type { AgentRun } from '../AgentRun'
import type { AgentRunId } from '../../shared/branded-id'

export interface AgentRunRepository {
  create(run: AgentRun): Promise<void>
  save(run: AgentRun): Promise<void>
  findById(id: AgentRunId): Promise<AgentRun | null>
}
